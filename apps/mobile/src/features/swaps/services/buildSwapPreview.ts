import { formatUnits } from "viem";
import type { SwapPlan } from "../types/swap";
import type { TxPreview } from "../../transactions/types/txPreview";

export function buildSwapPreview(plan: SwapPlan, networkName: string): TxPreview {
  const { quote, swapExecution } = plan;
  const sellDisplay = formatUnits(quote.sellAmountRaw, quote.sellToken.decimals);
  const buyDisplay = formatUnits(quote.estimatedBuyAmountRaw, quote.buyToken.decimals);
  const minDisplay = formatUnits(quote.minimumBuyAmountRaw, quote.buyToken.decimals);
  // For LI.FI-aggregated swaps, surface the chosen DEX (e.g. "Uniswap V3") and
  // credit the aggregator; otherwise keep the legacy "via <provider>" label.
  const toolName = (quote.routeMetadata as { toolName?: string } | undefined)?.toolName;
  const contextLabel =
    quote.provider === "lifi" && toolName
      ? `via ${toolName} · aggregated by LI.FI`
      : `via ${quote.provider}`;
  return {
    kind: "swap",
    title: "Confirm swap",
    contextLabel,
    assetDeltas: [
      {
        symbol: quote.sellToken.symbol,
        name: quote.sellToken.name,
        iconAddress: quote.sellToken.type === "erc20" ? quote.sellToken.address : undefined,
        direction: "out",
        amountRaw: quote.sellAmountRaw,
        amountDisplay: sellDisplay,
        chainId: quote.chainId,
        kind: "transfer",
      },
      {
        symbol: quote.buyToken.symbol,
        name: quote.buyToken.name,
        iconAddress: quote.buyToken.type === "erc20" ? quote.buyToken.address : undefined,
        direction: "in",
        amountRaw: quote.estimatedBuyAmountRaw,
        amountDisplay: buyDisplay,
        chainId: quote.chainId,
        kind: "transfer",
      },
    ],
    slippageBps: quote.slippageBps,
    minReceivedDisplay: `${minDisplay} ${quote.buyToken.symbol}`,
    extraNotes: plan.approvalRequired
      ? [`Approve ${quote.sellToken.symbol} first · 2 signatures`]
      : undefined,
    network: { chainId: quote.chainId, networkKey: quote.networkKey, name: networkName },
    account: swapExecution.account,
    calls: [{ to: swapExecution.target, value: swapExecution.value, data: swapExecution.data }],
    requiresPriorApproval: plan.approvalRequired,
  };
}
