import { buildSwapPreview } from "../buildSwapPreview";
function assert(c: boolean, m: string): void { if (!c) throw new Error(`assert failed: ${m}`); }
const plan: any = {
  intent: { chainId: 84532 },
  quote: {
    chainId: 84532, networkKey: "base-sepolia",
    sellToken: { symbol: "ETH", name: "Ethereum", type: "native", decimals: 18 },
    buyToken: { symbol: "USDC", name: "USD Coin", type: "erc20", address: "0xusdc", decimals: 6 },
    sellAmountRaw: 50000000000000000n, estimatedBuyAmountRaw: 142610000n, minimumBuyAmountRaw: 141800000n,
    slippageBps: 50, provider: "uniswap_v3", target: "0xrouter", value: 0n, calldata: "0xabcd",
  },
  swapExecution: { chainId: 84532, account: "0xacc", target: "0xrouter", value: 0n, data: "0xabcd", networkKey: "base-sepolia" },
};
function run(): void {
  const p = buildSwapPreview(plan, "Base Sepolia");
  assert(p.kind === "swap", "kind");
  assert(p.assetDeltas[0].direction === "out" && p.assetDeltas[0].symbol === "ETH", "sell out");
  assert(p.assetDeltas[1].direction === "in" && p.assetDeltas[1].amountDisplay === "142.61", "buy in 142.61");
  assert(p.slippageBps === 50 && p.minReceivedDisplay === "141.8 USDC", `min: ${p.minReceivedDisplay}`);
  assert(p.contextLabel === "via uniswap_v3", "context label");

  // LI.FI-aggregated swap surfaces the chosen DEX + aggregator credit.
  const lifiPlan: any = {
    ...plan,
    quote: { ...plan.quote, provider: "lifi", routeMetadata: { aggregator: "lifi", toolName: "Uniswap V3" } },
  };
  const lp = buildSwapPreview(lifiPlan, "Base Fork");
  assert(lp.contextLabel === "via Uniswap V3 · aggregated by LI.FI", `lifi label: ${lp.contextLabel}`);

  // LI.FI without a tool name falls back gracefully.
  const lifiNoTool: any = { ...plan, quote: { ...plan.quote, provider: "lifi", routeMetadata: {} } };
  assert(buildSwapPreview(lifiNoTool, "Base Fork").contextLabel === "via lifi", "lifi fallback label");

  console.log("OK");
}
run();
