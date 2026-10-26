/**
 * LiFiBridgeProvider — cross-chain routing via LI.FI (FR-07), mainnet-gated.
 *
 * Returns a normalized, EXECUTION-READY BridgeRouteQuote. Today only the
 * display fields are surfaced (read-only route — TC-07 requires a valid
 * returned route); target/spender/calldata/value are carried for a future
 * mainnet execution flip (ADR 0014). Runtime imports are relative (tsx-testable).
 */

import { LifiClient } from "../lifi/LifiClient";
import { isLifiBridgeRoute, lifiChainIdForNetwork, LIFI_DIAMOND, LIFI_NATIVE_ADDRESS } from "../lifi/constants";
import type { BridgeRouteProvider, BridgeRouteRequest, BridgeRouteQuote } from "./BridgeRouteProvider";
import type { TokenMetadata } from "@/src/features/assets/types/token";
import { hexToBigInt, type Address, type Hex } from "viem";

const lifiTokenAddress = (t: TokenMetadata): string =>
  t.type === "native" ? LIFI_NATIVE_ADDRESS : t.address;

const toBigIntHex = (hex?: string): bigint =>
  hex && hex !== "0x" ? hexToBigInt(hex as Hex) : 0n;

export class LiFiBridgeProvider implements BridgeRouteProvider {
  readonly id = "lifi";
  readonly label = "LI.FI";
  private readonly client: LifiClient;

  constructor(client: LifiClient = new LifiClient()) {
    this.client = client;
  }

  supportsRoute(req: BridgeRouteRequest): boolean {
    return isLifiBridgeRoute(req.sourceNetworkKey, req.destNetworkKey);
  }

  async getRoute(req: BridgeRouteRequest): Promise<BridgeRouteQuote> {
    if (req.inputAmountRaw <= 0n) throw new Error("Bridge amount must be greater than zero.");

    const quote = await this.client.getQuote({
      fromChain: lifiChainIdForNetwork(req.sourceNetworkKey),
      toChain: lifiChainIdForNetwork(req.destNetworkKey),
      fromToken: lifiTokenAddress(req.inputToken),
      toToken: lifiTokenAddress(req.outputToken),
      fromAmount: req.inputAmountRaw.toString(),
      fromAddress: req.account,
      toAddress: req.destAccount ?? req.account,
      slippage: req.slippageBps / 10_000,
    });

    // Defense-in-depth (fail-closed): LI.FI routes through the Diamond. The
    // execution-ready fields are read-only today, but guard them now so the
    // future mainnet execution flip can never approve/call an untrusted target.
    const approvalAddress = quote.estimate.approvalAddress as Address;
    const target = quote.transactionRequest.to as Address;
    if (approvalAddress.toLowerCase() !== LIFI_DIAMOND.toLowerCase()) {
      throw new Error(`LI.FI bridge approvalAddress ${approvalAddress} is not the trusted Diamond.`);
    }
    if (target.toLowerCase() !== LIFI_DIAMOND.toLowerCase()) {
      throw new Error(`LI.FI bridge target ${target} is not the trusted Diamond.`);
    }

    const feePct = quote.estimate.feeCosts?.[0]?.percentage;
    return {
      provider: this.id,
      routeLabel: quote.toolDetails?.name ?? quote.tool,
      inputToken: req.inputToken,
      outputToken: req.outputToken,
      inputAmountRaw: req.inputAmountRaw,
      estimatedOutRaw: BigInt(quote.estimate.toAmount),
      minOutRaw: BigInt(quote.estimate.toAmountMin),
      feeBps: feePct ? Math.round(Number(feePct) * 10_000) : undefined,
      etaSeconds: quote.estimate.executionDuration,
      target: quote.transactionRequest.to as Address,
      spender: quote.estimate.approvalAddress as Address,
      calldata: quote.transactionRequest.data as Hex,
      value: toBigIntHex(quote.transactionRequest.value),
      routeMetadata: { aggregator: "lifi", tool: quote.tool, steps: quote.includedSteps?.length ?? 0 },
    };
  }
}
