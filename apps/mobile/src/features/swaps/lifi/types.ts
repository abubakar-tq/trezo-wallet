/**
 * LI.FI REST API types — the subset of GET /v1/quote we consume.
 * Field names verified against official LI.FI docs (2026-06-02).
 */

export type LifiToken = {
  address: string;
  chainId: number;
  symbol: string;
  decimals: number;
  name: string;
  priceUSD?: string;
};

export type LifiToolDetails = { key: string; name: string; logoURI?: string };

export type LifiFeeCost = {
  name: string;
  amount: string;
  amountUSD?: string;
  percentage?: string;
  included?: boolean;
};

export type LifiGasCost = {
  type: string;
  amount: string;
  amountUSD?: string;
  token?: LifiToken;
};

export type LifiEstimate = {
  tool: string;
  /** Token-approval target (the LiFi Diamond). */
  approvalAddress: string;
  toAmount: string;
  toAmountMin: string;
  fromAmount: string;
  feeCosts?: LifiFeeCost[];
  gasCosts?: LifiGasCost[];
  executionDuration?: number;
  fromAmountUSD?: string;
  toAmountUSD?: string;
};

export type LifiTransactionRequest = {
  to: string;
  data: string;
  value?: string; // hex
  from?: string;
  chainId?: number;
  gasPrice?: string; // hex
  gasLimit?: string; // hex
};

export type LifiAction = {
  fromToken: LifiToken;
  toToken: LifiToken;
  fromChainId: number;
  toChainId: number;
  fromAmount: string;
  slippage: number;
  fromAddress?: string;
  toAddress?: string;
};

/** GET /v1/quote success body. */
export type LifiQuote = {
  type: string;
  id?: string;
  tool: string;
  toolDetails: LifiToolDetails;
  action: LifiAction;
  estimate: LifiEstimate;
  includedSteps?: unknown[];
  integrator?: string;
  transactionRequest: LifiTransactionRequest;
  transactionId?: string;
};

export type LifiQuoteParams = {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  /** Decimal fraction (0.005 = 0.5%). */
  slippage?: number;
  integrator?: string;
};
