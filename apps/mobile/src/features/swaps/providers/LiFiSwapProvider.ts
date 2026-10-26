/**
 * LiFiSwapProvider
 *
 * Same-chain swap route provider backed by the LI.FI aggregator (FR-06).
 * Mainnet-gated via `isLifiNetwork` (base-mainnet, base-mainnet-fork) so it is
 * never entered on testnet. Maps LI.FI's GET /v1/quote response 1:1 into the
 * existing `SwapQuote`, so the provider-agnostic execution pipeline runs unchanged.
 *
 * On base-mainnet-fork the quote is fetched against live Base (chainId 8453);
 * the returned calldata targets the LiFi Diamond + DEX routers that exist on the
 * fork, so it executes against forked liquidity. Generous slippage absorbs the
 * price drift between the live-quote block and the fork block.
 *
 * Runtime imports are relative (tsx-testable); type-only imports are erased.
 */

import { LifiClient } from "../lifi/LifiClient";
import {
  isLifiNetwork,
  lifiChainIdForNetwork,
  LIFI_DIAMOND,
  LIFI_NATIVE_ADDRESS,
} from "../lifi/constants";
import type { SwapRouteProvider, SwapQuoteRequest } from "./SwapRouteProvider";
import type { SwapQuote } from "../types/swap";
import type { TokenMetadata } from "@/src/features/assets/types/token";
import type { SupportedChainId } from "@/src/integration/chains";
import type { NetworkKey } from "@/src/integration/networks";
import { hexToBigInt, type Address, type Hex } from "viem";

const lifiTokenAddress = (token: TokenMetadata): string =>
  token.type === "native" ? LIFI_NATIVE_ADDRESS : token.address;

const toBigIntHex = (hex?: string): bigint =>
  hex && hex !== "0x" ? hexToBigInt(hex as Hex) : 0n;

const derivePriceImpactBps = (fromUSD?: string, toUSD?: string): number | undefined => {
  const f = Number(fromUSD);
  const t = Number(toUSD);
  if (!Number.isFinite(f) || !Number.isFinite(t) || f <= 0) return undefined;
  const impact = Math.max(0, (f - t) / f);
  return Math.round(impact * 10_000);
};

export class LiFiSwapProvider implements SwapRouteProvider {
  readonly id = "lifi";
  readonly label = "LI.FI";
  private readonly client: LifiClient;

  constructor(client: LifiClient = new LifiClient()) {
    this.client = client;
  }

  supportsChain(_chainId: SupportedChainId): boolean {
    // Network-key-aware — use supportsNetwork().
    return false;
  }

  supportsNetwork(networkKey: NetworkKey): boolean {
    return isLifiNetwork(networkKey);
  }

  async supportsPair(request: SwapQuoteRequest): Promise<boolean> {
    if (!this.supportsNetwork(request.networkKey)) return false;
    // Native→native is not a swap.
    if (request.sellToken.type === "native" && request.buyToken.type === "native") return false;
    // LI.FI routes broadly; getQuote() surfaces a no-route error if needed.
    return true;
  }

  async getQuote(request: SwapQuoteRequest): Promise<SwapQuote> {
    const { networkKey, chainId, account, sellToken, buyToken, sellAmountRaw, slippageBps } = request;
    if (sellAmountRaw <= 0n) throw new Error("Sell amount must be greater than zero.");

    const lifiChainId = lifiChainIdForNetwork(networkKey);
    const quote = await this.client.getQuote({
      fromChain: lifiChainId,
      toChain: lifiChainId,
      fromToken: lifiTokenAddress(sellToken),
      toToken: lifiTokenAddress(buyToken),
      fromAmount: sellAmountRaw.toString(),
      fromAddress: account,
      toAddress: account,
      slippage: slippageBps / 10_000,
    });

    // SECURITY: only ever approve/execute the LiFi Diamond we explicitly trust.
    const approvalAddress = quote.estimate.approvalAddress as Address;
    if (approvalAddress.toLowerCase() !== LIFI_DIAMOND.toLowerCase()) {
      throw new Error(`LI.FI approvalAddress ${approvalAddress} is not the trusted Diamond.`);
    }
    const target = quote.transactionRequest.to as Address;
    if (target.toLowerCase() !== LIFI_DIAMOND.toLowerCase()) {
      throw new Error(`LI.FI transaction target ${target} is not the trusted Diamond.`);
    }

    const estimatedBuyAmountRaw = BigInt(quote.estimate.toAmount);
    const minimumBuyAmountRaw = BigInt(quote.estimate.toAmountMin);
    if (estimatedBuyAmountRaw <= 0n || minimumBuyAmountRaw <= 0n) {
      throw new Error("LI.FI returned a non-positive output amount.");
    }

    const now = Date.now();
    return {
      quoteId: quote.id ?? `lifi-${networkKey}-${sellToken.symbol}-${buyToken.symbol}-${now}`,
      chainId,
      networkKey,
      sellToken,
      buyToken,
      sellAmountRaw,
      estimatedBuyAmountRaw,
      minimumBuyAmountRaw,
      slippageBps,
      priceImpactBps: derivePriceImpactBps(quote.estimate.fromAmountUSD, quote.estimate.toAmountUSD),
      spender: approvalAddress,
      target,
      value: toBigIntHex(quote.transactionRequest.value),
      calldata: quote.transactionRequest.data as Hex,
      provider: this.id,
      providerId: this.id,
      expiresAt: new Date(now + 30_000).toISOString(),
      routeMetadata: {
        aggregator: "lifi",
        tool: quote.tool,
        toolName: quote.toolDetails?.name ?? quote.tool,
        executionDurationSec: quote.estimate.executionDuration,
        fromAmountUSD: quote.estimate.fromAmountUSD,
        toAmountUSD: quote.estimate.toAmountUSD,
      },
    };
  }
}
