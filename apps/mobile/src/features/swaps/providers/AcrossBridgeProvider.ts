/**
 * AcrossBridgeProvider — thin adapter that exposes the EXISTING Across path
 * (BridgeQuoteService) through the BridgeRouteProvider interface. It does NOT
 * reimplement Across logic; it calls the existing service and normalizes the
 * result. Across execution stays on BridgePreparationService unchanged, so the
 * testnet bridge demo is untouched (ADR 0007 stands for testnet).
 */

import { BridgeQuoteService } from "../services/BridgeQuoteService";
import { isLifiNetwork } from "../lifi/constants";
import type { BridgeRouteProvider, BridgeRouteRequest, BridgeRouteQuote } from "./BridgeRouteProvider";

export class AcrossBridgeProvider implements BridgeRouteProvider {
  readonly id = "across_v3";
  readonly label = "Across V3 (Trezo)";

  supportsRoute(req: BridgeRouteRequest): boolean {
    // Across serves the non-LI.FI (testnet) keys that have a SpokePool configured.
    return !isLifiNetwork(req.sourceNetworkKey);
  }

  async getRoute(req: BridgeRouteRequest): Promise<BridgeRouteQuote> {
    const q = await BridgeQuoteService.getQuote({
      sourceNetworkKey: req.sourceNetworkKey,
      sourceChainId: req.sourceChainId,
      destNetworkKey: req.destNetworkKey,
      destChainId: req.destChainId,
      account: req.account,
      destAccount: req.destAccount,
      inputToken: req.inputToken,
      outputToken: req.outputToken,
      inputAmountRaw: req.inputAmountRaw,
      destSwapSlippageBps: req.slippageBps,
    });

    const estimatedOutRaw = q.destSwap ? q.destSwap.expectedOutRaw : q.outputAmountRaw;
    const minOutRaw = q.destSwap ? q.destSwap.minOutRaw : q.outputAmountRaw;

    return {
      provider: this.id,
      routeLabel: "Across V3",
      inputToken: q.inputToken,
      outputToken: q.outputToken,
      inputAmountRaw: q.inputAmountRaw,
      estimatedOutRaw,
      minOutRaw,
      feeBps: q.feeBps,
      // No execution fields — Across executes via the existing BridgePreparationService path.
      routeMetadata: { bridgeId: "across_v3", destSwapRequired: q.destSwapRequired },
    };
  }
}
