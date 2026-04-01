"use client";

import { useState, useCallback } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { clsx } from "clsx";
import { formatPercent } from "@/lib/format";
import { TOKENS } from "@/lib/constants";
import { parseTokenAmount } from "@/lib/format";
import { useTokenBalance, useMinDeposit } from "@/hooks/use-vault-contract";
import type { LiveVault } from "@/lib/api/vaults";

type Mode = "deposit" | "withdraw";
type Step = "input" | "pending" | "success" | "error" | "maybe-sent";
type InputDenom = "wbtc" | "usd";

/** Format WBTC amount with enough decimals to show meaningful digits */
function formatWbtc(value: number): string {
  if (value === 0) return "0";
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export function DepositWithdraw({ vault }: { vault: LiveVault }) {
  const { isConnected, address } = useAccount();
  const { sendAsync } = useSendTransaction({});
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [inputDenom, setInputDenom] = useState<InputDenom>("wbtc");
  const [step, setStep] = useState<Step>("input");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const btcPrice = vault.btcPrice;
  const rawInput = parseFloat(amount) || 0;
  const parsed = inputDenom === "usd" ? rawInput / btcPrice : rawInput;
  const vTokenAddress = vault.vTokenAddress;
  const hasVault = !!vTokenAddress;

  const minDepositSats = useMinDeposit(vTokenAddress);
  const minDepositWbtc = minDepositSats !== null ? Number(minDepositSats) / 1e8 : null;
  const minDepositUsd = minDepositWbtc !== null ? minDepositWbtc * btcPrice : null;
  const isBelowMinimum = mode === "deposit" && minDepositWbtc !== null && parsed > 0 && parsed < minDepositWbtc;

  const { balance: wbtcBalance, loading: wbtcLoading } = useTokenBalance(TOKENS.WBTC.address);
  const { balance: shareBalance, loading: shareLoading } = useTokenBalance(vTokenAddress);

  const displayBalance = mode === "deposit" ? wbtcBalance : shareBalance;
  const balanceLoading = mode === "deposit" ? wbtcLoading : shareLoading;
  const balanceDecimals = TOKENS.WBTC.decimals;
  const formattedBalance = displayBalance !== null
    ? (Number(displayBalance) / 10 ** balanceDecimals).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")
    : "\u2014";

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

  const handleNormalSubmit = useCallback(async () => {
    if (!isConnected || !address || parsed <= 0 || !vTokenAddress) return;

    setStep("pending");
    setErrorMsg(null);

    try {
      const wbtcAmount = parsed.toFixed(TOKENS.WBTC.decimals);
      const amountRaw = parseTokenAmount(wbtcAmount, TOKENS.WBTC.decimals);

      if (mode === "deposit") {
        const result = await sendAsync([
          {
            contractAddress: TOKENS.WBTC.address,
            entrypoint: "approve",
            calldata: [vTokenAddress, amountRaw.toString(), "0"],
          },
          {
            contractAddress: vTokenAddress,
            entrypoint: "deposit",
            calldata: [amountRaw.toString(), "0", address],
          },
        ]);
        setTxHash(result.transaction_hash);
      } else {
        const result = await sendAsync([
          {
            contractAddress: vTokenAddress,
            entrypoint: "redeem",
            calldata: [amountRaw.toString(), "0", address, address],
          },
        ]);
        setTxHash(result.transaction_hash);
      }

      setStep("success");
    } catch (e: unknown) {
      const err = e as Record<string, unknown> | Error;
      const msg = e instanceof Error ? e.message : String(e);

      const hash =
        (typeof err === "object" && err !== null &&
          ((err as Record<string, unknown>).transaction_hash as string |
            undefined)) ||
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
  }, [isConnected, address, parsed, vTokenAddress, amount, mode, sendAsync]);

  function resetForm() {
    setStep("input");
    setAmount("");
    setInputDenom("wbtc");
    setTxHash(null);
    setErrorMsg(null);
  }

  const canSubmit = (() => {
    if (!isConnected) return false;
    if (!hasVault) return false;
    if (mode === "deposit") return parsed > 0 && !isBelowMinimum;
    return parsed > 0;
  })();

  const buttonLabel = (() => {
    if (!isConnected) return "Connect Wallet";
    if (!hasVault) return "No Vault Contract";
    if (mode === "deposit") {
      if (parsed <= 0) return "Enter Amount";
      if (isBelowMinimum) return "Below Minimum";
      return "Deposit WBTC";
    }
    if (parsed <= 0) return "Enter Amount";
    return "Withdraw";
  })();

  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      {/* Mode tabs: Deposit / Withdraw */}
      <div className="flex">
        {(["deposit", "withdraw"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { resetForm(); setMode(m); }}
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
            {!hasVault && (
              <div className="rounded-lg bg-btc/5 border border-btc/15 p-3">
                <p className="text-[11px] text-btc font-mono">
                  Direct deposit via Vesu vToken. Your WBTC earns yield automatically.
                </p>
              </div>
            )}

            {/* Amount input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">Amount</span>
                {isConnected && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-fg-dim">
                      Bal: {balanceLoading ? "..." : formattedBalance} {mode === "deposit" ? "WBTC" : "vWBTC"}
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
                  {inputDenom === "usd" ? "USD" : mode === "withdraw" && vault.vTokenAddress ? "vWBTC" : "WBTC"}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </button>
              </div>
              {secondaryValue && (
                <p className="text-[10px] font-mono text-fg-dim mt-1 pl-1">{secondaryValue}</p>
              )}
            </div>

            {/* Min deposit warning */}
            {mode === "deposit" && minDepositWbtc !== null && minDepositWbtc > 0 && (
              <div className={clsx(
                "rounded-lg p-2.5 text-[10px] font-mono",
                isBelowMinimum
                  ? "bg-down/8 border border-down/20 text-down"
                  : "bg-surface-overlay border border-line text-fg-dim"
              )}>
                {isBelowMinimum ? (
                  <span>Minimum deposit: <span className="font-semibold">{formatWbtc(minDepositWbtc)} WBTC</span> (~${minDepositUsd?.toFixed(2)})</span>
                ) : (
                  <span>Min: {formatWbtc(minDepositWbtc)} WBTC (~${minDepositUsd?.toFixed(2)})</span>
                )}
              </div>
            )}

            {/* Info rows */}
            <div className="space-y-1.5">
              {[
                ["APY", formatPercent(vault.apy.total)],
                ["Protocol", vault.curator.name],
                ["BTC Price", `$${vault.btcPrice.toLocaleString()}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">{label}</span>
                  <span className={clsx("font-mono", label === "APY" ? "text-btc" : "text-fg-muted")}>{value}</span>
                </div>
              ))}
            </div>

            {/* Submit button */}
            <button
              onClick={handleNormalSubmit}
              disabled={!canSubmit}
              className={clsx(
                "w-full py-3 rounded-lg text-[12px] font-mono tracking-wider uppercase transition-all",
                canSubmit
                  ? "bg-btc/15 text-btc border border-btc/25 hover:bg-btc/25"
                  : "bg-surface-overlay text-fg-dim border border-line cursor-not-allowed"
              )}
            >
              {buttonLabel}
            </button>
          </div>
        )}

        {/* Pending state */}
        {step === "pending" && (
          <div className="text-center py-8 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center animate-pulse">
              <span className="font-display text-lg text-btc italic">B</span>
            </div>
            <p className="text-[13px] font-medium text-fg">Confirm in wallet...</p>
            <p className="text-[11px] text-fg-dim font-mono">
              {`${mode === "deposit" ? "Approving & depositing" : "Withdrawing"} ${formatWbtc(parsed)} WBTC`}
            </p>
          </div>
        )}

        {/* Success state */}
        {step === "success" && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-up/10 border border-up/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3DD68C" strokeWidth="2.5" strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-fg">
              {`${formatWbtc(parsed)} WBTC ${mode === "deposit" ? "deposited" : "withdrawn"}`}
            </p>

            {txHash && (
              <a
                href={`https://voyager.online/tx/${txHash}`}
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
