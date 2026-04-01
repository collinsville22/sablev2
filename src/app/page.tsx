"use client";

import { useState, useMemo } from "react";
import { clsx } from "clsx";
import { VaultCard } from "@/components/vault-card";
import { useVaults, useProtocolStats } from "@/hooks/use-vault-data";
import { formatUsd, formatPercent } from "@/lib/format";
import { AnimatedNumber } from "@/components/ui/animated-number";

type FilterOption = "all" | "conservative" | "moderate" | "aggressive";

const FILTERS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "conservative", label: "Conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "aggressive", label: "Aggressive" },
];

const SORT_OPTIONS = [
  { value: "apy", label: "APY" },
  { value: "tvl", label: "TVL" },
] as const;

type SortOption = (typeof SORT_OPTIONS)[number]["value"];

const HIDDEN_VAULT_IDS = new Set(["stablecoin"]);

export default function VaultsPage() {
  const [filter, setFilter] = useState<FilterOption>("all");
  const [sort, setSort] = useState<SortOption>("tvl");
  const { vaults, loading, error } = useVaults();
  const stats = useProtocolStats();

  const pageVaults = useMemo(() => vaults.filter((v) => !HIDDEN_VAULT_IDS.has(v.id)), [vaults]);

  const filteredVaults = useMemo(() => {
    let result: typeof pageVaults;
    if (filter === "all") {
      result = [...pageVaults];
    } else if (filter === "conservative") {
      result = pageVaults.filter((v) => v.riskLevel <= 2);
    } else if (filter === "moderate") {
      result = pageVaults.filter((v) => v.riskLevel === 3 || v.riskLevel === 4);
    } else {
      result = pageVaults.filter((v) => v.riskLevel >= 4);
    }

    result.sort((a, b) => {
      if (sort === "apy") return b.apy.total - a.apy.total;
      return b.tvlUsd - a.tvlUsd;
    });

    return result;
  }, [pageVaults, filter, sort]);

  return (
    <div className="max-w-[1200px] mx-auto px-5">
      <section className="pt-16 pb-20">
        <div className="relative">
          <p className="text-[11px] font-mono text-fg-dim tracking-widest uppercase mb-4 animate-fade-up">
            Live BTC Yield on StarkNet
          </p>

          <h1 className="text-[clamp(3rem,8vw,6rem)] font-display italic leading-[0.9] tracking-tight mb-8 animate-fade-up"
              style={{ animationDelay: "0.05s" }}>
            <span className="text-fg">Earn on</span>
            <br />
            <span className="text-btc" style={{ textShadow: "0 0 80px rgba(247,147,26,0.25)" }}>
              Bitcoin.
            </span>
          </h1>

          <div className="flex flex-wrap gap-x-12 gap-y-4 animate-fade-up" style={{ animationDelay: "0.1s" }}>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Total Value Locked
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                {stats.loading ? (
                  <span className="text-fg-dim">...</span>
                ) : (
                  <>$<AnimatedNumber value={stats.totalTvl / 1_000_000} decimals={1} />M</>
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Average APY
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight text-btc">
                {stats.loading ? (
                  <span className="text-fg-dim">...</span>
                ) : (
                  <><AnimatedNumber value={stats.avgApy} decimals={2} />%</>
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Active Vaults
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                {stats.loading ? "..." : pageVaults.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-line-bright to-transparent mb-8" />

      <section className="pb-20">
        <div className="flex items-center justify-between mb-6 animate-fade-up" style={{ animationDelay: "0.15s" }}>
          <div className="flex items-center gap-px rounded-lg overflow-hidden border border-line">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={clsx(
                  "px-3 py-1.5 text-[11px] font-mono tracking-wider uppercase transition-all",
                  filter === f.value
                    ? "bg-surface-raised text-fg"
                    : "text-fg-dim hover:text-fg-muted hover:bg-surface"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-px rounded-lg overflow-hidden border border-line">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                className={clsx(
                  "px-2.5 py-1.5 text-[11px] font-mono tracking-wider uppercase transition-all",
                  sort === opt.value
                    ? "bg-surface-raised text-fg"
                    : "text-fg-dim hover:text-fg-muted hover:bg-surface"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl bg-surface border border-line p-5 h-[220px] animate-pulse"
              />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-24">
            <p className="text-down text-[13px] font-mono">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredVaults.map((vault, i) => (
              <div
                key={vault.id}
                className="animate-fade-up"
                style={{ animationDelay: `${0.18 + i * 0.05}s` }}
              >
                <VaultCard vault={vault} />
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filteredVaults.length === 0 && (
          <div className="text-center py-24">
            <p className="text-fg-dim text-[13px] font-mono">
              No vaults match this filter.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
