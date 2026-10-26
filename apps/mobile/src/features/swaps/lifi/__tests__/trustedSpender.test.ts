// Verifies the LI.FI Diamond is trusted ONLY on mainnet keys. Imports dexRegistry
// directly (pure module) — swapProviders pulls native deps and is not tsx-runnable;
// provider-ordering is verified by code review + the supportsNetwork unit test.
import { isTrustedSpenderForNetwork } from "../../config/dexRegistry";
import { LIFI_DIAMOND } from "../constants";

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`assert failed: ${m}`);
}

function run(): void {
  assert(isTrustedSpenderForNetwork("base-mainnet-fork", LIFI_DIAMOND) === true, "diamond trusted on fork");
  assert(isTrustedSpenderForNetwork("base-mainnet", LIFI_DIAMOND) === true, "diamond trusted on mainnet");
  assert(isTrustedSpenderForNetwork("base-sepolia", LIFI_DIAMOND) === false, "diamond NOT trusted on base-sepolia");
  assert(isTrustedSpenderForNetwork("ethereum-sepolia", LIFI_DIAMOND) === false, "diamond NOT trusted on sepolia");

  // Existing Uniswap routers must remain trusted on mainnet keys (no regression).
  const uniRouterBase = "0x2626664c2603336E57B271c5C0b26F421741e481";
  assert(isTrustedSpenderForNetwork("base-mainnet-fork", uniRouterBase as `0x${string}`) === true, "uniswap router still trusted on fork");

  console.log("OK");
}

run();
