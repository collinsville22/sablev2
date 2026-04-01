"use client";

import { useStakingPools } from "@/hooks/use-staking";
import { PoolCard } from "@/components/staking/pool-card";
import { formatUsd, formatPercent } from "@/lib/format";

export default function StakePage() {
  const { pools, loading, error, refresh } = useStakingPools();

  const totalTvl = pools.reduce((sum, p) => sum + p.tvlUsd, 0);
  const avgApy = pools.length > 0
    ? pools.reduce((sum, p) => sum + p.totalApy, 0) / pools.length
    : 0;

  return (
    <div className="max-w-[1200px] mx-auto px-5">
      {/* ── Hero ── */}
      <section className="pt-16 pb-12">
        <div className="relative">
          <p className="text-[11px] font-mono text-fg-dim tracking-widest uppercase mb-4 animate-fade-up">
            WBTC Staking
          </p>

          <h1
            className="text-[clamp(3rem,8vw,6rem)] font-display italic leading-[0.9] tracking-tight mb-8 animate-fade-up"
            style={{ animationDelay: "0.05s" }}
          >
            <span className="text-fg">Stake BTC,</span>
            <br />
            <span
              className="text-btc"
              style={{ textShadow: "0 0 80px rgba(247,147,26,0.25)" }}
            >
              Earn STRK.
            </span>
          </h1>

          <p
            className="text-[14px] text-fg-muted max-w-[500px] mb-8 animate-fade-up"
            style={{ animationDelay: "0.08s" }}
          >
            Supply WBTC directly to Vesu lending pools. Earn base lending yield plus STRK rewards from the BTCFi Season incentive program.
          </p>

          <div
            className="flex flex-wrap gap-x-12 gap-y-4 animate-fade-up"
            style={{ animationDelay: "0.1s" }}
          >
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Total TVL
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                {loading ? "..." : formatUsd(totalTvl)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Avg APY
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight text-btc">
                {loading ? "..." : formatPercent(avgApy)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Protocol
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                Vesu
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-line-bright to-transparent mb-8" />

      {/* ── Pool cards ── */}
      <section className="pb-20">
        {loading ? (
          <div className="text-center py-16">
            <p className="text-fg-dim font-mono text-[13px] animate-pulse">Loading staking pools...</p>
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-fg-dim font-mono text-[13px] mb-4">{error}</p>
            <button
              onClick={refresh}
              className="text-[12px] font-mono text-btc hover:text-btc/80 transition-colors underline underline-offset-4"
            >
              Retry
            </button>
          </div>
        ) : pools.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-fg-dim font-mono text-[13px] mb-4">No pools found</p>
            <button
              onClick={refresh}
              className="text-[12px] font-mono text-btc hover:text-btc/80 transition-colors underline underline-offset-4"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {pools.map((pool) => (
              <PoolCard key={pool.config.slug} pool={pool} />
            ))}
          </div>
        )}

        {/* Info card */}
        <div
          className="mt-8 rounded-xl bg-surface border border-line p-5 animate-fade-up"
          style={{ animationDelay: "0.2s" }}
        >
          <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-3">
            About WBTC Staking
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-[12px]">
            <div>
              <p className="font-medium text-fg mb-1">Direct Supply</p>
              <p className="text-fg-dim leading-relaxed">
                Your WBTC is supplied directly to Vesu lending pools. No intermediary contracts or custodians.
              </p>
            </div>
            <div>
              <p className="font-medium text-fg mb-1">BTCFi Season</p>
              <p className="text-fg-dim leading-relaxed">
                100M STRK incentive program rewards Bitcoin liquidity on Starknet. Earn STRK on top of lending yield.
              </p>
            </div>
            <div>
              <p className="font-medium text-fg mb-1">Interest-Bearing</p>
              <p className="text-fg-dim leading-relaxed">
                You receive vTokens that automatically appreciate. Withdraw anytime to receive your WBTC plus earned yield.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
