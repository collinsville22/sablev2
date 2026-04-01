import { TOKENS, VESU_POOLS, DEFILLAMA_POOL_IDS, VAULT_STRATEGIES, SABLE_CONTRACTS } from "../constants";
import type { VaultStrategy, RiskLevel } from "../constants";
import { fetchVesuWbtcData, fetchVesuUsdcData, fetchVesuXwbtcBtcFi } from "./vesu";
import { fetchStarknetBtcPools, fetchPoolChart } from "./defillama";
import { fetchBtcPrice } from "./price";
import { fetchVaultOnChainTvl } from "./onchain";
import type { PerformanceDataPoint } from "../types";

export interface StrategyBreakdownItem {
  label: string;
  value: number;
  type: "earn" | "cost" | "reward" | "net";
}

export interface VaultConfig {
  id: string;
  name: string;
  strategy: VaultStrategy;
  riskLevel: RiskLevel;
  description: string;
  curator: { name: string };
  contractAddress: string;
}

export const VAULT_CONFIGS: VaultConfig[] = [
  {
    id: "sentinel",
    name: "Sable Sentinel",
    strategy: VAULT_STRATEGIES.LENDING,
    riskLevel: 1,
    description: "WBTC lending on Vesu PRIME — simplest yield, lowest risk",
    curator: { name: "Sable" },
    contractAddress: SABLE_CONTRACTS.SENTINEL,
  },
  {
    id: "citadel",
    name: "Sable Citadel",
    strategy: VAULT_STRATEGIES.DUAL_LENDING,
    riskLevel: 2,
    description: "Staked BTC lending — Endur xWBTC staking + Vesu BTCFi rewards",
    curator: { name: "Sable" },
    contractAddress: SABLE_CONTRACTS.CITADEL,
  },
  {
    id: "trident",
    name: "Sable Trident",
    strategy: VAULT_STRATEGIES.LP_PROVISION,
    riskLevel: 3,
    description: "Looped BTC staking — Endur + Vesu recursive loop for amplified yield",
    curator: { name: "Sable" },
    contractAddress: SABLE_CONTRACTS.TRIDENT,
  },
  {
    id: "delta-neutral",
    name: "Sable Delta Neutral",
    strategy: VAULT_STRATEGIES.DELTA_NEUTRAL,
    riskLevel: 4,
    description: "BTC-USDC yield spread — supply WBTC, borrow USDC, deploy stablecoin yield",
    curator: { name: "Sable" },
    contractAddress: SABLE_CONTRACTS.DELTA_NEUTRAL,
  },
  {
    id: "turbo",
    name: "Sable Turbo",
    strategy: VAULT_STRATEGIES.LEVERAGE_LOOP,
    riskLevel: 5,
    description: "USDC leverage loop — recursive WBTC→USDC→swap→re-supply via AVNU",
    curator: { name: "Sable" },
    contractAddress: SABLE_CONTRACTS.TURBO,
  },
  {
    id: "apex",
    name: "Sable Apex",
    strategy: VAULT_STRATEGIES.MULTI_STRATEGY,
    riskLevel: 5,
    description: "Maximum yield — leveraged lending + LP fees + staking rewards combined",
    curator: { name: "Sable" },
    contractAddress: SABLE_CONTRACTS.APEX,
  },
  {
    id: "stablecoin",
    name: "Sable Stablecoin",
    strategy: VAULT_STRATEGIES.LENDING,
    riskLevel: 1,
    description: "USDC lending on Vesu RE7 USDC Core — stablecoin yield with privacy",
    curator: { name: "Sable" },
    contractAddress: SABLE_CONTRACTS.STABLECOIN_VAULT,
  },
];

export interface LiveVault {
  id: string;
  name: string;
  strategy: VaultStrategy;
  riskLevel: RiskLevel;
  description: string;
  curator: { name: string };
  asset: typeof TOKENS.WBTC;
  vTokenAddress: string;
  apy: { total: number; base: number; rewards: number };
  tvlUsd: number;
  totalSuppliedBtc: number;
  utilization: number;
  btcPrice: number;
  strategyBreakdown: StrategyBreakdownItem[];
  leverage?: {
    ratio: number;
    supplyApy: number;
    borrowCost: number;
    rewardsApy: number;
    netApy: number;
    liquidationDrop: number;
  };
  allocations: {
    protocol: string;
    strategy: string;
    allocationPct: number;
    apy: number;
  }[];
  /** Vesu pool liquidation factor (e.g. 0.95) — from API, used for health factor calcs */
  liquidationFactor?: number;
}

