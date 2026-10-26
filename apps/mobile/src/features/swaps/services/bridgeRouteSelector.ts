/**
 * bridgeRouteSelector — chooses the cross-chain route provider by network
 * (mainnet → LI.FI; testnet → Across). Used for READ-ONLY route display.
 * Execution selection is NOT changed by this module: testnet bridges continue
 * to execute via BridgePreparationService (ADR 0007/0014).
 */

import type { BridgeRouteProvider } from "../providers/BridgeRouteProvider";
import { LiFiBridgeProvider } from "../providers/LiFiBridgeProvider";
import { AcrossBridgeProvider } from "../providers/AcrossBridgeProvider";
import { isLifiBridgeRoute } from "../lifi/constants";
import type { NetworkKey } from "@/src/integration/networks";

const lifi = new LiFiBridgeProvider();
const across = new AcrossBridgeProvider();

export const getBridgeRouteProvider = (
  source: NetworkKey,
  dest: NetworkKey,
): BridgeRouteProvider => (isLifiBridgeRoute(source, dest) ? lifi : across);
