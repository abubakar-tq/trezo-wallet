/**
 * dexRegistry.ts
 *
 * DEX configuration registry keyed by NetworkKey.
 * Each entry defines which DEX contracts to use and which pools are supported.
 *
 * Philosophy:
 *   - Only explicitly listed pools/pairs can be used.
 *   - Only explicitly listed spenders can receive token approvals.
 *   - No arbitrary addresses are trusted.
 */

import type { NetworkKey } from "@/src/integration/networks";
import type { Address } from "viem";
import { LIFI_DIAMOND } from "../lifi/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DexId = "uniswap_v3";

/** Uniswap V3 fee tier in bps (500 = 0.05%, 3000 = 0.3%, 10000 = 1%). */
export type UniswapV3FeeTier = 500 | 3000 | 10000;

export type DexPoolConfig = {
  sellToken: Address;
  buyToken: Address;
  feeTier: UniswapV3FeeTier;
  /** Known pool address — optional; provider will call factory.getPool() if absent. */
  poolAddress?: Address;
  enabled: boolean;
};

export type DexConfig = {
  networkKey: NetworkKey;
  dexId: DexId;
  label: string;
  factoryAddress: Address;
  quoterAddress: Address;
  routerAddress: Address;
  /** Wrapped native token address (e.g. WETH). Used to route native ETH → ERC20 swaps via the router. */
  wrappedNativeAddress: Address;
  /** Addresses that are allowed to receive ERC20 approvals. */
  trustedSpenders: Address[];
  supportedPools: DexPoolConfig[];
};

// ─── Base Mainnet Addresses ───────────────────────────────────────────────────
// Source: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const BASE_WETH = "0x4200000000000000000000000000000000000006" as Address;

const UNISWAP_V3_FACTORY_BASE = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address;
const UNISWAP_QUOTER_V2_BASE = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as Address;
const UNISWAP_SWAP_ROUTER02_BASE = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;
// Uniswap V2 on Base — verify: cast code 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24 --rpc-url $FORK_RPC_URL
const UNISWAP_V2_ROUTER_BASE = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" as Address;
// LI.FI Diamond (deterministic across chains incl. Base). Token approvals for
// LI.FI-routed swaps target this address (= estimate.approvalAddress). ADR 0014.
// Single source of truth lives in lifi/constants.ts.
const LIFI_DIAMOND_BASE = LIFI_DIAMOND;

// ─── Sepolia Addresses ────────────────────────────────────────────────────────
// Uniswap V3 testnet deployments. Verify before mainnet rollout.
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;
// Router-canonical Sepolia WETH: matches SwapRouter02.WETH9 immutable so
// the router's pay() takes the auto-wrap-from-ETH branch. Verified on-chain.
const SEPOLIA_WETH = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14" as Address;
const UNISWAP_V3_FACTORY_SEPOLIA = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c" as Address;
const UNISWAP_QUOTER_V2_SEPOLIA = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3" as Address;
const UNISWAP_SWAP_ROUTER02_SEPOLIA = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E" as Address;

// ─── Base Sepolia Addresses ───────────────────────────────────────────────────
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const BASE_SEPOLIA_WETH = "0x4200000000000000000000000000000000000006" as Address;
const BASE_SEPOLIA_LINK = "0xE4aB69C077896252FAFBD49EFD26B5D171A32410" as Address;
const UNISWAP_V3_FACTORY_BASE_SEPOLIA = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" as Address;
const UNISWAP_QUOTER_V2_BASE_SEPOLIA = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27" as Address;
const UNISWAP_SWAP_ROUTER02_BASE_SEPOLIA = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as Address;

// ─── Arbitrum Sepolia Addresses ───────────────────────────────────────────────
const ARB_SEPOLIA_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address;
const ARB_SEPOLIA_WETH = "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" as Address;
const UNISWAP_V3_FACTORY_ARB_SEPOLIA = "0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e" as Address;
const UNISWAP_QUOTER_V2_ARB_SEPOLIA = "0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B" as Address;
const UNISWAP_SWAP_ROUTER02_ARB_SEPOLIA = "0x101F443B4d1b059569D643917553c771E1b9663E" as Address;