export async function fetchAllVaults(): Promise<LiveVault[]> {
  const [btcPrice, defillamaPools] = await Promise.all([
    fetchBtcPrice(),
    fetchStarknetBtcPools(),
  ]);

  const results: LiveVault[] = [];

  for (const cfg of VAULT_CONFIGS) {
    try {
      const vault = await resolveVault(cfg, defillamaPools, btcPrice);
      if (vault) results.push(vault);
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => a.riskLevel - b.riskLevel);
}

async function resolveVault(
  cfg: VaultConfig,
  defillamaPools: Awaited<ReturnType<typeof fetchStarknetBtcPools>>,
  btcPrice: number,
): Promise<LiveVault | null> {
  if (cfg.id === "stablecoin") {
    return resolveStablecoin(cfg, btcPrice);
  }

  switch (cfg.strategy) {
    case VAULT_STRATEGIES.LENDING:
      return resolveSentinel(cfg, btcPrice);
    case VAULT_STRATEGIES.DUAL_LENDING:
      return resolveCitadel(cfg, defillamaPools, btcPrice);
    case VAULT_STRATEGIES.LP_PROVISION:
      return resolveTrident(cfg, defillamaPools, btcPrice);
    case VAULT_STRATEGIES.DELTA_NEUTRAL:
      return resolveDeltaNeutral(cfg, btcPrice);
    case VAULT_STRATEGIES.LEVERAGE_LOOP:
      return resolveTurbo(cfg, btcPrice);
    case VAULT_STRATEGIES.MULTI_STRATEGY:
      return resolveApex(cfg, defillamaPools, btcPrice);
    default:
      return null;
  }
}

function baseVault(cfg: VaultConfig, btcPrice: number): Omit<LiveVault, "apy" | "tvlUsd" | "totalSuppliedBtc" | "utilization" | "strategyBreakdown" | "allocations"> {
  return {
    id: cfg.id,
    name: cfg.name,
    strategy: cfg.strategy,
    riskLevel: cfg.riskLevel,
    description: cfg.description,
    curator: cfg.curator,
    asset: TOKENS.WBTC,
    vTokenAddress: cfg.contractAddress,
    btcPrice,
  };
}

async function resolveSentinel(cfg: VaultConfig, btcPrice: number): Promise<LiveVault | null> {
  const [data, onChain] = await Promise.all([
    fetchVesuWbtcData(VESU_POOLS.PRIME.id),
    fetchVaultOnChainTvl(cfg.contractAddress, btcPrice),
  ]);
  if (!data) return null;

  const totalApy = data.supplyApy + data.btcFiApr;

  return {
    ...baseVault(cfg, btcPrice),
    apy: { total: totalApy, base: data.supplyApy, rewards: data.btcFiApr },
    tvlUsd: onChain.tvlUsd,
    totalSuppliedBtc: onChain.totalSuppliedBtc,
    utilization: data.utilization,
    strategyBreakdown: [
      { label: "WBTC Supply APY (PRIME)", value: data.supplyApy, type: "earn" },
      ...(data.btcFiApr > 0 ? [{ label: "BTCFi STRK Rewards", value: data.btcFiApr, type: "reward" as const }] : []),
      { label: "Net APY", value: totalApy, type: "net" },
    ],
    allocations: [
      { protocol: "Vesu", strategy: "PRIME WBTC Lending", allocationPct: 100, apy: totalApy },
    ],
  };
}

async function resolveStablecoin(cfg: VaultConfig, btcPrice: number): Promise<LiveVault | null> {
  const data = await fetchVesuUsdcData(VESU_POOLS.RE7_USDC_CORE.id);
  if (!data) return null;

  const totalApy = data.supplyApy;

  return {
    ...baseVault(cfg, btcPrice),
    apy: { total: totalApy, base: totalApy, rewards: 0 },
    tvlUsd: data.tvlUsd,
    totalSuppliedBtc: 0,
    utilization: data.utilization,
    strategyBreakdown: [
      { label: "USDC Supply APY (RE7 USDC Core)", value: data.supplyApy, type: "earn" },
      { label: "Net APY", value: totalApy, type: "net" },
    ],
    allocations: [
      { protocol: "Vesu", strategy: "RE7 USDC Core Lending", allocationPct: 100, apy: totalApy },
    ],
  };
}

async function resolveCitadel(
  cfg: VaultConfig,
  defillamaPools: Awaited<ReturnType<typeof fetchStarknetBtcPools>>,
  btcPrice: number,
): Promise<LiveVault | null> {
  const [data, xwbtcBtcFi, onChain] = await Promise.all([
    fetchVesuWbtcData(VESU_POOLS.RE7_XBTC.id),
    fetchVesuXwbtcBtcFi(VESU_POOLS.RE7_XBTC.id),
    fetchVaultOnChainTvl(cfg.contractAddress, btcPrice),
  ]);
  if (!data) return null;

  // Endur liquid staking APR — live from DefiLlama, fallback 0
  const endurPool = defillamaPools.find((p) => p.pool === DEFILLAMA_POOL_IDS.ENDUR_WBTC);
  const stakingApr = endurPool?.apy ?? 0;
  // BTCFi rewards on xWBTC supplied to Vesu
  const btcFiRewards = xwbtcBtcFi;
  const totalApy = stakingApr + btcFiRewards;

  return {
    ...baseVault(cfg, btcPrice),
    apy: { total: totalApy, base: stakingApr, rewards: btcFiRewards },
    tvlUsd: onChain.tvlUsd,
    totalSuppliedBtc: onChain.totalSuppliedBtc,
    utilization: 0,
    strategyBreakdown: [
      { label: "Endur BTC Staking Yield", value: stakingApr, type: "earn" },
      ...(btcFiRewards > 0 ? [{ label: "BTCFi STRK Rewards (Vesu)", value: btcFiRewards, type: "reward" as const }] : []),
      { label: "Net APY", value: totalApy, type: "net" },
    ],
    allocations: [
      { protocol: "Endur → Vesu", strategy: "xWBTC Staking + Collateral Supply", allocationPct: 100, apy: totalApy },
    ],
  };
}

async function resolveTrident(
  cfg: VaultConfig,
  defillamaPools: Awaited<ReturnType<typeof fetchStarknetBtcPools>>,
  btcPrice: number,
): Promise<LiveVault | null> {
  const [data, xwbtcBtcFi, onChain] = await Promise.all([
    fetchVesuWbtcData(VESU_POOLS.RE7_XBTC.id),
    fetchVesuXwbtcBtcFi(VESU_POOLS.RE7_XBTC.id),
    fetchVaultOnChainTvl(cfg.contractAddress, btcPrice),
  ]);
  if (!data) return null;

  const endurPool = defillamaPools.find((p) => p.pool === DEFILLAMA_POOL_IDS.ENDUR_WBTC);
  const stakingApr = endurPool?.apy ?? 0;
  const wbtcBorrowApr = data.borrowApr;
  const btcFiRewards = xwbtcBtcFi;

  const LTV = 0.70;
  const NUM_LOOPS = 3;
  const L = (1 - Math.pow(LTV, NUM_LOOPS)) / (1 - LTV); // ~2.16x

  // Staking yield is amplified by L (each unit of BTC earns staking yield)
  const stakingComponent = (stakingApr / 100) * L;
  // Borrow cost only applies to borrowed amount (L-1)
  const borrowComponent = (wbtcBorrowApr / 100) * (L - 1);
  const rewardsComponent = (btcFiRewards / 100) * L;
  const netApy = (stakingComponent - borrowComponent + rewardsComponent) * 100;

  // Liquidation factor from Vesu API
  const liqFactor = data.liquidationFactor || 0.95;
  const liquidationDrop = (1 - (L - 1) / (L * liqFactor)) * 100;

  return {
    ...baseVault(cfg, btcPrice),
    apy: {
      total: netApy,
      base: (stakingComponent - borrowComponent) * 100,
      rewards: rewardsComponent * 100,
    },
    tvlUsd: onChain.tvlUsd,
    totalSuppliedBtc: onChain.totalSuppliedBtc,
    utilization: data.utilization,
    liquidationFactor: liqFactor,
    leverage: {
      ratio: L,
      supplyApy: stakingComponent * 100,
      borrowCost: borrowComponent * 100,
      rewardsApy: rewardsComponent * 100,
      netApy,
      liquidationDrop,
    },
    strategyBreakdown: [
      { label: `Endur Staking (${L.toFixed(2)}x)`, value: stakingComponent * 100, type: "earn" },
      { label: `WBTC Borrow Cost`, value: -(borrowComponent * 100), type: "cost" },
      { label: `BTCFi Rewards (${L.toFixed(2)}x)`, value: rewardsComponent * 100, type: "reward" },
      { label: "Net Looped APY", value: netApy, type: "net" },
    ],
    allocations: [
      { protocol: "Endur", strategy: "BTC Liquid Staking (xWBTC)", allocationPct: 100, apy: stakingApr },
      { protocol: "Vesu", strategy: "Looped Supply + Borrow (Re7 xBTC)", allocationPct: 100, apy: netApy },
    ],
  };
}

async function resolveDeltaNeutral(cfg: VaultConfig, btcPrice: number): Promise<LiveVault | null> {
  const [re7, usdcPrime, onChain] = await Promise.all([
    fetchVesuWbtcData(VESU_POOLS.RE7_XBTC.id),
    fetchVesuUsdcData(VESU_POOLS.PRIME.id),
    fetchVaultOnChainTvl(cfg.contractAddress, btcPrice),
  ]);
  if (!re7) return null;

  const LTV = 0.50;

  const btcYield = re7.supplyApy + re7.btcFiApr;
  const borrowCost = re7.usdcBorrowApr * LTV;
  const usdcYield = (usdcPrime?.supplyApy ?? re7.usdcSupplyApy) * LTV;
  const totalApy = btcYield - borrowCost + usdcYield;

  const liqFactor = re7.liquidationFactor || 0.95;

  return {
    ...baseVault(cfg, btcPrice),
    apy: { total: totalApy, base: btcYield - borrowCost, rewards: usdcYield },
    tvlUsd: onChain.tvlUsd,
    totalSuppliedBtc: onChain.totalSuppliedBtc,
    utilization: re7.utilization,
    liquidationFactor: liqFactor,
    strategyBreakdown: [
      { label: "BTC Supply + BTCFi", value: btcYield, type: "earn" },
      { label: `USDC Borrow Cost (${(LTV * 100).toFixed(0)}% LTV)`, value: -borrowCost, type: "cost" },
      { label: "USDC Deployment Yield", value: usdcYield, type: "earn" },
      { label: "Net Spread", value: totalApy, type: "net" },
    ],
    allocations: [
      { protocol: "Vesu", strategy: "WBTC Collateral (Re7 xBTC)", allocationPct: 100, apy: btcYield },
      { protocol: "Vesu", strategy: "USDC Yield (Prime)", allocationPct: Math.round(LTV * 100), apy: usdcYield / LTV },
    ],
  };
}

async function resolveTurbo(cfg: VaultConfig, btcPrice: number): Promise<LiveVault | null> {
  const [data, onChain] = await Promise.all([
    fetchVesuWbtcData(VESU_POOLS.RE7_XBTC.id),
    fetchVaultOnChainTvl(cfg.contractAddress, btcPrice),
  ]);
  if (!data) return null;

  const LTV = 0.70;
  const NUM_LOOPS = 3;
  const L = (1 - Math.pow(LTV, NUM_LOOPS)) / (1 - LTV);

  const supplyComponent = (data.supplyApy / 100) * L;
  const borrowComponent = (data.usdcBorrowApr / 100) * (L - 1);
  const rewardsComponent = (data.btcFiApr / 100) * L;
  const netApy = (supplyComponent - borrowComponent + rewardsComponent) * 100;

  const liqFactor = data.liquidationFactor || 0.95;
  const liquidationDrop = (1 - (L - 1) / (L * liqFactor)) * 100;

  const leverage = {
    ratio: L,
    supplyApy: supplyComponent * 100,
    borrowCost: borrowComponent * 100,
    rewardsApy: rewardsComponent * 100,
    netApy,
    liquidationDrop,
  };

  return {
    ...baseVault(cfg, btcPrice),
    apy: {
      total: netApy,
      base: supplyComponent * 100 - borrowComponent * 100,
      rewards: rewardsComponent * 100,
    },
    tvlUsd: onChain.tvlUsd,
    totalSuppliedBtc: onChain.totalSuppliedBtc,
    utilization: data.utilization,
    liquidationFactor: liqFactor,
    leverage,
    strategyBreakdown: [
      { label: `WBTC Supply (${L.toFixed(2)}x)`, value: supplyComponent * 100, type: "earn" },
      { label: "USDC Borrow Cost", value: -(borrowComponent * 100), type: "cost" },
      ...(rewardsComponent > 0 ? [{ label: `BTCFi Rewards (${L.toFixed(2)}x)`, value: rewardsComponent * 100, type: "reward" as const }] : []),
      { label: "Net Leveraged APY", value: netApy, type: "net" },
    ],
    allocations: [
      { protocol: "Vesu", strategy: "WBTC Leverage Loop via AVNU", allocationPct: 100, apy: netApy },
    ],
  };
}

async function resolveApex(
  cfg: VaultConfig,
  defillamaPools: Awaited<ReturnType<typeof fetchStarknetBtcPools>>,
  btcPrice: number,
): Promise<LiveVault | null> {
  const [re7, onChain] = await Promise.all([
    fetchVesuWbtcData(VESU_POOLS.RE7_XBTC.id),
    fetchVaultOnChainTvl(cfg.contractAddress, btcPrice),
  ]);
  const endurPool = defillamaPools.find((p) => p.pool === DEFILLAMA_POOL_IDS.ENDUR_WBTC);
  const ekuboPool = defillamaPools.find((p) => p.pool === DEFILLAMA_POOL_IDS.EKUBO_WBTC_ETH);

  if (!re7) return null;

  // 3 supply-borrow cycles: 1 + 0.5 + 0.25 = 1.75x supply, residual 0.125 sits idle
  const LTV = 0.50;
  const NUM_LOOPS = 3;
  const L = (1 - Math.pow(LTV, NUM_LOOPS)) / (1 - LTV); // 1.75
  const lendingWeight = 0.40;
  const lendingBase = (re7.supplyApy + re7.btcFiApr) * L - re7.usdcBorrowApr * (L - 1);
  const lendingApy = lendingWeight * lendingBase;

  const lpWeight = 0.35;
  const ekuboApy = ekuboPool?.apy ?? 0;
  const lpApy = lpWeight * ekuboApy;

  const stakingWeight = 0.25;
  const endurApy = endurPool?.apy ?? 0;
  const stakingApy = stakingWeight * endurApy;

  const totalApy = lendingApy + lpApy + stakingApy;

  const liqFactor = re7.liquidationFactor || 0.95;

  return {
    ...baseVault(cfg, btcPrice),
    apy: { total: totalApy, base: lendingApy + lpApy, rewards: stakingApy },
    tvlUsd: onChain.tvlUsd,
    totalSuppliedBtc: onChain.totalSuppliedBtc,
    utilization: re7.utilization,
    liquidationFactor: liqFactor,
    leverage: {
      ratio: L,
      supplyApy: re7.supplyApy * L * lendingWeight,
      borrowCost: re7.usdcBorrowApr * (L - 1) * lendingWeight,
      rewardsApy: re7.btcFiApr * L * lendingWeight,
      netApy: totalApy,
      liquidationDrop: (1 - (L - 1) / (L * liqFactor)) * 100,
    },
    strategyBreakdown: [
      { label: `Leveraged Lending 3x Loop (${Math.round(lendingWeight * 100)}%)`, value: lendingApy, type: "earn" },
      { label: `Ekubo WBTC/ETH LP (${Math.round(lpWeight * 100)}%)`, value: lpApy, type: "earn" },
      { label: `Endur Staking (${Math.round(stakingWeight * 100)}%)`, value: stakingApy, type: "reward" },
      { label: "Net Multi-Strategy APY", value: totalApy, type: "net" },
    ],
    allocations: [
      { protocol: "Vesu", strategy: "Leveraged Lending (3x Loop)", allocationPct: Math.round(lendingWeight * 100), apy: lendingBase },
      { protocol: "Ekubo", strategy: "WBTC/ETH Concentrated LP", allocationPct: Math.round(lpWeight * 100), apy: ekuboApy },
      { protocol: "Endur", strategy: "BTC Staking", allocationPct: Math.round(stakingWeight * 100), apy: endurApy },
    ],
  };
}

export async function fetchVaultPerformance(
  vaultId: string,
  days: number = 30,
): Promise<PerformanceDataPoint[]> {
  const cfg = VAULT_CONFIGS.find((c) => c.id === vaultId);
  if (!cfg) return [];
  const cutoff = Date.now() - days * 86_400_000;

  // Apex: combine Ekubo LP chart + Endur staking + Vesu lending = strategy APY
  if (cfg.strategy === VAULT_STRATEGIES.MULTI_STRATEGY) {
    try {
      const [ekuboChart, defillamaPools, re7] = await Promise.all([
        fetchPoolChart(DEFILLAMA_POOL_IDS.EKUBO_WBTC_ETH),
        fetchStarknetBtcPools(),
        fetchVesuWbtcData(VESU_POOLS.RE7_XBTC.id),
      ]);
      const endurPool = defillamaPools.find((p) => p.pool === DEFILLAMA_POOL_IDS.ENDUR_WBTC);
      const endurApy = endurPool?.apy ?? 0;
      const vesuLendingApy = re7 ? re7.supplyApy + re7.btcFiApr : 0;
      return ekuboChart
        .filter((p) => new Date(p.timestamp).getTime() >= cutoff)
        .map((p) => {
          const ekuboApy = p.apy ?? 0;
          const blendedApy = ekuboApy * 0.35 + endurApy * 0.25 + vesuLendingApy * 0.40;
          return {
            timestamp: new Date(p.timestamp).getTime(),
            apy: blendedApy,
            tvl: p.tvlUsd ?? 0,
            sharePrice: 1 + blendedApy / 36500,
          };
        });
    } catch {
      return [];
    }
  }

  // Citadel: Endur staking APY = strategy APY (btcFi is 0 for xWBTC)
  if (cfg.strategy === VAULT_STRATEGIES.DUAL_LENDING) {
    try {
      const chart = await fetchPoolChart(DEFILLAMA_POOL_IDS.ENDUR_WBTC);
      return chart
        .filter((p) => new Date(p.timestamp).getTime() >= cutoff)
        .map((p) => ({
          timestamp: new Date(p.timestamp).getTime(),
          apy: p.apy ?? 0,
          tvl: p.tvlUsd ?? 0,
          sharePrice: 1 + (p.apy ?? 0) / 36500,
        }));
    } catch {
      return [];
    }
  }

  // Trident: leveraged Endur staking — apply leverage math to historical Endur APY
  if (cfg.strategy === VAULT_STRATEGIES.LP_PROVISION) {
    try {
      const [chart, re7] = await Promise.all([
        fetchPoolChart(DEFILLAMA_POOL_IDS.ENDUR_WBTC),
        fetchVesuWbtcData(VESU_POOLS.RE7_XBTC.id),
      ]);
      const wbtcBorrowApr = re7?.borrowApr ?? 0;
      const LTV = 0.70;
      const NUM_LOOPS = 3;
      const L = (1 - Math.pow(LTV, NUM_LOOPS)) / (1 - LTV);
      return chart
        .filter((p) => new Date(p.timestamp).getTime() >= cutoff)
        .map((p) => {
          const endurApy = p.apy ?? 0;
          // Strategy APY = staking * L - borrow_cost * (L-1)
          const strategyApy = endurApy * L - wbtcBorrowApr * (L - 1);
          return {
            timestamp: new Date(p.timestamp).getTime(),
            apy: strategyApy,
            tvl: p.tvlUsd ?? 0,
            sharePrice: 1 + strategyApy / 36500,
          };
        });
    } catch {
      return [];
    }
  }

  // Sentinel/DN/Turbo: no reliable historical chart source, return empty
  return [];
}
