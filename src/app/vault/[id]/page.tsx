"use client";

import { use } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { formatUsd, formatPercent } from "@/lib/format";
import { VAULT_STRATEGIES, RISK_LABELS, VOYAGER_BASE } from "@/lib/constants";
import { PerformanceChart } from "@/components/performance-chart";
import { DepositWithdraw } from "@/components/deposit-withdraw";
import { useVaultDetail, usePerformanceData } from "@/hooks/use-vault-data";
import { useStrategyInfo, useTokenBalance, useShareValue, useVaultTotals } from "@/hooks/use-vault-contract";
import { useAccount } from "@starknet-react/core";
import type { StrategyBreakdownItem } from "@/lib/api/vaults";

const STRAT_TAG: Record<string, string> = {
  [VAULT_STRATEGIES.LENDING]: "LEND",
  [VAULT_STRATEGIES.DUAL_LENDING]: "DUAL",
  [VAULT_STRATEGIES.LP_PROVISION]: "LP",
  [VAULT_STRATEGIES.DELTA_NEUTRAL]: "D-N",
  [VAULT_STRATEGIES.LEVERAGE_LOOP]: "LOOP",
  [VAULT_STRATEGIES.MULTI_STRATEGY]: "MULTI",
};

const ALLOC_COLORS = ["bg-btc", "bg-up", "bg-caution", "bg-fg-dim"];

function BreakdownRow({ item }: { item: StrategyBreakdownItem }) {
  const isNet = item.type === "net";
  const isCost = item.type === "cost" || item.value < 0;

  return (
    <div className={clsx(
      "flex justify-between items-center",
      isNet && "border-t border-line pt-2 mt-2"
    )}>
      <span className={clsx(
        "text-[12px]",
        isNet ? "text-fg font-medium" : "text-fg-muted"
      )}>
        {item.label}
      </span>
      <span className={clsx(
        "text-[12px] font-mono",
        isNet ? "text-btc font-bold" :
        isCost ? "text-down" :
        item.type === "reward" ? "text-up" :
        "text-up"
      )}>
        {!isNet && !isCost && "+"}{formatPercent(item.value)}
      </span>
    </div>
  );
}

const STRATEGY_DESCRIPTIONS: Record<string, {
  title: string;
  flow: string[];
  risks: string[];
}> = {
  sentinel: {
    title: "Pure WBTC Lending",
    flow: ["Deposit WBTC", "Supply to Vesu PRIME pool", "Earn supply APY + BTCFi rewards"],
    risks: ["Smart contract risk", "Vesu protocol risk"],
  },
  citadel: {
    title: "Staked BTC + Lending",
    flow: ["Deposit WBTC", "Stake via Endur for xWBTC", "Supply xWBTC to Vesu Re7", "Earn staking yield + BTCFi rewards"],
    risks: ["Smart contract risk", "Endur liquid staking risk", "xWBTC de-peg risk"],
  },
  trident: {
    title: "Recursive BTC Staking Loop",
    flow: ["Deposit WBTC", "Stake via Endur for xWBTC", "Supply xWBTC as collateral on Vesu", "Borrow WBTC", "Re-stake borrowed WBTC", "Repeat 3x for amplified yield"],
    risks: ["Leverage liquidation risk", "Smart contract risk", "xWBTC de-peg risk", "Borrow rate fluctuation"],
  },
  "delta-neutral": {
    title: "BTC-USDC Yield Spread",
    flow: ["Deposit WBTC", "Supply WBTC as collateral on Vesu Re7", "Borrow USDC at 50% LTV", "Deploy USDC to Vesu Prime pool", "Earn spread between USDC yield and borrow cost"],
    risks: ["Leverage liquidation risk", "USDC depeg risk", "BTC price volatility"],
  },
  turbo: {
    title: "USDC Leverage Loop",
    flow: ["Deposit WBTC", "Supply WBTC to Vesu", "Borrow USDC", "Swap USDC to WBTC via AVNU", "Re-supply WBTC", "Repeat 3x for leveraged exposure"],
    risks: ["High leverage liquidation risk", "Swap slippage", "BTC price volatility", "Smart contract risk"],
  },
  apex: {
    title: "Multi-Strategy Maximum Yield",
    flow: ["Deposit WBTC, split 3 ways:", "40% → Vesu leveraged lending (3x loop)", "35% → Ekubo WBTC/ETH concentrated LP", "25% → Endur BTC staking (validator rewards)", "Auto-unwind on withdraw via flash loan"],
    risks: ["Multiple protocol risk", "Leverage liquidation risk", "Impermanent loss on LP", "Swap slippage on unwind", "Smart contract risk"],
  },
};

