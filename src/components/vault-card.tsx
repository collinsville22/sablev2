"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { formatUsd, formatPercent } from "@/lib/format";
import { RISK_LABELS } from "@/lib/constants";
import type { LiveVault } from "@/lib/api/vaults";

const ALLOC_COLORS = ["bg-btc", "bg-up", "bg-caution", "bg-fg-dim"];

export function VaultCard({ vault }: { vault: LiveVault }) {
  const { apy, allocations, riskLevel, description } = vault;
  const risk = RISK_LABELS[riskLevel];

  return (
    <Link
      href={`/vault/${vault.id}`}
      className="group relative block"
    >
      <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-line-bright/60 via-line/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative rounded-2xl bg-surface border border-line p-5 transition-colors duration-300 group-hover:bg-surface-raised group-hover:border-line-bright">

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-2xl text-btc italic leading-none">B</span>
            <div>
              <h3 className="text-[13px] font-medium text-fg leading-tight">
                {vault.name}
              </h3>
              <p className="text-[10px] text-fg-dim mt-0.5 max-w-[200px] leading-relaxed">
                {description}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={clsx(
              "text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded border",
              riskLevel <= 2
                ? "bg-up/10 border-up/20 text-up"
                : riskLevel === 3
                  ? "bg-caution/10 border-caution/20 text-caution"
                  : "bg-down/10 border-down/20 text-down"
            )}>
              {risk.label} Risk
            </span>
          </div>
        </div>

        <div className="mb-5">
          <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
            Net APY
          </p>
          <p className="text-[40px] font-mono font-bold leading-none tracking-tight text-btc"
             style={{ textShadow: "0 0 40px rgba(247,147,26,0.2)" }}>
            {formatPercent(apy.total)}
          </p>
        </div>

        <div className="flex gap-6 mb-5 text-[11px]">
          <div>
            <p className="text-fg-dim mb-0.5">TVL</p>
            <p className="font-mono text-fg-muted font-medium">{formatUsd(vault.tvlUsd)}</p>
          </div>
          <div>
            <p className="text-fg-dim mb-0.5">Supplied</p>
            <p className="font-mono text-fg-muted font-medium">{vault.totalSuppliedBtc.toFixed(2)} BTC</p>
          </div>
          {vault.leverage ? (
            <div>
              <p className="text-fg-dim mb-0.5">Leverage</p>
              <p className="font-mono text-btc font-medium">{vault.leverage.ratio.toFixed(2)}x</p>
            </div>
          ) : vault.utilization > 0 ? (
            <div>
              <p className="text-fg-dim mb-0.5">Utilization</p>
              <p className="font-mono text-fg-muted font-medium">{vault.utilization.toFixed(1)}%</p>
            </div>
          ) : (
            <div>
              <p className="text-fg-dim mb-0.5">Risk</p>
              <p className={clsx("font-mono font-medium", risk.color)}>{risk.label}</p>
            </div>
          )}
        </div>

        <div className="flex h-px bg-line mb-3" />

        <div className="flex items-center gap-2">
          <div className="flex h-1 flex-1 rounded-full overflow-hidden bg-surface-overlay">
            {allocations.map((alloc, i) => (
              <div
                key={`${alloc.protocol}-${alloc.strategy}`}
                className={clsx("h-full", ALLOC_COLORS[i % ALLOC_COLORS.length])}
                style={{ width: `${alloc.allocationPct}%`, opacity: 0.7 }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {allocations.map((alloc, i) => (
              <span key={`${alloc.protocol}-${alloc.strategy}`} className="text-[9px] font-mono text-fg-dim">
                <span className={clsx("inline-block w-1 h-1 rounded-full mr-0.5 align-middle", ALLOC_COLORS[i % ALLOC_COLORS.length])} style={{ opacity: 0.7 }} />
                {alloc.protocol}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
