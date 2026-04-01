"use client";

import { BridgeForm } from "@/components/bridge/bridge-form";

export default function BridgePage() {
  return (
    <div className="max-w-[1200px] mx-auto px-5">
      {/* ── Hero ──────────────────────────────────────── */}
      <section className="pt-16 pb-12">
        <div className="relative">
          <p className="text-[11px] font-mono text-fg-dim tracking-widest uppercase mb-4 animate-fade-up">
            Cross-Chain BTC Bridge
          </p>

          <h1
            className="text-[clamp(3rem,8vw,6rem)] font-display italic leading-[0.9] tracking-tight mb-8 animate-fade-up"
            style={{ animationDelay: "0.05s" }}
          >
            <span className="text-fg">Move to</span>
            <br />
            <span
              className="text-btc"
              style={{ textShadow: "0 0 80px rgba(247,147,26,0.25)" }}
            >
              Starknet.
            </span>
          </h1>

          <div
            className="flex flex-wrap gap-x-12 gap-y-4 animate-fade-up"
            style={{ animationDelay: "0.1s" }}
          >
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Supported Chains
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                Multi
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Bridge Speed
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight text-btc">
                ~30s
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
                Destination Asset
              </p>
              <p className="text-2xl font-mono font-bold tracking-tight">
                STRK
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-transparent via-line-bright to-transparent mb-8" />

      {/* ── Two-column: Info + Bridge Widget ── */}
      <section
        className="pb-20 animate-fade-up"
        style={{ animationDelay: "0.15s" }}
      >
        <div className="flex flex-col lg:flex-row-reverse gap-8">
          {/* ── Info cards ── */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* How it works */}
            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.18s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-3">
                How It Works
              </p>
              <p className="text-[13px] font-medium text-fg mb-3">
                Direct Bridge via NEAR Intents
              </p>
              <div className="space-y-0">
                {[
                  "Select source chain & token (Ethereum, Solana, etc.)",
                  "NEAR Intents bridges directly to Starknet",
                  "STRK arrives in your Starknet wallet",
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

            {/* Bridge OUT info */}
            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.21s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-3">
                Bridge Out
              </p>
              <p className="text-[13px] font-medium text-fg mb-3">
                Send STRK to Any Chain
              </p>
              <div className="space-y-0">
                {[
                  "Transfer STRK to the bridge on Starknet",
                  "NEAR Intents bridges to your destination chain",
                  "Receive native tokens (ETH, BTC, USDC, etc.)",
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

            {/* Features */}
            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.24s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase mb-4">
                Features
              </p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    label: "Non-Custodial",
                    desc: "Funds route through smart contracts, not custodians",
                  },
                  {
                    label: "Direct Transfer",
                    desc: "Bridge OUT sends STRK directly — no intermediate swaps",
                  },
                  {
                    label: "Best Rates",
                    desc: "NEAR Intents solver network finds optimal routes",
                  },
                  {
                    label: "Auto-Refund",
                    desc: "Failed bridges automatically refund to source chain",
                  },
                ].map((feat) => (
                  <div key={feat.label}>
                    <p className="text-[12px] font-medium text-fg mb-0.5">
                      {feat.label}
                    </p>
                    <p className="text-[10px] text-fg-dim leading-relaxed">
                      {feat.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk factors */}
            <div
              className="rounded-xl bg-surface border border-line p-5 animate-fade-up"
              style={{ animationDelay: "0.27s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-3">
                Risk Factors
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Bridge protocol risk",
                  "Price volatility during bridge",
                  "Smart contract risk",
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

          {/* ── Bridge Form (sidebar — shown first on mobile) ── */}
          <div className="lg:w-[420px] flex-shrink-0 space-y-4">
            <div
              className="animate-fade-up"
              style={{ animationDelay: "0.18s" }}
            >
              <BridgeForm />
            </div>

            {/* Powered by card */}
            <div
              className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-fade-up"
              style={{ animationDelay: "0.22s" }}
            >
              <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
                Powered By
              </p>
              {[
                ["Cross-chain Bridge", "NEAR Intents (1Click)"],
                ["Settlement", "~30 seconds"],
                ["Asset", "STRK (Starknet)"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">{label}</span>
                  <span className="font-mono text-fg-muted">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
