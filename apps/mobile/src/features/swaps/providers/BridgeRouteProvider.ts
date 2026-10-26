/**
 * BridgeRouteProvider — provider abstraction for cross-chain routes (FR-07).
 *
 * Mirrors SwapRouteProvider for bridges, realizing NFR-10 (extendable
 * architecture). Two implementations:
 *   - LiFiBridgeProvider  (mainnet, LI.FI routing API)
 *   - AcrossBridgeProvider (testnet, thin adapter over the existing Across path)
 *
 * `BridgeRouteQuote` is intentionally execution-ready (carries target/spender/
 * calldata/value). Today only the read-only display fields are consumed; the
 * execution fields are the "leverage" for a future mainnet execution flip.
 */

import type { TokenMetadata } from "@/src/features/assets/types/token";
import type { NetworkKey } from "@/src/integration/networks";
import type { SupportedChainId } from "@/src/integration/chains";
import type { Address, Hex } from "viem";

export type BridgeRouteRequest = {
  sourceNetworkKey: NetworkKey;
  sourceChainId: SupportedChainId;
  destNetworkKey: NetworkKey;
  destChainId: SupportedChainId;
  account: Address;
  destAccount?: Address;
  inputToken: TokenMetadata;
  outputToken: TokenMetadata;
  inputAmountRaw: bigint;
  slippageBps: number;
};

export type BridgeRouteQuote = {
  provider: string; // "lifi" | "across_v3"
  routeLabel: string; // chosen bridge, e.g. "Across", "Stargate", "Across V3"
  inputToken: TokenMetadata;
  outputToken: TokenMetadata;
  inputAmountRaw: bigint;
  estimatedOutRaw: bigint;
  minOutRaw: bigint;
  feeBps?: number;
  etaSeconds?: number;
  // Execution-ready (optional). Present for LI.FI; intentionally absent for the
  // Across adapter (its execution stays on BridgePreparationService).
  target?: Address;
  spender?: Address;
  calldata?: Hex;
  value?: bigint;
  routeMetadata?: Record<string, unknown>;
};

export interface BridgeRouteProvider {
  readonly id: string;
  readonly label: string;
  supportsRoute(req: BridgeRouteRequest): boolean;
  getRoute(req: BridgeRouteRequest): Promise<BridgeRouteQuote>;
}
