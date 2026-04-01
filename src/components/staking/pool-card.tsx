"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { formatUsd, formatPercent } from "@/lib/format";
import { RISK_LABELS } from "@/lib/constants";
import type { StakingPoolData } from "@/hooks/use-staking";

export function PoolCard({ pool }: { pool: StakingPoolData }) {
  const { config, totalApy, supplyApy, btcFiApr, tvlUsd, totalSuppliedBtc, utilization } = pool;
  const risk = RISK_LABELS[config.riskLevel];

  return (
    <Link
      href={`/stake/${config.slug}`}
      className="group relative block"
    >
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-line-bright/60 via-line/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative rounded-2xl bg-surface border border-line p-5 transition-colors duration-300 group-hover:bg-surface-raised group-hover:border-line-bright">

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-2xl text-btc italic leading-none">B</span>
            <div>
              <h3 className="text-[13px] font-medium text-fg leading-tight">
                {config.name}
              </h3>
              <p className="text-[10px] text-fg-dim mt-0.5 max-w-[220px] leading-relaxed">
                Direct WBTC lending — earn yield automatically
              </p>
            </div>
          </div>
          <span className={clsx(
            "text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded border",
            config.riskLevel <= 2
              ? "bg-up/10 border-up/20 text-up"
              : "bg-caution/10 border-caution/20 text-caution"
          )}>
            {risk.label} Risk
          </span>
        </div>

        <div className="mb-5">
          <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
            Total APY
          </p>
          <p
            className="text-[40px] font-mono font-bold leading-none tracking-tight text-btc"
            style={{ textShadow: "0 0 40px rgba(247,147,26,0.2)" }}
          >
            {formatPercent(totalApy)}
          </p>
        </div>

        <div className="flex gap-6 mb-5 text-[11px]">
          <div>
            <p className="text-fg-dim mb-0.5">TVL</p>
            <p className="font-mono text-fg-muted font-medium">{formatUsd(tvlUsd)}</p>
          </div>
          <div>
            <p className="text-fg-dim mb-0.5">Supplied</p>
            <p className="font-mono text-fg-muted font-medium">{totalSuppliedBtc.toFixed(2)} BTC</p>
          </div>
          <div>
            <p className="text-fg-dim mb-0.5">Utilization</p>
            <p className="font-mono text-fg-muted font-medium">{utilization.toFixed(1)}%</p>
          </div>
        </div>

        <div className="flex h-px bg-line mb-3" />

        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-3">
            <span className="font-mono text-fg-dim">
              <span className="text-up">+{formatPercent(supplyApy)}</span> base
            </span>
            {btcFiApr > 0 && (
              <span className="font-mono text-fg-dim">
                <span className="text-up">+{formatPercent(btcFiApr)}</span> STRK
              </span>
            )}
          </div>
          <span className="font-mono text-fg-dim">Vesu</span>
        </div>
      </div>
    </Link>
  );
}