function getStrategyAnalysis(
  vaultId: string,
  info: { collateral: number; debt: number; loops: number; paused: boolean },
  btcPrice: number,
  /** Liquidation factor from Vesu API (e.g. 0.95 for Re7 xBTC) */
  apiLiquidationFactor?: number,
  /** Vault total_assets (sats) — used for correct net equity on mixed-unit strategies */
  vaultTotalAssets?: number,
) {
  const fmtBtc = (v: number) => (v / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  const fmtBtcShort = (v: number) => (v / 1e8).toFixed(4);
  const fmtUsdc = (v: number) => `$${(v / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const collateralBtc = info.collateral / 1e8;
  const collateralUsd = collateralBtc * btcPrice;
  // Use real liquidation factor from Vesu API, fallback to 0.95 (Re7 xBTC default)
  const liqThreshold = apiLiquidationFactor || 0.95;

  const result: {
    rows: { label: string; value: string; usdValue?: string; color?: string }[];
    healthFactor?: number;
    netEquity?: { btc: number; usd: number };
    leverageActual?: number;
  } = { rows: [] };

  switch (vaultId) {
    case "sentinel": {
      result.rows = [
        { label: "WBTC Supplied", value: `${fmtBtc(info.collateral)} WBTC`, usdValue: formatUsd(collateralUsd) },
      ];
      result.netEquity = { btc: collateralBtc, usd: collateralUsd };
      break;
    }
    case "citadel": {
      // Citadel: WBTC → Endur xWBTC → Vesu supply (no debt)
      // Collateral is xWBTC, use total_assets for accurate WBTC-equivalent net equity
      const netBtcCit = vaultTotalAssets != null ? vaultTotalAssets / 1e8 : collateralBtc;
      const netUsdCit = netBtcCit * btcPrice;

      result.rows = [
        { label: "xWBTC Collateral (Vesu)", value: `${fmtBtcShort(info.collateral)} xWBTC`, usdValue: formatUsd(collateralUsd) },
        { label: "Net Equity", value: `${netBtcCit.toFixed(4)} WBTC`, usdValue: formatUsd(netUsdCit), color: "text-up" },
      ];
      result.netEquity = { btc: netBtcCit, usd: netUsdCit };
      break;
    }
    case "trident": {
      const debtBtc = info.debt / 1e8;
      const debtUsd = debtBtc * btcPrice;
      // Collateral is xWBTC, debt is WBTC — different units, can't subtract directly.
      // Use vault's total_assets (which correctly converts xWBTC→WBTC on-chain) for net equity.
      const netBtc = vaultTotalAssets != null ? vaultTotalAssets / 1e8 : collateralBtc - debtBtc;
      const netUsd = netBtc * btcPrice;
      // Health factor: Vesu uses oracle prices for both xWBTC and WBTC, so collateral/debt ratio is valid
      const hf = debtBtc > 0 ? (collateralBtc * liqThreshold) / debtBtc : Infinity;
      // Staking leverage = total xWBTC staked / equity (in WBTC terms from total_assets)
      // xWBTC sats ≈ WBTC sats (within ~1.5%), gives conservative estimate
      const lev = netBtc > 0 ? collateralBtc / netBtc : 0;

      result.rows = [
        { label: "xWBTC Collateral", value: `${fmtBtcShort(info.collateral)} xWBTC`, usdValue: formatUsd(collateralUsd) },
        { label: "WBTC Debt", value: `${fmtBtcShort(info.debt)} WBTC`, usdValue: formatUsd(debtUsd), color: "text-down" },
        { label: "Net Equity", value: `${netBtc.toFixed(4)} WBTC`, usdValue: formatUsd(netUsd), color: "text-up" },
        { label: "Staking Loops", value: info.loops.toString() },
      ];
      result.healthFactor = isFinite(hf) ? hf : undefined;
      result.netEquity = { btc: netBtc, usd: netUsd };
      result.leverageActual = lev;
      break;
    }
    case "delta-neutral": {
      const debtUsd = info.debt / 1e6;
      const netUsd = collateralUsd - debtUsd;
      const netBtc = netUsd / btcPrice;
      const hf = debtUsd > 0 ? (collateralUsd * liqThreshold) / debtUsd : Infinity;

      result.rows = [
        { label: "WBTC Collateral", value: `${fmtBtcShort(info.collateral)} WBTC`, usdValue: formatUsd(collateralUsd) },
        { label: "USDC Debt", value: fmtUsdc(info.debt), color: "text-down" },
        { label: "Net Value", value: formatUsd(netUsd), color: "text-up" },
      ];
      result.healthFactor = isFinite(hf) ? hf : undefined;
      result.netEquity = { btc: netBtc, usd: netUsd };
      break;
    }
    case "turbo": {
      const debtUsd = info.debt / 1e6;
      const netUsd = collateralUsd - debtUsd;
      const netBtc = netUsd / btcPrice;
      const hf = debtUsd > 0 ? (collateralUsd * liqThreshold) / debtUsd : Infinity;
      const lev = netUsd > 0 ? collateralUsd / netUsd : 0;

      result.rows = [
        { label: "WBTC Collateral", value: `${fmtBtcShort(info.collateral)} WBTC`, usdValue: formatUsd(collateralUsd) },
        { label: "USDC Debt", value: fmtUsdc(info.debt), color: "text-down" },
        { label: "Net Equity", value: `${netBtc.toFixed(4)} WBTC`, usdValue: formatUsd(netUsd), color: "text-up" },
        { label: "Leverage Loops", value: info.loops.toString() },
      ];
      result.healthFactor = isFinite(hf) ? hf : undefined;
      result.netEquity = { btc: netBtc, usd: netUsd };
      result.leverageActual = lev;
      break;
    }
    case "apex": {
      const debtUsd = info.debt / 1e6;
      const netUsd = collateralUsd - debtUsd;
      const netBtc = netUsd / btcPrice;
      const hf = debtUsd > 0 ? (collateralUsd * liqThreshold) / debtUsd : Infinity;

      result.rows = [
        { label: "WBTC Collateral", value: `${fmtBtcShort(info.collateral)} WBTC`, usdValue: formatUsd(collateralUsd) },
        { label: "USDC Debt", value: fmtUsdc(info.debt), color: "text-down" },
        { label: "Net Value", value: formatUsd(netUsd), color: "text-up" },
        { label: "Leverage Loops", value: info.loops.toString() },
      ];
      result.healthFactor = isFinite(hf) ? hf : undefined;
      result.netEquity = { btc: netBtc, usd: netUsd };
      break;
    }
  }

  return result;
}

export default function VaultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { vault, loading, error } = useVaultDetail(id);
  const { data: performanceData } = usePerformanceData(id, 90);
  const contractAddress = vault?.vTokenAddress ?? null;
  const strategyInfo = useStrategyInfo(contractAddress);
  const { isConnected } = useAccount();
  const { balance: shareBalance } = useTokenBalance(contractAddress ?? "");
  const { wbtcValue } = useShareValue(contractAddress, shareBalance);
  const vaultTotals = useVaultTotals(contractAddress);

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-24 text-center">
        <p className="text-fg-dim font-mono text-[13px] animate-pulse">Loading vault data...</p>
      </div>
    );
  }

  if (error || !vault) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-24 text-center">
        <p className="text-fg-dim font-mono text-[13px]">{error || "Vault not found."}</p>
        <Link href="/" className="text-btc text-[13px] mt-3 inline-block hover:underline">
          Back to vaults
        </Link>
      </div>
    );
  }

  const { apy, allocations, strategyBreakdown, riskLevel, description } = vault;
  const risk = RISK_LABELS[riskLevel];
  const stratDesc = STRATEGY_DESCRIPTIONS[id];

  const sharePrice = vaultTotals && vaultTotals.totalSupply > BigInt(0)
    ? Number(vaultTotals.totalAssets) / Number(vaultTotals.totalSupply)
    : 1;

  const hasPosition = isConnected && shareBalance !== null && shareBalance > BigInt(0);
  const userShares = shareBalance ? Number(shareBalance) / 1e8 : 0;
  const userWbtc = wbtcValue ? Number(wbtcValue) / 1e8 : userShares * sharePrice;
  const userUsd = userWbtc * vault.btcPrice;

  // Strategy on-chain analysis — uses liquidation factor from Vesu API
  const totalAssetsSats = vaultTotals ? Number(vaultTotals.totalAssets) : undefined;
  const analysis = strategyInfo ? getStrategyAnalysis(id, strategyInfo, vault.btcPrice, vault.liquidationFactor, totalAssetsSats) : null;

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-[12px] text-fg-dim hover:text-fg-muted transition-colors mb-8 font-mono"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        vaults
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 min-w-0">

          {/* ── Hero ────────────────────────────────────── */}
          <div className="mb-8 animate-fade-up">
            <div className="flex items-center gap-3 mb-4">
              <span className="font-display text-3xl text-btc italic leading-none">B</span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-medium">{vault.name}</h1>
                  <span className="text-[9px] font-mono tracking-widest text-fg-dim uppercase bg-surface-overlay px-1.5 py-0.5 rounded">
                    {STRAT_TAG[vault.strategy]}
                  </span>
                  <span className={clsx(
                    "text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded border",
                    riskLevel <= 2
                      ? "bg-up/10 border-up/20 text-up"
                      : riskLevel === 3
                        ? "bg-caution/10 border-caution/20 text-caution"
                        : "bg-down/10 border-down/20 text-down"
                  )}>
                    {risk.label}
                  </span>
                </div>
                <p className="text-[11px] text-fg-dim font-mono mt-0.5">
                  {description}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-10 gap-y-3">
              <div>
                <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">APY</p>
                <p className="text-4xl font-mono font-bold tracking-tight text-btc"
                   style={{ textShadow: "0 0 40px rgba(247,147,26,0.15)" }}>
                  {formatPercent(apy.total)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">TVL</p>
                <p className="text-4xl font-mono font-bold tracking-tight">{formatUsd(vault.tvlUsd)}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">Share Price</p>
                <p className="text-4xl font-mono font-bold tracking-tight">{sharePrice.toFixed(4)}</p>
              </div>
            </div>
          </div>

          {/* ── Your Position (prominent, in main area) ── */}
          {hasPosition && (
            <div className="rounded-xl bg-surface border border-btc/20 p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.03s" }}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                  Your Position
                </p>
                <span className={clsx(
                  "text-[9px] font-mono tracking-wider uppercase px-2 py-0.5 rounded",
                  strategyInfo?.paused ? "bg-down/15 text-down" : "bg-up/15 text-up"
                )}>
                  {strategyInfo?.paused ? "Paused" : "Active"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-[10px] font-mono text-fg-dim mb-0.5">yvBTC Shares</p>
                  <p className="text-xl font-mono font-bold text-btc">
                    {userShares.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-fg-dim mb-0.5">WBTC Value</p>
                  <p className="text-xl font-mono font-bold">
                    {userWbtc.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-fg-dim mb-0.5">USD Value</p>
                  <p className="text-xl font-mono font-bold">
                    {formatUsd(userUsd)}
                  </p>
                </div>
              </div>

              {/* Share price info */}
              <div className="flex items-center gap-4 pt-3 border-t border-line">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-fg-dim">Share Price:</span>
                  <span className="text-[11px] font-mono text-fg-muted">{sharePrice.toFixed(6)} WBTC</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-fg-dim">Earning:</span>
                  <span className="text-[11px] font-mono text-up">{formatPercent(apy.total)} APY</span>
                </div>
                {vault.leverage && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-fg-dim">Leverage:</span>
                    <span className="text-[11px] font-mono text-btc">{vault.leverage.ratio.toFixed(2)}x</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── On-Chain Strategy Analysis ──────────────── */}
          {contractAddress && strategyInfo && analysis && (
            <div className="rounded-xl bg-surface border border-line p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.05s" }}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                  On-Chain Strategy State
                </p>
                <span className={clsx(
                  "text-[9px] font-mono tracking-wider uppercase px-2 py-0.5 rounded",
                  strategyInfo.paused ? "bg-down/15 text-down" : "bg-up/15 text-up"
                )}>
                  {strategyInfo.paused ? "Paused" : "Active"}
                </span>
              </div>

              {/* Health Factor + Leverage bar */}
              {(analysis.healthFactor || analysis.leverageActual) && (
                <div className="grid grid-cols-2 gap-4 mb-4">
                  {analysis.healthFactor && analysis.healthFactor < 100 && (
                    <div className="rounded-lg bg-surface-overlay p-3">
                      <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-1">Health Factor</p>
                      <p className={clsx(
                        "text-2xl font-mono font-bold",
                        analysis.healthFactor > 1.5 ? "text-up" :
                        analysis.healthFactor > 1.2 ? "text-caution" : "text-down"
                      )}>
                        {analysis.healthFactor > 10 ? ">10" : analysis.healthFactor.toFixed(2)}
                      </p>
                      <div className="mt-1.5 h-1 rounded-full bg-surface overflow-hidden">
                        <div
                          className={clsx(
                            "h-full rounded-full transition-all",
                            analysis.healthFactor > 1.5 ? "bg-up" :
                            analysis.healthFactor > 1.2 ? "bg-caution" : "bg-down"
                          )}
                          style={{ width: `${Math.min(100, (analysis.healthFactor / 3) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[9px] text-fg-dim mt-1">
                        {analysis.healthFactor > 1.5 ? "Healthy" :
                         analysis.healthFactor > 1.2 ? "Caution" : "At risk"} — liquidation at 1.00
                      </p>
                    </div>
                  )}
                  {analysis.leverageActual && analysis.leverageActual > 0 && (
                    <div className="rounded-lg bg-surface-overlay p-3">
                      <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-1">Effective Leverage</p>
                      <p className="text-2xl font-mono font-bold text-btc">
                        {analysis.leverageActual.toFixed(2)}x
                      </p>
                      <div className="mt-1.5 h-1 rounded-full bg-surface overflow-hidden">
                        <div
                          className="h-full rounded-full bg-btc transition-all"
                          style={{ width: `${Math.min(100, (analysis.leverageActual / 5) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[9px] text-fg-dim mt-1">
                        Target: {vault.leverage ? `${vault.leverage.ratio.toFixed(2)}x` : "1.00x"}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Position rows */}
              <div className="space-y-2.5">
                {analysis.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-[12px] text-fg-muted">{row.label}</span>
                    <div className="text-right">
                      <span className={clsx("text-[12px] font-mono", row.color || "text-fg")}>
                        {row.value}
                      </span>
                      {row.usdValue && (
                        <span className="text-[10px] font-mono text-fg-dim ml-2">
                          ({row.usdValue})
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Net equity summary */}
              {analysis.netEquity && analysis.netEquity.btc > 0 && (
                <div className="mt-3 pt-3 border-t border-line flex justify-between items-center">
                  <span className="text-[12px] font-medium text-fg">Total Vault Equity</span>
                  <div className="text-right">
                    <span className="text-[13px] font-mono font-bold text-btc">
                      {analysis.netEquity.btc.toFixed(4)} BTC
                    </span>
                    <span className="text-[11px] font-mono text-fg-dim ml-2">
                      ({formatUsd(analysis.netEquity.usd)})
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-line">
                <a
                  href={`${VOYAGER_BASE}/contract/${contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-btc hover:underline"
                >
                  View contract on Voyager
                </a>
              </div>
            </div>
          )}

          {/* ── Strategy APY Breakdown ────────────────── */}
          <div className="rounded-xl bg-surface border border-line p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.07s" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                Strategy Breakdown
              </p>
              <p className="text-[12px] font-mono text-btc font-semibold">{formatPercent(apy.total)}</p>
            </div>
            <div className="space-y-2.5">
              {strategyBreakdown.map((item) => (
                <BreakdownRow key={item.label} item={item} />
              ))}
            </div>

            {vault.leverage && (
              <div className="mt-4 pt-3 border-t border-line space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-fg-muted">Leverage Ratio</span>
                  <span className="text-[12px] font-mono text-btc font-semibold">{vault.leverage.ratio.toFixed(2)}x</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-fg-muted">Liquidation Buffer</span>
                  <span className={clsx("text-[12px] font-mono", vault.leverage.liquidationDrop > 25 ? "text-up" : "text-caution")}>
                    BTC can drop {vault.leverage.liquidationDrop.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ── How It Works ──────────────────────────── */}
          {stratDesc && (
            <div className="rounded-xl bg-surface border border-line p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.09s" }}>
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-3">
                How It Works
              </p>
              <p className="text-[13px] font-medium text-fg mb-3">{stratDesc.title}</p>
              <div className="space-y-0">
                {stratDesc.flow.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center text-[9px] font-mono text-btc mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-[12px] text-fg-muted">{step}</span>
                  </div>
                ))}
              </div>
              {stratDesc.risks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-line">
                  <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-2">Risk Factors</p>
                  <div className="flex flex-wrap gap-1.5">
                    {stratDesc.risks.map((r) => (
                      <span key={r} className="text-[10px] font-mono text-down/80 bg-down/8 border border-down/15 px-2 py-0.5 rounded">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {performanceData.length > 0 && (
            <div className="rounded-xl bg-surface border border-line p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.11s" }}>
              <PerformanceChart data={performanceData} dataKey="apy" />
            </div>
          )}

          {/* ── Allocation ────────────────────────────── */}
          <div className="rounded-xl bg-surface border border-line p-5 animate-fade-up" style={{ animationDelay: "0.13s" }}>
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-4">
              Protocol Allocation
            </p>

            <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-overlay mb-5">
              {allocations.map((alloc, i) => (
                <div
                  key={`${alloc.protocol}-${alloc.strategy}`}
                  className={clsx("h-full", ALLOC_COLORS[i % ALLOC_COLORS.length])}
                  style={{ width: `${alloc.allocationPct}%`, opacity: 0.7 }}
                />
              ))}
            </div>

            <div className="space-y-0">
              {allocations.map((alloc, i) => (
                <div
                  key={`${alloc.protocol}-${alloc.strategy}`}
                  className="flex items-center justify-between py-3 border-b border-line last:border-0"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={clsx("w-2.5 h-2.5 rounded-sm", ALLOC_COLORS[i % ALLOC_COLORS.length])} style={{ opacity: 0.7 }} />
                    <div>
                      <p className="text-[12px] font-medium text-fg">{alloc.protocol}</p>
                      <p className="text-[10px] text-fg-dim">{alloc.strategy}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[12px] font-mono text-fg">{alloc.allocationPct}%</p>
                    <p className="text-[10px] font-mono text-up">{formatPercent(alloc.apy)} apy</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Sidebar ─────────────────────────────────── */}
        <div className="lg:w-[360px] flex-shrink-0 space-y-4">
          <div className="animate-fade-up" style={{ animationDelay: "0.08s" }}>
            <DepositWithdraw vault={vault} />
          </div>

          {/* yvBTC Token Info */}
          <div className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-fade-up" style={{ animationDelay: "0.10s" }}>
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
              yvBTC Vault Token
            </p>
            <div className="flex justify-between text-[11px]">
              <span className="text-fg-dim">Token</span>
              <span className="font-mono text-btc font-medium">yvBTC</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-fg-dim">Standard</span>
              <span className="font-mono text-fg-muted">ERC-4626</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-fg-dim">Share Price</span>
              <span className="font-mono text-fg-muted">{sharePrice.toFixed(6)} WBTC</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-fg-dim">Total Supply</span>
              <span className="font-mono text-fg-muted">
                {vaultTotals ? (Number(vaultTotals.totalSupply) / 1e8).toFixed(4) : "..."} yvBTC
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-fg-dim">Total Assets</span>
              <span className="font-mono text-fg-muted">
                {vaultTotals ? (Number(vaultTotals.totalAssets) / 1e8).toFixed(4) : "..."} WBTC
              </span>
            </div>
            {hasPosition && (
              <>
                <div className="pt-2 border-t border-line" />
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Your yvBTC</span>
                  <span className="font-mono text-btc font-semibold">
                    {userShares.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Redeemable</span>
                  <span className="font-mono text-fg-muted">
                    {userWbtc.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} WBTC
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-fade-up" style={{ animationDelay: "0.12s" }}>
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
              Vault Details
            </p>
            {[
              ["Curator", vault.curator.name],
              ["Strategy", STRAT_TAG[vault.strategy]],
              ["Risk Level", risk.label],
              ["Asset", vault.asset.symbol],
              ["Utilization", vault.utilization > 0 ? `${vault.utilization.toFixed(1)}%` : "N/A"],
              ["BTC Price", `$${vault.btcPrice.toLocaleString()}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-[11px]">
                <span className="text-fg-dim">{label}</span>
                <span className={clsx(
                  "font-mono",
                  label === "Risk Level" ? risk.color : "text-fg-muted"
                )}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
