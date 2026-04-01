"use client";

import { use } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { formatUsd, formatPercent } from "@/lib/format";
import { RISK_LABELS, VOYAGER_BASE, VESU_SINGLETON } from "@/lib/constants";
import { useStakingPool, useVesuPosition, getPoolBySlug } from "@/hooks/use-staking";
import { useTokenBalance } from "@/hooks/use-vault-contract";
import { TOKENS } from "@/lib/constants";
import { useAccount } from "@starknet-react/core";
import { StakeForm } from "@/components/staking/stake-form";

export default function StakePoolPage({
  params,
}: {
  params: Promise<{ pool: string }>;
}) {
  const { pool: slug } = use(params);
  const config = getPoolBySlug(slug);
  const { pool, loading, error } = useStakingPool(slug);
  const { isConnected } = useAccount();

  const vTokenAddress = config?.vTokenAddress ?? "";
  const { balance: vTokenBalance } = useVesuPosition(vTokenAddress);
  const { balance: wbtcBalance } = useTokenBalance(TOKENS.WBTC.address);

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-24 text-center">
        <p className="text-fg-dim font-mono text-[13px] animate-pulse">Loading pool data...</p>
      </div>
    );
  }

  if (error || !pool || !config) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-24 text-center">
        <p className="text-fg-dim font-mono text-[13px]">{error || "Pool not found."}</p>
        <Link href="/stake" className="text-btc text-[13px] mt-3 inline-block hover:underline">
          Back to staking
        </Link>
      </div>
    );
  }

  const risk = RISK_LABELS[config.riskLevel];
  const hasPosition = isConnected && vTokenBalance !== null && vTokenBalance > BigInt(0);
  // vTokens have 18 decimals, WBTC has 8 decimals
  const userVTokens = vTokenBalance ? Number(vTokenBalance) / 1e18 : 0;
  // vTokens are interest-bearing, approximate 1:1 with WBTC (accrues over time)
  const userWbtcApprox = userVTokens;
  const userUsd = userWbtcApprox * pool.btcPrice;

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <Link
        href="/stake"
        className="inline-flex items-center gap-1 text-[12px] text-fg-dim hover:text-fg-muted transition-colors mb-8 font-mono"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        staking
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* ── Left column ── */}
        <div className="flex-1 min-w-0">
          {/* Hero */}
          <div className="mb-8 animate-fade-up">
            <div className="flex items-center gap-3 mb-4">
              <span className="font-display text-3xl text-btc italic leading-none">B</span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-medium">{config.name}</h1>
                  <span className="text-[9px] font-mono tracking-widest text-fg-dim uppercase bg-surface-overlay px-1.5 py-0.5 rounded">
                    STAKE
                  </span>
                  <span className={clsx(
                    "text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded border",
                    config.riskLevel <= 2
                      ? "bg-up/10 border-up/20 text-up"
                      : "bg-caution/10 border-caution/20 text-caution"
                  )}>
                    {risk.label}
                  </span>
                </div>
                <p className="text-[11px] text-fg-dim font-mono mt-0.5">
                  {config.description}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-10 gap-y-3">
              <div>
                <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">APY</p>
                <p className="text-4xl font-mono font-bold tracking-tight text-btc"
                   style={{ textShadow: "0 0 40px rgba(247,147,26,0.15)" }}>
                  {formatPercent(pool.totalApy)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">TVL</p>
                <p className="text-4xl font-mono font-bold tracking-tight">{formatUsd(pool.tvlUsd)}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">Supplied</p>
                <p className="text-4xl font-mono font-bold tracking-tight">{pool.totalSuppliedBtc.toFixed(2)} BTC</p>
              </div>
            </div>
          </div>

          {/* Your Position */}
          {hasPosition && (
            <div className="rounded-xl bg-surface border border-btc/20 p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.03s" }}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                  Your Position
                </p>
                <span className="text-[9px] font-mono tracking-wider uppercase px-2 py-0.5 rounded bg-up/15 text-up">
                  Active
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-[10px] font-mono text-fg-dim mb-0.5">{config.vTokenSymbol}</p>
                  <p className="text-xl font-mono font-bold text-btc">
                    {userVTokens.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-fg-dim mb-0.5">WBTC Value</p>
                  <p className="text-xl font-mono font-bold">
                    ~{userWbtcApprox.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-mono text-fg-dim mb-0.5">USD Value</p>
                  <p className="text-xl font-mono font-bold">
                    {formatUsd(userUsd)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-3 border-t border-line">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-fg-dim">Earning:</span>
                  <span className="text-[11px] font-mono text-up">{formatPercent(pool.totalApy)} APY</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-fg-dim">Pool:</span>
                  <span className="text-[11px] font-mono text-fg-muted">{config.name}</span>
                </div>
              </div>
            </div>
          )}

          {/* APY Breakdown */}
          <div className="rounded-xl bg-surface border border-line p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.05s" }}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                APY Breakdown
              </p>
              <p className="text-[12px] font-mono text-btc font-semibold">{formatPercent(pool.totalApy)}</p>
            </div>
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-[12px] text-fg-muted">Base Supply APY</span>
                <span className="text-[12px] font-mono text-up">+{formatPercent(pool.supplyApy)}</span>
              </div>
              {pool.btcFiApr > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-fg-muted">STRK BTCFi Rewards</span>
                  <span className="text-[12px] font-mono text-up">+{formatPercent(pool.btcFiApr)}</span>
                </div>
              )}
              <div className="flex justify-between items-center border-t border-line pt-2 mt-2">
                <span className="text-[12px] text-fg font-medium">Total APY</span>
                <span className="text-[12px] font-mono text-btc font-bold">{formatPercent(pool.totalApy)}</span>
              </div>
            </div>
          </div>

          {/* How It Works */}
          <div className="rounded-xl bg-surface border border-line p-5 mb-6 animate-fade-up" style={{ animationDelay: "0.07s" }}>
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-3">
              How It Works
            </p>
            <p className="text-[13px] font-medium text-fg mb-3">Direct WBTC Supply</p>
            <div className="space-y-0">
              {config.howItWorks.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5 py-1.5">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center text-[9px] font-mono text-btc mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-[12px] text-fg-muted">{step}</span>
                </div>
              ))}
            </div>
            {config.risks.length > 0 && (
              <div className="mt-3 pt-3 border-t border-line">
                <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-2">Risk Factors</p>
                <div className="flex flex-wrap gap-1.5">
                  {config.risks.map((r) => (
                    <span key={r} className="text-[10px] font-mono text-down/80 bg-down/8 border border-down/15 px-2 py-0.5 rounded">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pool Stats */}
          <div className="rounded-xl bg-surface border border-line p-5 animate-fade-up" style={{ animationDelay: "0.09s" }}>
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-4">
              Pool Statistics
            </p>
            <div className="space-y-2.5">
              {[
                ["Utilization", `${pool.utilization.toFixed(1)}%`],
                ["Borrow APR", formatPercent(pool.borrowApr)],
                ["Total Supplied", `${pool.totalSuppliedBtc.toFixed(4)} WBTC`],
                ["TVL", formatUsd(pool.tvlUsd)],
                ["BTC Price", `$${pool.btcPrice.toLocaleString()}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-[12px] text-fg-muted">{label}</span>
                  <span className="text-[12px] font-mono text-fg">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="lg:w-[360px] flex-shrink-0 space-y-4">
          <div className="animate-fade-up" style={{ animationDelay: "0.05s" }}>
            <StakeForm pool={pool} />
          </div>

          {/* vToken info */}
          <div className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-fade-up" style={{ animationDelay: "0.08s" }}>
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
              {config.vTokenSymbol} Token
            </p>
            {[
              ["Token", config.vTokenSymbol],
              ["Type", "Interest-bearing"],
              ["Protocol", "Vesu Finance"],
              ["Pool", config.name],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-[11px]">
                <span className="text-fg-dim">{label}</span>
                <span className="font-mono text-fg-muted">{value}</span>
              </div>
            ))}
            {hasPosition && (
              <>
                <div className="pt-2 border-t border-line" />
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Your {config.vTokenSymbol}</span>
                  <span className="font-mono text-btc font-semibold">
                    {userVTokens.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Contract info */}
          <div className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-fade-up" style={{ animationDelay: "0.10s" }}>
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
              Contracts
            </p>
            <div className="space-y-2">
              <div>
                <p className="text-[10px] text-fg-dim mb-0.5">Vesu Singleton</p>
                <a
                  href={`${VOYAGER_BASE}/contract/${VESU_SINGLETON}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-btc hover:underline break-all"
                >
                  {VESU_SINGLETON.slice(0, 10)}...{VESU_SINGLETON.slice(-6)}
                </a>
              </div>
              <div>
                <p className="text-[10px] text-fg-dim mb-0.5">{config.vTokenSymbol}</p>
                <a
                  href={`${VOYAGER_BASE}/contract/${config.vTokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-btc hover:underline break-all"
                >
                  {config.vTokenAddress.slice(0, 10)}...{config.vTokenAddress.slice(-6)}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
