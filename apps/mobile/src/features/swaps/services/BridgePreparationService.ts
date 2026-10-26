/**
 * BridgePreparationService.ts
 *
 * Prepares a complete BridgePlan from a BridgeIntent. Mirrors
 * SwapPreparationService but builds an Across V3 SpokePool.depositV3 call
 * carrying an encoded Trezo BridgeMessage payload that the destination-chain
 * CrossChainExecutor will decode (see ADR 0007).
 */

import { BalanceService } from "@/src/features/assets/services/BalanceService";
import { TokenRegistryService } from "@/src/features/assets/services/TokenRegistryService";
import type { TokenMetadata } from "@/src/features/assets/types/token";
import { AllowanceService } from "@/src/features/swaps/services/AllowanceService";
import { BridgeQuoteService } from "@/src/features/swaps/services/BridgeQuoteService";
import {
  findBridgeOutputToken,
  findBridgeRoute,
  getBridgeConfig,
} from "@/src/features/swaps/config/bridgeRegistry";
import type {
  BridgeIntent,
  BridgePlan,
  BridgeWarning,
} from "@/src/features/swaps/types/bridge";
import type { CreateWalletTransactionInput } from "@/src/features/transactions";
import WalletPersistenceService from "@/src/features/wallet/services/SupabaseWalletService";
import { getNetworkConfig } from "@/src/integration/networks";
import {
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

// ─── ABIs ────────────────────────────────────────────────────────────────────

const SPOKE_POOL_ABI = [
  {
    type: "function",
    name: "depositV3",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "address" },
      { name: "recipient", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "address" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "fillDeadline", type: "uint32" },
      { name: "exclusivityDeadline", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ensureKnownToken = (networkKey: BridgeIntent["sourceNetworkKey"], token: TokenMetadata): TokenMetadata =>
  TokenRegistryService.assertTokenOnNetwork(networkKey, token);

const ensureWalletConsistency = async (
  intent: BridgeIntent,
  walletService: WalletPersistenceService,
): Promise<void> => {
  let wallet = null;
  try {
    wallet = await walletService.getAAWalletForNetwork?.(intent.userId, intent.sourceNetworkKey);
  } catch {
    // Method may not exist yet
  }
  if (!wallet) {
    wallet = await walletService.getAAWalletForChain(intent.userId, intent.sourceChainId);
  }

  if (!wallet) {
    throw new Error(`No smart account wallet found for source network ${intent.sourceNetworkKey}.`);
  }

  if (wallet.id !== intent.aaWalletId) {
    throw new Error("Bridge intent wallet does not match the user's wallet for this network.");
  }

  if (!wallet.is_deployed) {
    throw new Error("Smart account is not deployed on this network.");
  }

  if (wallet.predicted_address.toLowerCase() !== intent.walletAddress.toLowerCase()) {
    throw new Error("Bridge intent wallet address does not match wallet metadata.");
  }
};

/**
 * Encode the BridgeMessage struct consumed by CrossChainExecutor on the
 * destination chain:
 *
 *   abi.decode(message, (address, address, uint256, uint24, uint256))
 *      = (recipient, buyToken, minOut, feeTier, deadline)
 */
const encodeBridgeMessage = (params: {
  recipient: Address;
  buyToken: Address;
  minOut: bigint;
  feeTier: number;
  deadline: number;
}): Hex =>
  encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint24" },
      { type: "uint256" },
    ],
    [
      params.recipient,
      params.buyToken,
      params.minOut,
      params.feeTier,
      BigInt(params.deadline),
    ],
  );

const toApprovalDraftInput = (intent: BridgeIntent, data: {
  spender: Address;
  token: TokenMetadata;
  amountRaw: bigint;
  calldata: Hex;
}): CreateWalletTransactionInput => ({
  userId: intent.userId,
  aaWalletId: intent.aaWalletId,
  walletAddress: intent.walletAddress,
  chainId: intent.sourceChainId,
  networkKey: intent.sourceNetworkKey,
  type: "token_approval",
  direction: "outgoing",
  tokenType: "erc20",
  tokenAddress: data.token.type === "erc20" ? data.token.address : null,
  tokenSymbol: data.token.symbol,
  tokenDecimals: data.token.decimals,
  fromAddress: intent.walletAddress,
  toAddress: data.spender,
  targetAddress: data.token.type === "erc20" ? data.token.address : null,
  valueRaw: "0",
  calldata: data.calldata,
  amountRaw: data.amountRaw.toString(),
  amountDisplay: formatUnits(data.amountRaw, data.token.decimals),
  metadata: {
    spender: data.spender,
    approvalType: "exact",
    purpose: "bridge",
  },
});

const toBridgeDraftInput = (intent: BridgeIntent, data: {
  target: Address;
  calldata: Hex;
  inputAmountRaw: bigint;
  outputAmountRaw: bigint;
  metadata: Record<string, unknown>;
}): CreateWalletTransactionInput => ({
  userId: intent.userId,
  aaWalletId: intent.aaWalletId,
  walletAddress: intent.walletAddress,
  chainId: intent.sourceChainId,
  networkKey: intent.sourceNetworkKey,
  type: "bridge",
  direction: "outgoing",
  tokenType: intent.inputToken.type,
  tokenAddress: intent.inputToken.type === "erc20" ? intent.inputToken.address : null,
  tokenSymbol: intent.inputToken.symbol,
  tokenDecimals: intent.inputToken.decimals,
  fromAddress: intent.walletAddress,
  toAddress: data.target,
  targetAddress: data.target,
  valueRaw: "0",
  calldata: data.calldata,
  amountRaw: data.inputAmountRaw.toString(),
  amountDisplay: formatUnits(data.inputAmountRaw, intent.inputToken.decimals),
  metadata: data.metadata,
});

export class BridgePreparationService {
  private static readonly walletService = new WalletPersistenceService();

  static async prepareBridge(intent: BridgeIntent): Promise<BridgePlan> {
    // ── 1. Validate networks ──────────────────────────────────────────────────
    const sourceNetwork = getNetworkConfig(intent.sourceNetworkKey);
    if (!sourceNetwork.isEnabled) {
      throw new Error(`Source network ${sourceNetwork.displayName} is disabled.`);
    }
    if (sourceNetwork.chainId !== intent.sourceChainId) {
      throw new Error(
        `Source chainId (${intent.sourceChainId}) does not match network chainId (${sourceNetwork.chainId}).`,
      );
    }

    const destNetwork = getNetworkConfig(intent.destNetworkKey);
    if (!destNetwork.isEnabled) {
      throw new Error(`Destination network ${destNetwork.displayName} is disabled.`);
    }
    if (destNetwork.chainId !== intent.destChainId) {
      throw new Error(
        `Destination chainId (${intent.destChainId}) does not match network chainId (${destNetwork.chainId}).`,
      );
    }

    // Source side: SpokePool required. Executor is only checked downstream
    // when a destination-side swap is needed (see BridgeQuoteService).
    const sourceBridge = getBridgeConfig(intent.sourceNetworkKey);
    if (!sourceBridge?.spokePool) {
      throw new Error(`No Across SpokePool configured for source ${intent.sourceNetworkKey}.`);
    }

    // Route + token-pair must be allowlisted.
    const route = findBridgeRoute(intent.sourceNetworkKey, intent.destNetworkKey);
    if (!route) {
      throw new Error(
        `No allowlisted bridge route ${intent.sourceNetworkKey} -> ${intent.destNetworkKey}.`,
      );
    }

    // ── 2. Validate wallet ────────────────────────────────────────────────────
    await ensureWalletConsistency(intent, this.walletService);

    // ── 3. Validate tokens ────────────────────────────────────────────────────
    if (intent.inputToken.chainId !== intent.sourceChainId) {
      throw new Error("Input token chainId does not match source chainId.");
    }
    if (intent.outputToken.chainId !== intent.destChainId) {
      throw new Error("Output token chainId does not match destination chainId.");
    }

    const inputToken = ensureKnownToken(intent.sourceNetworkKey, intent.inputToken);
    const outputToken = ensureKnownToken(intent.destNetworkKey, intent.outputToken);

    if (inputToken.type !== "erc20") {
      throw new Error("Bridge currently only supports ERC20 inputs.");
    }
    if (outputToken.type !== "erc20") {
      throw new Error("Bridge currently only supports ERC20 outputs.");
    }

    if (!Number.isInteger(intent.slippageBps) || intent.slippageBps <= 0 || intent.slippageBps > 5_000) {
      throw new Error("Slippage must be an integer between 1 and 5000 bps.");
    }

    // ── 4. Check input amount and balance ─────────────────────────────────────
    const inputAmountRaw = parseUnits(intent.inputAmountDecimal, inputToken.decimals);
    if (inputAmountRaw <= 0n) {
      throw new Error("Input amount must be greater than zero.");
    }

    const sourceBalanceRaw = await BalanceService.getBalance({
      chainId: intent.sourceChainId,
      walletAddress: intent.walletAddress,
      token: inputToken,
    });

    if (sourceBalanceRaw < inputAmountRaw) {
      throw new Error("Insufficient input token balance on source chain.");
    }

    // ── 5. Get quote ──────────────────────────────────────────────────────────
    const quote = await BridgeQuoteService.getQuote({
      sourceNetworkKey: intent.sourceNetworkKey,
      sourceChainId: intent.sourceChainId,
      destNetworkKey: intent.destNetworkKey,
      destChainId: intent.destChainId,
      account: intent.walletAddress,
      destAccount: intent.destWalletAddress,
      inputToken,
      outputToken,
      inputAmountRaw,
      destSwapSlippageBps: intent.slippageBps,
    });

    if (quote.destSwapRequired && !quote.destSwap) {
      // BridgeQuoteService should always attach destSwap when destSwapRequired.
      // This branch is a defensive guard against the service returning
      // inconsistent state — surface it loudly rather than encoding zeros.
      throw new Error("Bridge quote marked destSwapRequired but produced no destination-side swap quote.");
    }

    // ── 6. Encode BridgeMessage + depositV3 calldata ──────────────────────────
    // Same-asset bridge: recipient is the user wallet itself, message is empty.
    // Cross-chain swap: recipient is the executor and message carries
    // (recipient, buyToken, minOut, feeTier, deadline) for it to decode.
    const bridgeMessage: Hex = quote.destSwapRequired
      ? encodeBridgeMessage({
          // Recipient on the DESTINATION chain - the wallet that should
          // receive the executor's swapped tokens. Falls back to source
          // address (deterministic match on portable chains).
          recipient: intent.destWalletAddress,
          buyToken: outputToken.address as Address,
          minOut: quote.destSwap!.minOutRaw,
          feeTier: quote.destSwap!.feeTier,
          deadline: quote.destSwap!.deadlineSec,
        })
      : "0x";

    // Across delivers the CANONICAL destination token (the input token's equivalent
    // on the dest chain), per the bridgeRegistry design note. For same-asset bridges
    // this equals outputToken; for a cross-chain swap the executor receives the
    // canonical token and swaps it to the user's desired outputToken (carried in
    // bridgeMessage.buyToken). Passing the desired token here would (a) ask Across for
    // a cross-asset route it isn't configured for and (b) make the executor's
    // `buyToken == tokenSent` short-circuit skip the swap entirely.
    const canonicalOutputToken = findBridgeOutputToken(
      intent.sourceNetworkKey,
      intent.destNetworkKey,
      inputToken.address as Address,
    );
    if (!canonicalOutputToken) {
      throw new Error(
        `No canonical bridge output token for ${inputToken.symbol} on ${intent.sourceNetworkKey} -> ${intent.destNetworkKey}.`,
      );
    }

    const depositCalldata = encodeFunctionData({
      abi: SPOKE_POOL_ABI,
      functionName: "depositV3",
      args: [
        intent.walletAddress, // depositor
        quote.destRecipient, // user wallet (same-asset) or executor (cross-chain swap)
        inputToken.address as Address,
        canonicalOutputToken, // canonical dest token Across delivers (NOT the user's desired token)
        quote.inputAmountRaw,
        quote.outputAmountRaw,
        BigInt(intent.destChainId),
        quote.exclusiveRelayer,
        quote.quoteTimestamp,
        quote.fillDeadline,
        quote.exclusivityDeadline,
        bridgeMessage,
      ],
    }) as Hex;

    // ── 7. Check allowance (SpokePool is the spender) ─────────────────────────
    const allowanceCheck = await AllowanceService.isApprovalRequired({
      token: inputToken,
      sellAmountRaw: inputAmountRaw,
      owner: intent.walletAddress,
      spender: quote.spokePool,
      chainId: intent.sourceChainId,
      networkKey: intent.sourceNetworkKey,
    });

    let approvalExecution = undefined;
    let approvalTransactionInput = undefined;

    if (allowanceCheck.required) {
      const prepared = AllowanceService.prepareApprovalExecution({
        chainId: intent.sourceChainId,
        networkKey: intent.sourceNetworkKey,
        account: intent.walletAddress,
        token: inputToken,
        spender: quote.spokePool,
        amountRaw: inputAmountRaw,
      });
      approvalExecution = prepared;
      approvalTransactionInput = toApprovalDraftInput(intent, {
        spender: quote.spokePool,
        token: inputToken,
        amountRaw: inputAmountRaw,
        calldata: prepared.data,
      });
    }

    const destSwapMetadata = quote.destSwap
      ? {
          canonicalToken: quote.destSwap.canonicalToken.address,
          expectedOutRaw: quote.destSwap.expectedOutRaw.toString(),
          minOutRaw: quote.destSwap.minOutRaw.toString(),
          feeTier: quote.destSwap.feeTier,
          poolAddress: quote.destSwap.poolAddress,
          slippageBps: quote.destSwap.slippageBps,
          deadlineSec: quote.destSwap.deadlineSec,
        }
      : null;

    const bridgeExecution = {
      chainId: intent.sourceChainId,
      networkKey: intent.sourceNetworkKey,
      account: intent.walletAddress,
      target: quote.spokePool,
      value: 0n,
      data: depositCalldata,
      operationLabel: "bridge",
      riskLevel: "medium" as const,
      metadata: {
        quoteId: quote.quoteId,
        bridgeId: "across_v3",
        sourceNetworkKey: intent.sourceNetworkKey,
        destNetworkKey: intent.destNetworkKey,
        destRecipient: quote.destRecipient,
        destExecutor: quote.destExecutor ?? null,
        destSwapRequired: quote.destSwapRequired,
        destSwap: destSwapMetadata,
        inputToken: inputToken.address,
        outputToken: outputToken.address,
        inputAmountRaw: quote.inputAmountRaw.toString(),
        outputAmountRaw: quote.outputAmountRaw.toString(),
        fillDeadline: quote.fillDeadline,
      },
    };

    const bridgeTransactionInput = toBridgeDraftInput(intent, {
      target: quote.spokePool,
      calldata: depositCalldata,
      inputAmountRaw,
      outputAmountRaw: quote.outputAmountRaw,
      metadata: {
        bridgeId: "across_v3",
        quoteId: quote.quoteId,
        sourceNetworkKey: intent.sourceNetworkKey,
        destNetworkKey: intent.destNetworkKey,
        destChainId: intent.destChainId,
        inputToken: inputToken,
        outputToken: outputToken,
        inputAmountRaw: quote.inputAmountRaw.toString(),
        outputAmountRaw: quote.outputAmountRaw.toString(),
        feeBps: quote.feeBps,
        spokePool: quote.spokePool,
        destRecipient: quote.destRecipient,
        destExecutor: quote.destExecutor ?? null,
        destSwapRequired: quote.destSwapRequired,
        destSwap: destSwapMetadata,
        fillDeadline: quote.fillDeadline,
        quoteTimestamp: quote.quoteTimestamp,
      },
    });

    const warnings: BridgeWarning[] = [];
    if (allowanceCheck.required) {
      warnings.push({
        code: "approval_required",
        level: "info",
        message: `Approval required for ${inputToken.symbol} before bridge.`,
      });
    }

    if (quote.destSwap) {
      const expectedOutDisplay = formatUnits(quote.destSwap.expectedOutRaw, outputToken.decimals);
      const minOutDisplay = formatUnits(quote.destSwap.minOutRaw, outputToken.decimals);
      warnings.push({
        code: "destination_swap",
        level: "warning",
        message:
          `Destination-side swap will run on ${intent.destNetworkKey}: expected `
          + `~${expectedOutDisplay} ${outputToken.symbol} `
          + `(min ${minOutDisplay} @ ${quote.destSwap.slippageBps} bps slippage). `
          + `If the swap reverts on destination, the executor refunds the canonical bridged token to your wallet.`,
      });
    }

    return {
      intent: { ...intent, inputToken, outputToken },
      quote,
      sourceBalanceRaw,
      currentAllowanceRaw: allowanceCheck.allowanceRaw,
      approvalRequired: allowanceCheck.required,
      approvalExecution,
      bridgeExecution,
      approvalTransactionInput,
      bridgeTransactionInput,
      bridgeMessage,
      warnings,
      quotedAt: Date.now(),
    };
  }
}