// ─── Registry ─────────────────────────────────────────────────────────────────

const DEX_CONFIGS: Partial<Record<NetworkKey, DexConfig>> = {
  "ethereum-sepolia": {
    networkKey: "ethereum-sepolia",
    dexId: "uniswap_v3",
    label: "Uniswap V3 on Sepolia",
    factoryAddress: UNISWAP_V3_FACTORY_SEPOLIA,
    quoterAddress: UNISWAP_QUOTER_V2_SEPOLIA,
    routerAddress: UNISWAP_SWAP_ROUTER02_SEPOLIA,
    wrappedNativeAddress: SEPOLIA_WETH,
    trustedSpenders: [UNISWAP_SWAP_ROUTER02_SEPOLIA],
    supportedPools: [
      // 500-bps tier has the deepest liquidity on Sepolia by orders of
      // magnitude (verified 2026-05-29: ~56T units vs ~872B at 3000 vs
      // ~4.4B at 10000). Address pinned to skip the factory roundtrip.
      // 500-bps pool on router-canonical WETH. Verified on-chain
      // (2026-05-29): ~16.6 quintillion units of liquidity, ~295x deeper
      // than the same tier on the old-WETH pool.
      {
        sellToken: SEPOLIA_USDC,
        buyToken: SEPOLIA_WETH,
        feeTier: 500,
        poolAddress: "0x3289680dd4d6c10bb19b899729cda5eef58aeff1" as Address,
        enabled: true,
      },
      {
        sellToken: SEPOLIA_WETH,
        buyToken: SEPOLIA_USDC,
        feeTier: 500,
        poolAddress: "0x3289680dd4d6c10bb19b899729cda5eef58aeff1" as Address,
        enabled: true,
      },
    ],
  },
  "base-sepolia": {
    networkKey: "base-sepolia",
    dexId: "uniswap_v3",
    label: "Uniswap V3 on Base Sepolia",
    factoryAddress: UNISWAP_V3_FACTORY_BASE_SEPOLIA,
    quoterAddress: UNISWAP_QUOTER_V2_BASE_SEPOLIA,
    routerAddress: UNISWAP_SWAP_ROUTER02_BASE_SEPOLIA,
    wrappedNativeAddress: BASE_SEPOLIA_WETH,
    trustedSpenders: [UNISWAP_SWAP_ROUTER02_BASE_SEPOLIA],
    supportedPools: [
      // 3000 bps tier has the most liquidity on Base Sepolia (verified via swap-healthcheck).
      // 500 bps and 10000 bps pools exist but have ~10^9x less liquidity.
      {
        sellToken: BASE_SEPOLIA_USDC,
        buyToken: BASE_SEPOLIA_WETH,
        feeTier: 3000,
        poolAddress: "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad" as Address,
        enabled: true,
      },
      {
        sellToken: BASE_SEPOLIA_WETH,
        buyToken: BASE_SEPOLIA_USDC,
        feeTier: 3000,
        poolAddress: "0x46880b404CD35c165EDdefF7421019F8dD25F4Ad" as Address,
        enabled: true,
      },
      // LINK / WETH 3000 bps pool on Base Sepolia — verified on-chain to have
      // real liquidity (probe 2026-05-29). 10000 bps tier also exists with
      // deeper liquidity but 3000 is fine for demo-sized swaps.
      {
        sellToken: BASE_SEPOLIA_WETH,
        buyToken: BASE_SEPOLIA_LINK,
        feeTier: 3000,
        poolAddress: "0x78c470050f092ff228329c5267feda8a03d14d93" as Address,
        enabled: true,
      },
      {
        sellToken: BASE_SEPOLIA_LINK,
        buyToken: BASE_SEPOLIA_WETH,
        feeTier: 3000,
        poolAddress: "0x78c470050f092ff228329c5267feda8a03d14d93" as Address,
        enabled: true,
      },
    ],
  },
  "arbitrum-sepolia": {
    networkKey: "arbitrum-sepolia",
    dexId: "uniswap_v3",
    label: "Uniswap V3 on Arbitrum Sepolia",
    factoryAddress: UNISWAP_V3_FACTORY_ARB_SEPOLIA,
    quoterAddress: UNISWAP_QUOTER_V2_ARB_SEPOLIA,
    routerAddress: UNISWAP_SWAP_ROUTER02_ARB_SEPOLIA,
    wrappedNativeAddress: ARB_SEPOLIA_WETH,
    trustedSpenders: [UNISWAP_SWAP_ROUTER02_ARB_SEPOLIA],
    supportedPools: [
      { sellToken: ARB_SEPOLIA_USDC, buyToken: ARB_SEPOLIA_WETH, feeTier: 500, enabled: true },
      { sellToken: ARB_SEPOLIA_WETH, buyToken: ARB_SEPOLIA_USDC, feeTier: 500, enabled: true },
    ],
  },
  "base-mainnet-fork": {
    networkKey: "base-mainnet-fork",
    dexId: "uniswap_v3",
    label: "Uniswap V3 on Base Fork",
    factoryAddress: UNISWAP_V3_FACTORY_BASE,
    quoterAddress: UNISWAP_QUOTER_V2_BASE,
    routerAddress: UNISWAP_SWAP_ROUTER02_BASE,
    wrappedNativeAddress: BASE_WETH,
    trustedSpenders: [UNISWAP_SWAP_ROUTER02_BASE, UNISWAP_V2_ROUTER_BASE, LIFI_DIAMOND_BASE],
    supportedPools: [
      {
        sellToken: BASE_USDC,
        buyToken: BASE_WETH,
        feeTier: 500,
        // Hardcoded to skip the factory.getPool() round-trip to the remote RPC
        poolAddress: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59" as Address,
        enabled: true,
      },
      {
        sellToken: BASE_WETH,
        buyToken: BASE_USDC,
        feeTier: 500,
        poolAddress: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59" as Address,
        enabled: true,
      },
    ],
  },
  "base-mainnet": {
    networkKey: "base-mainnet",
    dexId: "uniswap_v3",
    label: "Uniswap V3 on Base",
    factoryAddress: UNISWAP_V3_FACTORY_BASE,
    quoterAddress: UNISWAP_QUOTER_V2_BASE,
    routerAddress: UNISWAP_SWAP_ROUTER02_BASE,
    wrappedNativeAddress: BASE_WETH,
    trustedSpenders: [UNISWAP_SWAP_ROUTER02_BASE, UNISWAP_V2_ROUTER_BASE, LIFI_DIAMOND_BASE],
    supportedPools: [
      {
        sellToken: BASE_USDC,
        buyToken: BASE_WETH,
        feeTier: 500,
        poolAddress: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59" as Address,
        enabled: true,
      },
      {
        sellToken: BASE_WETH,
        buyToken: BASE_USDC,
        feeTier: 500,
        poolAddress: "0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59" as Address,
        enabled: true,
      },
    ],
  },
};

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/** Returns the DexConfig for the given networkKey, or undefined if not configured. */
export const getDexConfig = (networkKey: NetworkKey): DexConfig | undefined =>
  DEX_CONFIGS[networkKey];

/** Returns all trusted spenders for the given networkKey across all DEX configs. */
export const getTrustedSpendersForNetwork = (networkKey: NetworkKey): Address[] => {
  const config = DEX_CONFIGS[networkKey];
  return config?.trustedSpenders ?? [];
};

/** Returns true if the given spender is trusted for the given networkKey. */
export const isTrustedSpenderForNetwork = (networkKey: NetworkKey, spender: Address): boolean => {
  const trusted = getTrustedSpendersForNetwork(networkKey).map((a) => a.toLowerCase());
  return trusted.includes(spender.toLowerCase());
};

/**
 * Returns the DexPoolConfig for the given pair, or undefined if not found.
 * Address comparison is case-insensitive.
 */
export const getPoolConfig = (
  networkKey: NetworkKey,
  sellToken: Address,
  buyToken: Address
): DexPoolConfig | undefined => {
  const config = DEX_CONFIGS[networkKey];
  if (!config) return undefined;

  return config.supportedPools.find(
    (pool) =>
      pool.enabled &&
      pool.sellToken.toLowerCase() === sellToken.toLowerCase() &&
      pool.buyToken.toLowerCase() === buyToken.toLowerCase()
  );
};
