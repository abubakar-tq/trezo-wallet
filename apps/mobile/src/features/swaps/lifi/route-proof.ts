/**
 * Live LI.FI route proof (FR-06 + FR-07).
 *
 * Hits the real LI.FI API and prints the chosen route + amounts. No funds, no
 * keys, read-only. Capture this output for the report / viva.
 *
 * Run: npx tsx apps/mobile/src/features/swaps/lifi/route-proof.ts
 */
import { LifiClient } from "./LifiClient";

const BASE = 8453;
const ARB = 42161;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
// Any address works for a read-only quote.
const ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

async function main(): Promise<void> {
  const client = new LifiClient();

  const swap = await client.getQuote({
    fromChain: BASE, toChain: BASE, fromToken: USDC_BASE, toToken: WETH_BASE,
    fromAmount: "100000000", fromAddress: ADDR, slippage: 0.005,
  });
  console.log(
    `[FR-06] same-chain swap 100 USDC->WETH on Base: via ${swap.toolDetails?.name} (${swap.tool}); ` +
      `out=${swap.estimate.toAmount} wei; minOut=${swap.estimate.toAmountMin}; approvalAddress=${swap.estimate.approvalAddress}; ` +
      `target=${swap.transactionRequest.to}`,
  );

  const bridge = await client.getQuote({
    fromChain: BASE, toChain: ARB, fromToken: USDC_BASE, toToken: USDC_ARB,
    fromAmount: "10000000", fromAddress: ADDR, slippage: 0.005,
  });
  console.log(
    `[FR-07] cross-chain 10 USDC Base->Arbitrum: via ${bridge.toolDetails?.name} (${bridge.tool}); ` +
      `out=${bridge.estimate.toAmount}; eta=${bridge.estimate.executionDuration}s; target=${bridge.transactionRequest.to}`,
  );

  console.log("OK");
}

main().catch((e) => {
  console.error("PROOF FAILED:", (e as Error).message);
  process.exit(1);
});
