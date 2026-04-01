"use client";

import { DcaForm, SELL_TOKENS } from "@/components/dca-form";
import { useKeeperFee } from "@/hooks/use-dca";

export default function DcaPage() {
  const keeperFee = useKeeperFee();
  return (
    <div className="max-w-[1200px] mx-auto px-5">
      {/* ── Hero ── */}
      <section className="pt-16 pb-12">
        <div className="relative">
          <p className="text-[11px] font-mono text-fg-dim tracking-widest uppercase mb-4 animate-fade-up">
            Smart Dollar-Cost Averaging
          </p>

          <h1
            className="text-[clamp(3rem,8vw,6rem)] font-display italic leading-[0.9] tracking-tight mb-8 animate-fade-up"
            style={{ animationDelay: "0.05s" }}
          >
            <span className="text-fg">Stack</span>
            <br />
            <span
              className="text-btc"
              style={{ textShadow: "0 0 80px rgba(247,147,26,0.25)" }}
            >
              Smarter.
            </span>
          </h1>

          <p
            className="text-[14px] text-fg-muted max-w-[500px] mb-8 animate-fade-up"
            style={{ animationDelay: "0.08s" }}
          >
            On-chain recurring BTC purchases powered by Pragma Oracle. Smart DCA uses the Mayer Multiple to buy more when BTC is cheap and less when it&apos;s expensive.
          </p>

          <div
            className="flex flex-wrap gap-x-12 gap-y-4 animate-fade-up"
            style={{ animationDelay: "0.1s" }}
          >
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Sell Tokens
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                {SELL_TOKENS.length}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Oracle
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight text-btc">
                Pragma
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                DEX Router
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                AVNU
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Keeper Fee
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                {keeperFee ? `${keeperFee}%` : "..."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-line-bright to-transparent mb-8" />

      {/* ── Two-column: Info + DCA Form ── */}
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
              <DcaForm />
            </div>

            <div
              className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-fade-up"
              style={{ animationDelay: "0.22s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                Powered By
              </p>
              {[
                ["Oracle", "Pragma (BTC/USD spot + TWAP)"],
                ["DEX Aggregator", "AVNU"],
                ["Liquidity", "Ekubo Protocol"],
                ["Buy Asset", "WBTC"],
                ["Keeper Fee", keeperFee ? `${keeperFee}% per execution` : "..."],
                ["Max Orders", "365 per schedule"],
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
                On-Chain Smart DCA via Pragma + AVNU
              </p>
              <div className="space-y-0">
                {[
                  "Deposit sell tokens into the Smart DCA contract",
                  "Pragma Oracle checks BTC price vs 200-day average (Mayer Multiple)",
                  "Keeper bot triggers execution — buys more when cheap, less when expensive",
                  "WBTC is sent directly to your wallet after each swap via AVNU",
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
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-3">
                Mayer Multiple
              </p>
              <p className="text-[13px] font-medium text-fg mb-2">
                Buy Smart, Not Blind
              </p>
              <p className="text-[11px] text-fg-dim leading-relaxed mb-3">
                The Mayer Multiple = BTC price / 200-day moving average. Backtested to outperform standard DCA by 50-60%.
              </p>
              <div className="space-y-0">
                {/* Header */}
                <div className="grid grid-cols-[90px_60px_1fr] gap-3 text-[10px] font-mono text-fg-dim/50 uppercase tracking-wider pb-1.5 mb-1 border-b border-line/50">
                  <span>Range</span>
                  <span>Buy</span>
                  <span>Signal</span>
                </div>
                {[
                  { band: "< 0.8", mult: "1.5x", label: "Very Cheap", color: "text-up" },
                  { band: "0.8 – 1.0", mult: "1.25x", label: "Below Average", color: "text-up" },
                  { band: "1.0 – 1.5", mult: "1.0x", label: "Normal", color: "text-fg-muted" },
                  { band: "1.5 – 2.0", mult: "0.75x", label: "Expensive", color: "text-caution" },
                  { band: "> 2.0", mult: "0.5x", label: "Overheated", color: "text-down" },
                ].map((b) => (
                  <div key={b.band} className="grid grid-cols-[90px_60px_1fr] gap-3 text-[11px] py-1">
                    <span className="font-mono text-fg-dim">{b.band}</span>
                    <span className={`font-mono font-medium ${b.color}`}>{b.mult}</span>
                    <span className={`text-[10px] ${b.color}`}>{b.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.24s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-4">
                Features
              </p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Fully On-Chain", desc: "Smart contract holds funds and executes swaps. No custodians." },
                  { label: "Pragma Oracle", desc: "Real-time BTC/USD spot price and 200-day TWAP from Pragma." },
                  { label: "AVNU Best Rates", desc: "Aggregates across Starknet DEXes for optimal pricing." },
                  { label: "Cancel Anytime", desc: "Cancel your order and get remaining tokens refunded instantly." },
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
              style={{ animationDelay: "0.27s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-3">
                Risk Factors
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Swap slippage",
                  "Price volatility",
                  "Smart contract risk",
                  "DEX liquidity",
                  "Oracle risk",
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
