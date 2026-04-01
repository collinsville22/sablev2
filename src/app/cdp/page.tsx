"use client";

import { CdpForm } from "@/components/cdp-form";
import { useCdpStats } from "@/hooks/use-cdp";

function formatWbtc(sats: bigint): string {
  const val = Number(sats) / 1e8;
  if (val === 0) return "0";
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUsdc(raw: bigint): string {
  return (Number(raw) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CdpPage() {
  const { stats, loading: statsLoading } = useCdpStats();

  return (
    <div className="max-w-[1200px] mx-auto px-5">
      {/* ── Hero ── */}
      <section className="pt-16 pb-12">
        <div className="relative">
          <p className="text-[11px] font-mono text-fg-dim tracking-widest uppercase mb-4 animate-fade-up">
            BTC-Backed Collateralized Debt
          </p>

          <h1
            className="text-[clamp(3rem,8vw,6rem)] font-display italic leading-[0.9] tracking-tight mb-8 animate-fade-up"
            style={{ animationDelay: "0.05s" }}
          >
            <span className="text-fg">Borrow Against</span>
            <br />
            <span
              className="text-btc"
              style={{ textShadow: "0 0 80px rgba(247,147,26,0.25)" }}
            >
              BTC.
            </span>
          </h1>

          <p
            className="text-[14px] text-fg-muted max-w-[500px] mb-8 animate-fade-up"
            style={{ animationDelay: "0.08s" }}
          >
            Deposit WBTC as collateral, borrow USDC at up to 70% LTV. Manage your position with real-time health tracking powered by Nostra.
          </p>

          <div
            className="flex flex-wrap gap-x-12 gap-y-4 animate-fade-up"
            style={{ animationDelay: "0.1s" }}
          >
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Total Collateral
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight text-btc">
                {statsLoading || !stats ? "..." : `${formatWbtc(stats.totalCollateral)} WBTC`}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Total Borrowed
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                {statsLoading || !stats ? "..." : `$${formatUsdc(stats.totalDebt)}`}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Active Positions
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                {statsLoading || !stats ? "..." : stats.userCount}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-line-bright to-transparent mb-8" />

      {/* ── Two-column: Info + CDP Form ── */}
      <section
        className="pb-20 animate-fade-up"
        style={{ animationDelay: "0.15s" }}
      >
        <div className="flex flex-col lg:flex-row-reverse gap-8">
          {/* ── Form (sidebar — shown first on mobile) ── */}
          <div className="lg:w-[420px] flex-shrink-0 space-y-4">
            <div
              className="animate-fade-up"
              style={{ animationDelay: "0.18s" }}
            >
              <CdpForm />
            </div>

            <div
              className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-fade-up"
              style={{ animationDelay: "0.22s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                Powered By
              </p>
              {[
                ["Collateral", "WBTC"],
                ["Borrow Asset", "USDC"],
                ["Lending Pool", "Nostra"],
                ["Max LTV", "70%"],
                ["Oracle", "Pragma"],
                ["Liquidation", "Nostra Protocol"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">{label}</span>
                  <span className="font-mono text-fg-muted">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Info cards ── */}
          <div className="flex-1 min-w-0 space-y-4">
            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.18s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-3">
                How It Works
              </p>
              <p className="text-[13px] font-medium text-fg mb-3">
                Borrow USDC Against WBTC Collateral via Nostra
              </p>
              <div className="space-y-0">
                {[
                  "Deposit WBTC as collateral into the CDP contract",
                  "WBTC is supplied to Nostra as interest-bearing collateral",
                  "Borrow USDC against your collateral (up to 70% LTV)",
                  "Monitor your health factor — repay or add collateral to stay safe",
                  "Repay USDC debt and withdraw your WBTC anytime",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center text-[9px] font-mono text-btc mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-[12px] text-fg-muted">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.21s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-4">
                Features
              </p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "70% Max LTV", desc: "Conservative loan-to-value ratio with wide liquidation buffer" },
                  { label: "Real-Time Health", desc: "Live health factor from Pragma oracle prices" },
                  { label: "Single Transaction", desc: "Deposit + borrow or repay + withdraw in one multicall" },
                  { label: "No Lock-Up", desc: "Withdraw collateral and repay debt anytime" },
                ].map((feat) => (
                  <div key={feat.label}>
                    <p className="text-[12px] font-medium text-fg mb-0.5">{feat.label}</p>
                    <p className="text-[10px] text-fg-dim leading-relaxed">{feat.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.24s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-3">
                Risk Factors
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Liquidation risk",
                  "BTC price volatility",
                  "Smart contract risk",
                  "Oracle risk",
                  "Interest rate changes",
                ].map((r) => (
                  <span
                    key={r}
                    className="text-[10px] font-mono text-down/80 bg-down/8 border border-down/15 px-2 py-0.5 rounded"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          </div>

        </div>
      </section>
    </div>
  );
}
