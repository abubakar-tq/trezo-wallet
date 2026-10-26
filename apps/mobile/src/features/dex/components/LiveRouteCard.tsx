/**
 * LiveRouteCard
 *
 * Read-only "live aggregator route" banner. On a LI.FI (mainnet) network it
 * queries the live LI.FI /quote API for the current inputs and shows the chosen
 * DEX/bridge + estimated output. Needs no funds, no contracts, no RPC — pure
 * LI.FI API. This is the FR-06/FR-07 proof surfaced from the phone (TC-06/07).
 *
 * Returns null on non-LI.FI networks, so testnet is unaffected.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "@theme";
import { formatUnits, parseUnits, type Address } from "viem";

import type { TokenMetadata } from "@/src/features/assets/types/token";
import type { NetworkKey } from "@/src/integration/networks";
import {
  isLifiNetwork,
  lifiChainIdForNetwork,
  LIFI_NATIVE_ADDRESS,
} from "@/src/features/swaps/lifi/constants";
import { LifiClient } from "@/src/features/swaps/lifi/LifiClient";

const client = new LifiClient();

const lifiAddr = (t: TokenMetadata): string => (t.type === "native" ? LIFI_NATIVE_ADDRESS : t.address);

type Props = {
  mode: "swap" | "bridge";
  networkKey: NetworkKey;
  account: Address | null;
  sellToken: TokenMetadata | null;
  buyToken: TokenMetadata | null;
  sellAmountDecimal: string;
  slippageBps: number;
  destNetworkKey?: NetworkKey | null;
  destOutputToken?: TokenMetadata | null;
};

export const LiveRouteCard: React.FC<Props> = (props) => {
  const { theme } = useAppTheme();
  const { colors } = theme;

  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [outDisplay, setOutDisplay] = useState<string | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = isLifiNetwork(props.networkKey);
  const toToken = props.mode === "swap" ? props.buyToken : props.destOutputToken ?? null;
  const destOk = props.mode === "swap" || Boolean(props.destNetworkKey);

  const amountRaw = useMemo(() => {
    if (!props.sellToken || !props.sellAmountDecimal.trim()) return null;
    try {
      return parseUnits(props.sellAmountDecimal.trim(), props.sellToken.decimals);
    } catch {
      return null;
    }
  }, [props.sellAmountDecimal, props.sellToken]);

  useEffect(() => {
    if (!enabled || !destOk || !props.account || !props.sellToken || !toToken || !amountRaw || amountRaw <= 0n) {
      setLabel(null);
      setOutDisplay(null);
      setEtaSeconds(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const fromChain = lifiChainIdForNetwork(props.networkKey);
        const toChain =
          props.mode === "bridge" && props.destNetworkKey
            ? lifiChainIdForNetwork(props.destNetworkKey)
            : fromChain;
        const q = await client.getQuote({
          fromChain,
          toChain,
          fromToken: lifiAddr(props.sellToken!),
          toToken: lifiAddr(toToken!),
          fromAmount: amountRaw!.toString(),
          fromAddress: props.account!,
          slippage: props.slippageBps / 10_000,
        });
        if (cancelled) return;
        setLabel(q.toolDetails?.name ?? q.tool);
        setOutDisplay(`${formatUnits(BigInt(q.estimate.toAmount), toToken!.decimals)} ${toToken!.symbol}`);
        setEtaSeconds(typeof q.estimate.executionDuration === "number" ? q.estimate.executionDuration : null);
      } catch (e) {
        if (cancelled) return;
        setLabel(null);
        setOutDisplay(null);
        setEtaSeconds(null);
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    enabled,
    destOk,
    props.account,
    props.sellToken,
    toToken,
    amountRaw,
    props.networkKey,
    props.destNetworkKey,
    props.slippageBps,
    props.mode,
  ]);

  if (!enabled) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceCard, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, { color: colors.textMuted }]}>LIVE AGGREGATOR ROUTE · LI.FI</Text>
        {loading && <ActivityIndicator size="small" color={colors.accent} />}
      </View>
      {label && outDisplay && (
        <Text style={[styles.body, { color: colors.textPrimary }]}>
          Best route via <Text style={{ fontWeight: "700" }}>{label}</Text> · est. {outDisplay}
          {etaSeconds != null ? ` · ~${etaSeconds}s` : ""}
        </Text>
      )}
      {!label && !loading && !error && (
        <Text style={[styles.muted, { color: colors.textMuted }]}>Enter an amount to fetch a live route.</Text>
      )}
      {error && (
        <Text style={[styles.muted, { color: colors.warning }]} numberOfLines={2}>
          No live route: {error}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12, gap: 6 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  body: { fontSize: 14 },
  muted: { fontSize: 12 },
});
