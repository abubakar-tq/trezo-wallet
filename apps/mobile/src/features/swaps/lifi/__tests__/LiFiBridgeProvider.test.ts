import { LiFiBridgeProvider } from "../../providers/LiFiBridgeProvider";
import { LifiClient } from "../LifiClient";
import fixture from "./fixtures/bridge-quote.base-arb.json";

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`assert failed: ${m}`);
}

const usdcBase: any = {
  type: "erc20", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC", name: "USD Coin", decimals: 6, chainId: 8453, isVerified: true, source: "builtin",
};
const usdcArb: any = {
  type: "erc20", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC", name: "USD Coin", decimals: 6, chainId: 42161, isVerified: true, source: "builtin",
};

async function run(): Promise<void> {
  const fakeFetch = (async () =>
    ({ ok: true, status: 200, json: async () => fixture } as unknown as Response)) as unknown as typeof fetch;
  const provider = new LiFiBridgeProvider(new LifiClient({ fetchImpl: fakeFetch }));

  assert(provider.supportsRoute({ sourceNetworkKey: "base-mainnet-fork", destNetworkKey: "base-mainnet" } as any) === true, "mainnet pair supported");
  assert(provider.supportsRoute({ sourceNetworkKey: "base-sepolia", destNetworkKey: "arbitrum-sepolia" } as any) === false, "testnet pair not supported");

  const route = await provider.getRoute({
    sourceNetworkKey: "base-mainnet-fork", sourceChainId: 8453 as any,
    destNetworkKey: "base-mainnet", destChainId: 42161 as any,
    account: "0xd3ab5fc84faa0396aff38cfea419e0f9cb338714",
    inputToken: usdcBase, outputToken: usdcArb, inputAmountRaw: 10000000n, slippageBps: 50,
  });

  assert(route.provider === "lifi", "provider");
  assert(route.routeLabel === "Across", "route label = chosen bridge");
  assert(route.estimatedOutRaw === 9965731n, "est out");
  assert(route.minOutRaw === 9965731n, "min out");
  assert(route.feeBps === 25, `fee bps 25, got ${route.feeBps}`);
  assert(route.etaSeconds === 12, "eta");
  assert(route.target?.toLowerCase() === "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", "execution-ready target carried");
  assert(route.spender?.toLowerCase() === "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", "execution-ready spender carried");
  assert(route.calldata === "0x1794958fcafe", "calldata carried");

  console.log("OK");
}

run();
