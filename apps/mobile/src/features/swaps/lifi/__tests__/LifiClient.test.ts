import { LifiClient } from "../LifiClient";
import fixture from "./fixtures/swap-quote.base.json";

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`assert failed: ${m}`);
}

async function run(): Promise<void> {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const fakeFetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    capturedUrl = String(url);
    capturedHeaders = init?.headers ?? {};
    return { ok: true, status: 200, json: async () => fixture } as unknown as Response;
  }) as unknown as typeof fetch;

  const client = new LifiClient({ fetchImpl: fakeFetch, integrator: "trezo", apiKey: "k_test" });
  const quote = await client.getQuote({
    fromChain: 8453,
    toChain: 8453,
    fromToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    toToken: "0x4200000000000000000000000000000000000006",
    fromAmount: "100000000",
    fromAddress: "0xd3ab5fc84faa0396aff38cfea419e0f9cb338714",
    slippage: 0.005,
  });

  assert(capturedUrl.startsWith("https://li.quest/v1/quote?"), "calls quote endpoint");
  assert(capturedUrl.includes("fromChain=8453"), "fromChain param");
  assert(capturedUrl.includes("toChain=8453"), "toChain param");
  assert(capturedUrl.includes("slippage=0.005"), "slippage decimal param");
  assert(capturedUrl.includes("integrator=trezo"), "integrator param");
  assert(capturedHeaders["x-lifi-api-key"] === "k_test", "api key header set");
  assert(quote.tool === "uniswap", "parsed tool");
  assert(quote.estimate.approvalAddress === "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "approvalAddress");
  assert(quote.transactionRequest.value === "0x0", "tx value hex");

  // error path: non-ok response throws with status surfaced
  const errFetch = (async () =>
    ({ ok: false, status: 429, statusText: "Too Many Requests", json: async () => ({ message: "Rate limit" }) } as unknown as Response)) as unknown as typeof fetch;
  const errClient = new LifiClient({ fetchImpl: errFetch });
  let threw = false;
  try {
    await errClient.getQuote({ fromChain: 8453, toChain: 8453, fromToken: "0x", toToken: "0x", fromAmount: "1", fromAddress: "0x" });
  } catch (e) {
    threw = true;
    assert(String((e as Error).message).includes("429"), "429 surfaced");
  }
  assert(threw, "error path throws");

  // no-route path: ok but missing transactionRequest
  const emptyFetch = (async () =>
    ({ ok: true, status: 200, json: async () => ({ estimate: {} }) } as unknown as Response)) as unknown as typeof fetch;
  const emptyClient = new LifiClient({ fetchImpl: emptyFetch });
  let threw2 = false;
  try {
    await emptyClient.getQuote({ fromChain: 8453, toChain: 8453, fromToken: "0x", toToken: "0x", fromAmount: "1", fromAddress: "0x" });
  } catch {
    threw2 = true;
  }
  assert(threw2, "missing transactionRequest throws");

  // malformed amount: ok with tx + approvalAddress but a non-numeric toAmount
  const badAmt = JSON.parse(JSON.stringify(fixture));
  badAmt.estimate.toAmount = "NaN";
  const badAmtClient = new LifiClient({
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => badAmt } as unknown as Response)) as unknown as typeof fetch,
  });
  let threw3 = false;
  try {
    await badAmtClient.getQuote({ fromChain: 8453, toChain: 8453, fromToken: "0x", toToken: "0x", fromAmount: "1", fromAddress: "0x" });
  } catch {
    threw3 = true;
  }
  assert(threw3, "malformed output amount throws");

  console.log("OK");
}

run();
