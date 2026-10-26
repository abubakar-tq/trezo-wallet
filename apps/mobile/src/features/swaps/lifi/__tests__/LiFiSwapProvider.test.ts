import { LiFiSwapProvider } from "../../providers/LiFiSwapProvider";
import { LifiClient } from "../LifiClient";
import fixture from "./fixtures/swap-quote.base.json";

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`assert failed: ${m}`);
}

const usdc: any = {
  type: "erc20", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  symbol: "USDC", name: "USD Coin", decimals: 6, chainId: 8453, isVerified: true, source: "builtin",
};
const weth: any = {
  type: "erc20", address: "0x4200000000000000000000000000000000000006",
  symbol: "WETH", name: "Wrapped Ether", decimals: 18, chainId: 8453, isVerified: true, source: "builtin",
};

const fetchReturning = (body: unknown): typeof fetch =>
  (async () => ({ ok: true, status: 200, json: async () => body } as unknown as Response)) as unknown as typeof fetch;

async function run(): Promise<void> {
  const provider = new LiFiSwapProvider(new LifiClient({ fetchImpl: fetchReturning(fixture) }));

  assert(provider.id === "lifi", "id");
  assert(provider.supportsNetwork("base-mainnet-fork") === true, "supports fork");
  assert(provider.supportsNetwork("base-mainnet") === true, "supports mainnet");
  assert(provider.supportsNetwork("base-sepolia") === false, "not testnet");

  const quote = await provider.getQuote({
    networkKey: "base-mainnet-fork",
    chainId: 8453 as any,
    account: "0xd3ab5fc84faa0396aff38cfea419e0f9cb338714",
    sellToken: usdc,
    buyToken: weth,
    sellAmountRaw: 100000000n,
    slippageBps: 50,
  });

  assert(quote.target.toLowerCase() === "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", "target = diamond");
  assert(quote.spender.toLowerCase() === "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", "spender = diamond");
  assert(quote.value === 0n, "value parsed from hex 0x0");
  assert(quote.estimatedBuyAmountRaw === 39200000000000000n, "toAmount");
  assert(quote.minimumBuyAmountRaw === 39004000000000000n, "toAmountMin");
  assert(quote.provider === "lifi", "provider id");
  assert(quote.calldata === "0x4630a0d8deadbeef", "calldata passthrough");
  assert((quote.routeMetadata as any).toolName === "Uniswap V3", "route tool name");
  // priceImpact derived from 100.00 → 99.40 USD = 0.60% = 60 bps
  assert(quote.priceImpactBps === 60, `price impact 60 bps, got ${quote.priceImpactBps}`);

  // SECURITY: approvalAddress that is not the Diamond must be rejected.
  const tampered = JSON.parse(JSON.stringify(fixture));
  tampered.estimate.approvalAddress = "0x000000000000000000000000000000000000dEaD";
  const badProvider = new LiFiSwapProvider(new LifiClient({ fetchImpl: fetchReturning(tampered) }));
  let threw = false;
  try {
    await badProvider.getQuote({
      networkKey: "base-mainnet-fork", chainId: 8453 as any, account: "0xabc",
      sellToken: usdc, buyToken: weth, sellAmountRaw: 1n, slippageBps: 50,
    });
  } catch {
    threw = true;
  }
  assert(threw, "rejects untrusted approvalAddress");

  // SECURITY: a transactionRequest.to that is not the Diamond must also be rejected.
  const tamperedTarget = JSON.parse(JSON.stringify(fixture));
  tamperedTarget.transactionRequest.to = "0x000000000000000000000000000000000000dEaD";
  const badTargetProvider = new LiFiSwapProvider(new LifiClient({ fetchImpl: fetchReturning(tamperedTarget) }));
  let threwTarget = false;
  try {
    await badTargetProvider.getQuote({
      networkKey: "base-mainnet-fork", chainId: 8453 as any, account: "0xabc",
      sellToken: usdc, buyToken: weth, sellAmountRaw: 1n, slippageBps: 50,
    });
  } catch {
    threwTarget = true;
  }
  assert(threwTarget, "rejects untrusted transactionRequest.to");

  console.log("OK");
}

run();
