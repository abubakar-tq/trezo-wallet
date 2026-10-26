/**
 * LifiClient — thin HTTP wrapper over https://li.quest/v1.
 *
 * Dependency-injects `fetch` so it is unit-testable via `npx tsx` with a fake
 * fetch (the swaps feature has no other HTTP client — this is the first).
 * Runtime imports are relative; the only type import is erased.
 */

import { LIFI_BASE_URL } from "./constants";
import type { LifiQuote, LifiQuoteParams } from "./types";

type LifiClientOptions = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  integrator?: string;
  timeoutMs?: number;
};

export class LifiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LifiError";
    this.status = status;
  }
}

export class LifiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey?: string;
  private readonly integrator?: string;
  private readonly timeoutMs: number;

  constructor(opts: LifiClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.apiKey = opts.apiKey ?? process.env.EXPO_PUBLIC_LIFI_API_KEY;
    this.integrator = opts.integrator ?? process.env.EXPO_PUBLIC_LIFI_INTEGRATOR ?? "trezo";
    this.timeoutMs = opts.timeoutMs ?? 7000;
  }

  private buildUrl(params: LifiQuoteParams): string {
    const q = new URLSearchParams();
    q.set("fromChain", String(params.fromChain));
    q.set("toChain", String(params.toChain));
    q.set("fromToken", params.fromToken);
    q.set("toToken", params.toToken);
    q.set("fromAmount", params.fromAmount);
    q.set("fromAddress", params.fromAddress);
    if (params.toAddress) q.set("toAddress", params.toAddress);
    if (typeof params.slippage === "number") q.set("slippage", String(params.slippage));
    const integrator = params.integrator ?? this.integrator;
    if (integrator) q.set("integrator", integrator);
    return `${LIFI_BASE_URL}/quote?${q.toString()}`;
  }

  async getQuote(params: LifiQuoteParams): Promise<LifiQuote> {
    const url = this.buildUrl(params);
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers["x-lifi-api-key"] = this.apiKey;

    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers, signal: controller?.signal });
    } catch (e) {
      throw new LifiError(`LI.FI request failed: ${(e as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { message?: string };
        detail = body?.message ?? "";
      } catch {
        /* non-JSON error body */
      }
      throw new LifiError(`LI.FI quote failed (${res.status}): ${detail || res.statusText}`, res.status);
    }

    const data = (await res.json()) as LifiQuote;
    if (!data?.transactionRequest?.to || !data?.estimate?.approvalAddress) {
      throw new LifiError("LI.FI quote missing transactionRequest/approvalAddress (no route?).");
    }
    // Output amounts must be plain uint strings — otherwise BigInt() downstream
    // throws a cryptic SyntaxError instead of a clear "no route" failure.
    const isUintString = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
    if (!isUintString(data.estimate.toAmount) || !isUintString(data.estimate.toAmountMin)) {
      throw new LifiError("LI.FI quote returned a malformed output amount.");
    }
    return data;
  }
}
