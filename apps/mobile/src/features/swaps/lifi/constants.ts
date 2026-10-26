/**
 * LI.FI aggregator constants + mainnet chain gating.
 *
 * LI.FI is used ONLY on mainnet network keys (see ADR 0014). `base-mainnet-fork`
 * shares Base's chain id (8453), so it quotes against live Base liquidity and the
 * returned calldata executes against the fork (which mirrors mainnet state).
 *
 * Type-only imports (`import type`) are erased by the bundler/tsx, so this module
 * pulls no native/expo runtime dependency and stays unit-testable via `npx tsx`.
 */

import type { NetworkKey } from "@/src/integration/networks";
import type { Address } from "viem";

export const LIFI_BASE_URL = "https://li.quest/v1";

/**
 * Deterministic LiFi Diamond — the same address across chains, including Base.
 * Verified against official LI.FI docs (2026-06-02): it is both
 * `estimate.approvalAddress` and `transactionRequest.to` in the /quote response.
 */
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as Address;

/** LI.FI native-token sentinel (per LI.FI's own ETH examples). */
export const LIFI_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** Network keys on which LI.FI is the aggregator. */
const LIFI_NETWORK_KEYS: ReadonlySet<NetworkKey> = new Set<NetworkKey>([
  "base-mainnet",
  "base-mainnet-fork",
]);

/** True when LI.FI should be used for the given network key (mainnet only). */
export const isLifiNetwork = (networkKey: NetworkKey): boolean =>
  LIFI_NETWORK_KEYS.has(networkKey);

/**
 * True when a cross-chain route should use LI.FI — both endpoints must be
 * LI.FI (mainnet) networks. Pure predicate, safe to unit-test.
 */
export const isLifiBridgeRoute = (source: NetworkKey, dest: NetworkKey): boolean =>
  isLifiNetwork(source) && isLifiNetwork(dest);

/** The real chain id LI.FI should quote against for a network key (fork → live Base 8453). */
export const lifiChainIdForNetwork = (networkKey: NetworkKey): number => {
  switch (networkKey) {
    case "base-mainnet":
    case "base-mainnet-fork":
      return 8453;
    default:
      throw new Error(`No LI.FI chain id mapping for non-LI.FI network ${networkKey}.`);
  }
};
