import type { VaultStrategy } from "./constants";

export interface Vault {
  id: string;
  name: string;
  address: string;
  asset: TokenInfo;
  shareToken: TokenInfo;
  strategy: VaultStrategy;
  curator: {
    address: string;
    name: string;
    avatar?: string;
  };
  metrics: VaultMetrics;
  allocations: StrategyAllocation[];
  status: "active" | "deprecated" | "paused";
}

export interface VaultMetrics {
  totalAssets: bigint;
  totalShares: bigint;
  sharePrice: number;
  apy: ApyBreakdown;
  tvlUsd: number;
  depositors: number;
  inception: string;
  highWaterMark: number;
}

export interface ApyBreakdown {
  total: number;
  base: number;
  rewards: number;
  leverage: number;
}

export interface StrategyAllocation {
  protocol: string;
  strategy: string;
  allocationBps: number;
  currentValue: bigint;
  apy: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
}

export interface UserPosition {
  vaultId: string;
  shares: bigint;
  depositedAssets: bigint;
  currentValue: bigint;
  pnl: number;
  pnlPercent: number;
  depositTimestamp: number;
}

export interface PerformanceDataPoint {
  timestamp: number;
  sharePrice: number;
  tvl: number;
  apy: number;
}
