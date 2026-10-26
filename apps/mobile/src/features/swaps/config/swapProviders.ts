/**
 * swapProviders.ts
 *
 * Provider registry and trusted-spender helpers.
 *
 * New API (network-key aware):
 *   getSwapProvidersForNetwork(networkKey)
 *   getTrustedSpendersForNetwork(networkKey)  — from dexRegistry
 *   isTrustedSpenderForNetwork(networkKey, spender)
 *
 * Legacy API (chain-id based):
 *   getSwapProvidersForChain(chainId)
 *   isTrustedSpenderForChain(chainId, spender)
 */

import type { SwapRouteProvider } from "@/src/features/swaps/providers/SwapRouteProvider";
import { LiFiSwapProvider } from "@/src/features/swaps/providers/LiFiSwapProvider";
import { LocalMockSwapProvider } from "@/src/features/swaps/providers/LocalMockSwapProvider";
import { UniswapV3Provider } from "@/src/features/swaps/providers/UniswapV3Provider";
import { UniswapV2BaseProvider } from "@/src/features/swaps/providers/UniswapV2BaseProvider";
import type { SupportedChainId } from "@/src/integration/chains";
import type { NetworkKey } from "@/src/integration/networks";
import { getDeployment } from "@/src/integration/viem/deployments";
import {
  isTrustedSpenderForNetwork as isDexTrustedSpender,
} from "@/src/features/swaps/config/dexRegistry";
import { isTrustedBridgeSpender } from "@/src/features/swaps/config/bridgeRegistry";
import type { Address } from "viem";

// ─── Provider instances ────────────────────────────────────────────────────────
// Order matters for getProviderForNetwork: it picks the first provider whose
// supportsPair() returns true.
//   - LiFi goes first but is mainnet-gated (supportsNetwork → base-mainnet /
//     base-mainnet-fork only), so on testnet it returns false and the loop
//     falls through to the direct providers untouched (ADR 0014).
//   - V2 (Base only) precedes V3 because getAmountsOut is a pure view call —
//     cheaper than the V3 QuoterV2 simulation.

const ALL_PROVIDERS: readonly SwapRouteProvider[] = [
  new LiFiSwapProvider(),
  new LocalMockSwapProvider(),
  new UniswapV2BaseProvider(),
  new UniswapV3Provider(),
];

// ─── Network-key-aware API ─────────────────────────────────────────────────────

export const getSwapProvidersForNetwork = (networkKey: NetworkKey): SwapRouteProvider[] =>
  ALL_PROVIDERS.filter((provider) => provider.supportsNetwork(networkKey));

export const isTrustedSpenderForNetwork = (networkKey: NetworkKey, spender: Address): boolean =>
  isDexTrustedSpender(networkKey, spender) || isTrustedBridgeSpender(networkKey, spender);

// ─── Legacy chain-id API (backwards compat) ────────────────────────────────────

export const getSwapProvidersForChain = (chainId: SupportedChainId): SwapRouteProvider[] =>
  ALL_PROVIDERS.filter((provider) => provider.supportsChain(chainId));

export const getTrustedSpendersForChain = (chainId: SupportedChainId): Address[] => {
  const deployment = getDeployment(chainId as never);
  const trusted: Address[] = [];

  if (deployment?.mockSwapRouter) {
    trusted.push(deployment.mockSwapRouter);
  }

  return trusted;
};

export const isTrustedSpenderForChain = (chainId: SupportedChainId, spender: Address): boolean => {
  const trusted = getTrustedSpendersForChain(chainId).map((address) => address.toLowerCase());
  return trusted.includes(spender.toLowerCase());
};
