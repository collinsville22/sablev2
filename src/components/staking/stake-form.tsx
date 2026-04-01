"use client";

import { useState, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import { clsx } from "clsx";
import { formatPercent, parseTokenAmount } from "@/lib/format";
import { TOKENS, VOYAGER_BASE } from "@/lib/constants";
import { useTokenBalance } from "@/hooks/use-vault-contract";
import { useVesuPosition, useVesuDeposit, useVesuWithdraw } from "@/hooks/use-staking";
import type { StakingPoolData } from "@/hooks/use-staking";

type Mode = "stake" | "unstake";
type Step = "input" | "pending" | "success" | "error" | "maybe-sent";
type InputDenom = "wbtc" | "usd";

function formatWbtc(value: number): string {
  if (value === 0) return "0";
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export function StakeForm({ pool }: { pool: StakingPoolData }) {
  const { isConnected, address } = useAccount();
  const [mode, setMode] = useState<Mode>("stake");
  const [amount, setAmount] = useState("");
  const [inputDenom, setInputDenom] = useState<InputDenom>("wbtc");
  const [step, setStep] = useState<Step>("input");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const btcPrice = pool.btcPrice;
  const rawInput = parseFloat(amount) || 0;
  const parsed = inputDenom === "usd" ? rawInput / btcPrice : rawInput;

  // Balances
  const { balance: wbtcBalance, loading: wbtcLoading } = useTokenBalance(TOKENS.WBTC.address);
  const { balance: vTokenBalance, loading: vTokenLoading } = useVesuPosition(pool.config.vTokenAddress);

  const displayBalance = mode === "stake" ? wbtcBalance : vTokenBalance;
  const balanceLoading = mode === "stake" ? wbtcLoading : vTokenLoading;
  // WBTC has 8 decimals, vTokens have 18 decimals
  const balanceDecimals = mode === "stake" ? TOKENS.WBTC.decimals : 18;
  const formattedBalance = displayBalance !== null
    ? (Number(displayBalance) / 10 ** balanceDecimals).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")
    : "—";

  // TX hooks
  const { deposit } = useVesuDeposit(pool.config.poolId);
  const { withdraw } = useVesuWithdraw(pool.config.poolId);

  const handleMax = () => {
    if (displayBalance !== null && displayBalance > BigInt(0)) {
      const wbtcValue = Number(displayBalance) / 10 ** balanceDecimals;
      if (inputDenom === "usd") {
        setAmount((wbtcValue * btcPrice).toFixed(2));
      } else {
        setAmount(wbtcValue.toFixed(8).replace(/0+$/, "").replace(/\.$/, ""));
      }
    }
  };

  const toggleDenom = () => {
    if (rawInput > 0) {
      if (inputDenom === "wbtc") {
        setAmount((rawInput * btcPrice).toFixed(2));
      } else {
        setAmount((rawInput / btcPrice).toFixed(8).replace(/0+$/, "").replace(/\.$/, ""));
      }
    }
    setInputDenom((d) => (d === "wbtc" ? "usd" : "wbtc"));
  };

  const secondaryValue = rawInput > 0
    ? inputDenom === "wbtc"
      ? `~$${(rawInput * btcPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : `~${(rawInput / btcPrice).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} WBTC`
    : null;

  const handleSubmit = useCallback(async () => {
    if (!isConnected || !address || parsed <= 0) return;

    setStep("pending");
    setErrorMsg(null);

    try {
      const wbtcAmount = parsed.toFixed(TOKENS.WBTC.decimals);
      const amountRaw = parseTokenAmount(wbtcAmount, TOKENS.WBTC.decimals);

      const result = mode === "stake"
        ? await deposit(amountRaw)
        : await withdraw(amountRaw);

      setTxHash(result.transaction_hash);
      setStep("success");
    } catch (e: unknown) {
      const err = e as Record<string, unknown> | Error;
      const msg = e instanceof Error ? e.message : String(e);

      const hash =
        (typeof err === "object" && err !== null &&
          ((err as Record<string, unknown>).transaction_hash as string | undefined)) ||
        undefined;

      if (hash) {
        setTxHash(hash);
        setStep("success");
      } else if (
        msg.toLowerCase().includes("reject") ||
        msg.toLowerCase().includes("abort") ||
        msg.toLowerCase().includes("cancel") ||
        msg.toLowerCase().includes("denied")
      ) {
        setErrorMsg("Transaction rejected");
        setStep("error");
      } else {
        setErrorMsg(msg);
        setStep("maybe-sent");
      }
    }
  }, [isConnected, address, parsed, mode, deposit, withdraw]);

  function resetForm() {
    setStep("input");
    setAmount("");
    setInputDenom("wbtc");
    setTxHash(null);
    setErrorMsg(null);
  }

  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      <div className="flex">
        {(["stake", "unstake"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); resetForm(); }}
            className={clsx(
              "flex-1 py-3 text-[12px] font-mono tracking-wider uppercase transition-all border-b-2",
              mode === m
                ? "text-fg border-btc bg-surface-raised"
                : "text-fg-dim border-transparent hover:text-fg-muted"
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="p-4">
        {step === "input" && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">Amount</span>
                {isConnected && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-fg-dim">
                      Bal: {balanceLoading ? "..." : formattedBalance} {mode === "stake" ? "WBTC" : pool.config.vTokenSymbol}
                    </span>
                    {displayBalance !== null && displayBalance > BigInt(0) && (
                      <button
                        onClick={handleMax}
                        className="text-[9px] font-mono font-semibold text-btc bg-btc/10 hover:bg-btc/20 px-1.5 py-0.5 rounded transition-colors"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={inputDenom === "usd" ? "0.00" : "0.00000000"}
                  className="w-full bg-void border border-line rounded-lg px-3 py-3 pr-20 text-xl font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/40 transition-colors"
                />
                <button
                  onClick={toggleDenom}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-fg-dim hover:text-btc transition-colors flex items-center gap-1"
                  title="Toggle USD / WBTC input"
                >
                  {inputDenom === "usd" ? "USD" : mode === "unstake" ? pool.config.vTokenSymbol : "WBTC"}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </button>
              </div>
              {secondaryValue && (
                <p className="text-[10px] font-mono text-fg-dim mt-1 pl-1">{secondaryValue}</p>
              )}
            </div>

            <div className="space-y-1.5">
              {[
                ["APY", formatPercent(pool.totalApy)],
                ["Pool", pool.config.name],
                ["BTC Price", `$${pool.btcPrice.toLocaleString()}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">{label}</span>
                  <span className={clsx("font-mono", label === "APY" ? "text-btc" : "text-fg-muted")}>{value}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleSubmit}
              disabled={!isConnected || parsed <= 0}
              className={clsx(
                "w-full py-3 rounded-lg text-[12px] font-mono tracking-wider uppercase transition-all",
                isConnected && parsed > 0
                  ? "bg-btc/15 text-btc border border-btc/25 hover:bg-btc/25"
                  : "bg-surface-overlay text-fg-dim border border-line cursor-not-allowed"
              )}
            >
              {!isConnected
                ? "Connect Wallet"
                : parsed <= 0
                  ? "Enter Amount"
                  : mode === "stake"
                    ? "Stake WBTC"
                    : "Unstake"}
            </button>
          </div>
        )}

        {step === "pending" && (
          <div className="text-center py-8 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center animate-pulse">
              <span className="font-display text-lg text-btc italic">B</span>
            </div>
            <p className="text-[13px] font-medium text-fg">Confirm in wallet...</p>
            <p className="text-[11px] text-fg-dim font-mono">
              {mode === "stake" ? "Approving & staking" : "Unstaking"} {formatWbtc(parsed)} WBTC
            </p>
          </div>
        )}

        {step === "success" && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-up/10 border border-up/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3DD68C" strokeWidth="2.5" strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-fg">
              {formatWbtc(parsed)} WBTC {mode === "stake" ? "staked" : "unstaked"}
            </p>
            {txHash && (
              <a
                href={`${VOYAGER_BASE}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-btc hover:underline"
              >
                View on Voyager
              </a>
            )}
            <button
              onClick={resetForm}
              className="block mx-auto text-[11px] font-mono text-fg-dim hover:text-fg-muted transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-down/10 border border-down/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-fg">Transaction Failed</p>
            <p className="text-[11px] text-fg-dim font-mono max-w-[280px] mx-auto truncate">
              {errorMsg}
            </p>
            <button
              onClick={resetForm}
              className="text-[11px] font-mono text-btc hover:underline"
            >
              Try Again
            </button>
          </div>
        )}

        {step === "maybe-sent" && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-btc">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-fg">Transaction may have been submitted</p>
            <p className="text-[11px] text-fg-dim font-mono max-w-[280px] mx-auto">
              Your wallet reported an error, but the transaction may still have gone through. Please refresh to check your balance.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="text-[11px] font-mono text-btc hover:underline"
            >
              Refresh Page
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
