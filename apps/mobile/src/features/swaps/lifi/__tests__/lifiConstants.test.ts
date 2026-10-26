import {
  isLifiNetwork,
  isLifiBridgeRoute,
  lifiChainIdForNetwork,
  LIFI_DIAMOND,
  LIFI_NATIVE_ADDRESS,
} from "../constants";

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`assert failed: ${m}`);
}

function run(): void {
  // mainnet gating
  assert(isLifiNetwork("base-mainnet") === true, "base-mainnet is lifi");
  assert(isLifiNetwork("base-mainnet-fork") === true, "fork is lifi");
  assert(isLifiNetwork("base-sepolia") === false, "base-sepolia not lifi");
  assert(isLifiNetwork("ethereum-sepolia") === false, "sepolia not lifi");
  assert(isLifiNetwork("arbitrum-sepolia") === false, "arb-sepolia not lifi");
  assert(isLifiNetwork("anvil-local") === false, "anvil not lifi");

  // bridge-route predicate
  assert(isLifiBridgeRoute("base-mainnet-fork", "base-mainnet") === true, "mainnet pair is lifi route");
  assert(isLifiBridgeRoute("base-sepolia", "arbitrum-sepolia") === false, "testnet pair not lifi route");
  assert(isLifiBridgeRoute("base-mainnet", "base-sepolia") === false, "mixed pair not lifi route");

  // chain id mapping
  assert(lifiChainIdForNetwork("base-mainnet-fork") === 8453, "fork quotes as base 8453");
  assert(lifiChainIdForNetwork("base-mainnet") === 8453, "mainnet 8453");
  let threw = false;
  try { lifiChainIdForNetwork("base-sepolia"); } catch { threw = true; }
  assert(threw, "non-lifi network has no chain id mapping");

  // constants
  assert(LIFI_DIAMOND.toLowerCase() === "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", "diamond addr");
  assert(LIFI_NATIVE_ADDRESS === "0x0000000000000000000000000000000000000000", "native zero addr");

  console.log("OK");
}

run();
