"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { RpcProvider } from "starknet";
import { clsx } from "clsx";
import { useCdpPosition, useCdpActions } from "@/hooks/use-cdp";
import { VOYAGER_BASE, TOKENS, SABLE_CONTRACTS } from "@/lib/constants";
import { STARKNET_RPC } from "@/lib/rpc";
import { fetchBtcPrice } from "@/lib/api/price";

type Mode = "borrow" | "repay";
type Step = "input" | "pending" | "success" | "error";

const MAX_LTV = 0.7;
// Nostra minimum borrow is 50 USDC (from dUSDC.min_debt())
const NOSTRA_MIN_BORROW_USDC = 50;
// Minimum WBTC deposit: no protocol floor, but use $5 as practical minimum
const MIN_DEPOSIT_USD = 5;

function fmtBtc(sats: bigint): string {
  const val = Number(sats) / 1e8;
  if (val === 0) return "0";
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function fmtUsd(raw: bigint): string {
  return (Number(raw) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDollar(v: number): string {
  if (v === 0) return "$0";
  return "$" + v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 });
}

function healthColor(hf: number): string {
  if (hf >= 2) return "text-up";
  if (hf >= 1.5) return "text-caution";
  return "text-down";
}

function ltvColor(pct: number): string {
  if (pct <= 45) return "text-up";
  if (pct <= 60) return "text-caution";
  return "text-down";
}

function ltvBarColor(pct: number): string {
  if (pct <= 45) return "bg-up";
  if (pct <= 60) return "bg-caution";
  return "bg-down";
}

export function CdpForm() {
  const { isConnected, address } = useAccount();
  const { position, loading: posLoading } = useCdpPosition();
  const { depositAndBorrow, repayAndWithdraw, closePosition, status, error: actionError } = useCdpActions();

  const [btcPrice, setBtcPrice] = useState(0);
  const [priceLoading, setPriceLoading] = useState(true);

  useEffect(() => {
    fetchBtcPrice().then((p) => { setBtcPrice(p); setPriceLoading(false); });
    const id = setInterval(() => { fetchBtcPrice().then(setBtcPrice); }, 30_000);
    return () => clearInterval(id);
  }, []);

  const minWbtc = btcPrice > 0 ? MIN_DEPOSIT_USD / btcPrice : 0;

  const [mode, setMode] = useState<Mode>("borrow");
  const [step, setStep] = useState<Step>("input");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [wbtcInput, setWbtcInput] = useState("");
  const [ltvPct, setLtvPct] = useState(50);

  const [repayPct, setRepayPct] = useState(100);
  const [withdrawPct, setWithdrawPct] = useState(0);

  function resetForm() {
    setStep("input");
    setTxHash(null);
    setErrorMsg(null);
    setWbtcInput("");
    setLtvPct(50);
    setRepayPct(100);
    setWithdrawPct(0);
  }

  const borrowPreview = useMemo(() => {
    const colBtc = parseFloat(wbtcInput || "0");
    const existingCol = position ? Number(position.collateral) / 1e8 : 0;
    const existingDebt = position ? Number(position.debt) / 1e6 : 0;

    const totalCol = existingCol + colBtc;
    const colUsd = totalCol * btcPrice;
    const maxBorrow = colUsd * MAX_LTV;
    const borrowAmount = colBtc * btcPrice * (ltvPct / 100);
    const totalDebt = existingDebt + borrowAmount;
    const actualLtv = colUsd > 0 ? (totalDebt / colUsd) * 100 : 0;
    const healthFactor = totalDebt > 0 ? (colUsd * MAX_LTV) / totalDebt : Infinity;
    const liqPrice = totalDebt > 0 && totalCol > 0 ? totalDebt / (totalCol * MAX_LTV) : 0;

    return {
      colBtc,
      colUsd: colBtc * btcPrice,
      totalCol,
      totalColUsd: colUsd,
      maxBorrow,
      borrowAmount,
      totalDebt,
      actualLtv,
      healthFactor,
      liqPrice,
      isOverLtv: actualLtv > 70,
      isBelowMin: colBtc > 0 && colBtc < minWbtc,
      isBelowMinBorrow: borrowAmount > 0 && borrowAmount < NOSTRA_MIN_BORROW_USDC,
    };
  }, [wbtcInput, ltvPct, position, btcPrice, minWbtc]);

  const repayPreview = useMemo(() => {
    if (!position) return null;
    const existingCol = Number(position.collateral) / 1e8;
    const existingDebt = Number(position.debt) / 1e6;

    const repayAmount = existingDebt * (repayPct / 100);
    const withdrawBtc = existingCol * (withdrawPct / 100);
    const remainingCol = existingCol - withdrawBtc;
    const remainingDebt = existingDebt - repayAmount;
    const remainingColUsd = remainingCol * btcPrice;
    const actualLtv = remainingColUsd > 0 ? (remainingDebt / remainingColUsd) * 100 : 0;
    const healthFactor = remainingDebt > 0 ? (remainingColUsd * MAX_LTV) / remainingDebt : Infinity;
    const liqPrice = remainingDebt > 0 && remainingCol > 0 ? remainingDebt / (remainingCol * MAX_LTV) : 0;

    return {
      repayAmount,
      withdrawBtc,
      withdrawUsd: withdrawBtc * btcPrice,
      remainingCol,
      remainingDebt,
      actualLtv,
      healthFactor,
      liqPrice,
      isOverLtv: actualLtv > 70,
      isSafe: remainingDebt <= 0 || healthFactor >= 1.5,
    };
  }, [position, repayPct, withdrawPct, btcPrice]);

  const handleBorrow = useCallback(async () => {
    if (!isConnected) return;
    const wbtcSats = Math.round(borrowPreview.colBtc * 1e8);
    const usdcRaw = Math.round(borrowPreview.borrowAmount * 1e6);
    if (wbtcSats <= 0) return;

    setStep("pending");
    setErrorMsg(null);
    const hash = await depositAndBorrow(BigInt(wbtcSats), BigInt(usdcRaw));
    if (hash) {
      setTxHash(hash);
      setStep("success");
    } else {
      setErrorMsg(actionError || "Transaction failed");
      setStep("error");
    }
  }, [isConnected, borrowPreview, depositAndBorrow, actionError]);

  const handleRepay = useCallback(async () => {
    if (!isConnected || !repayPreview || !position) return;

    // Full close: use close_position which reads exact debt atomically on-chain
    if (repayPct === 100 && withdrawPct === 100) {
      const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
      let userUsdcBal = BigInt(0);
      try {
        const balRes = await provider.callContract({
          contractAddress: TOKENS.USDC.address,
          entrypoint: "balanceOf",
          calldata: [address!],
        });
        userUsdcBal = BigInt(balRes[0]) + (BigInt(balRes[1] ?? "0") << BigInt(128));
      } catch {
        userUsdcBal = position.debt + position.debt / BigInt(100); // add 1% buffer
      }

      setStep("pending");
      setErrorMsg(null);
      // Approve user's full USDC balance — close_position reads exact debt on-chain
      const hash = await closePosition(userUsdcBal);
      if (hash) {
        setTxHash(hash);
        setStep("success");
      } else {
        setErrorMsg(actionError || "Transaction failed");
        setStep("error");
      }
      return;
    }

    // Partial repay/withdraw through normal CDP flow
    const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
    let liveDebt = BigInt(0);
    try {
      const debtRes = await provider.callContract({
        contractAddress: "0x063d69ae657bd2f40337c39bf35a870ac27ddf91e6623c2f52529db4c1619a51",
        entrypoint: "balanceOf",
        calldata: [SABLE_CONTRACTS.CDP],
      });
      liveDebt = BigInt(debtRes[0]) + (BigInt(debtRes[1] ?? "0") << BigInt(128));
    } catch {
      liveDebt = position.debt;
    }

    const usdcRaw = BigInt(Math.round(repayPreview.repayAmount * 1e6));
    // Check partial repay won't leave debt below Nostra minimum ($50 = 50_000_000 raw)
    const remaining = liveDebt - usdcRaw;
    if (remaining > BigInt(0) && remaining < BigInt(50_000_000)) {
      setErrorMsg(
        `This repayment would leave $${(Number(remaining) / 1e6).toFixed(2)} debt, which is below Nostra's $50 minimum. ` +
        `Either repay 100% to close, or repay less to keep debt above $50.`
      );
      setStep("error");
      return;
    }

    const wbtcSats = withdrawPct === 100 ? Number(position.collateral) : Math.round(repayPreview.withdrawBtc * 1e8);
    if (usdcRaw <= BigInt(0) && wbtcSats <= 0) return;

    setStep("pending");
    setErrorMsg(null);
    const hash = await repayAndWithdraw(usdcRaw, BigInt(wbtcSats));
    if (hash) {
      setTxHash(hash);
      setStep("success");
    } else {
      setErrorMsg(actionError || "Transaction failed");
      setStep("error");
    }
  }, [isConnected, repayPreview, repayAndWithdraw, closePosition, actionError, position, repayPct, withdrawPct, address]);

  const handleSubmit = mode === "borrow" ? handleBorrow : handleRepay;

  const canSubmit = (() => {
    if (!isConnected) return false;
    if (mode === "borrow") return borrowPreview.colBtc > 0 && !borrowPreview.isOverLtv && !borrowPreview.isBelowMin && !borrowPreview.isBelowMinBorrow;
    return repayPreview !== null && (repayPreview.repayAmount > 0 || repayPreview.withdrawBtc > 0) && !repayPreview.isOverLtv;
  })();

  const hasExistingPosition = position && !posLoading && (position.collateral > BigInt(0) || position.debt > BigInt(0));

  return (
    <div className="space-y-4">
      {/* ── Position card — always visible when connected ── */}
      {isConnected && (
        <div className="rounded-xl bg-surface border border-line p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">Your Position</p>
            {posLoading && (
              <div className="w-3 h-3 rounded-full border border-btc/40 border-t-btc animate-spin" />
            )}
          </div>

          {posLoading ? (
            <div className="py-4 text-center">
              <p className="text-[11px] font-mono text-fg-dim">Loading position...</p>
            </div>
          ) : !hasExistingPosition ? (
            <div className="py-4 text-center">
              <p className="text-[12px] text-fg-dim">No active position</p>
              <p className="text-[10px] text-fg-dim/60 mt-1">Deposit WBTC to open a CDP</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] font-mono text-fg-dim uppercase">Collateral</p>
                  <p className="text-[14px] font-mono font-bold text-fg">{fmtBtc(position.collateral)} <span className="text-[10px] text-fg-dim">WBTC</span></p>
                  <p className="text-[10px] font-mono text-fg-dim">{fmtDollar(Number(position.collateral) / 1e8 * btcPrice)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-fg-dim uppercase">Debt</p>
                  <p className="text-[14px] font-mono font-bold text-fg">${fmtUsd(position.debt)} <span className="text-[10px] text-fg-dim">USDC</span></p>
                </div>
              </div>
              <div className="h-px bg-line" />
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] font-mono text-fg-dim">Health</p>
                  <p className={clsx("text-[12px] font-mono font-bold",
                    healthColor(Number(position.healthBps) / 10000)
                  )}>
                    {Number(position.healthBps) >= 999990 ? "Safe" : (Number(position.healthBps) / 10000).toFixed(2) + "x"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-fg-dim">LTV</p>
                  <p className={clsx("text-[12px] font-mono font-bold",
                    ltvColor(position.collateral > BigInt(0)
                      ? Number(position.debt) / 1e6 / (Number(position.collateral) / 1e8 * btcPrice) * 100
                      : 0)
                  )}>
                    {position.collateral > BigInt(0)
                      ? (Number(position.debt) / 1e6 / (Number(position.collateral) / 1e8 * btcPrice) * 100).toFixed(1) + "%"
                      : "0%"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-fg-dim">Liq. Price</p>
                  <p className="text-[12px] font-mono font-bold text-down">
                    {position.debt > BigInt(0) && position.collateral > BigInt(0)
                      ? fmtDollar(Number(position.debt) / 1e6 / (Number(position.collateral) / 1e8 * MAX_LTV))
                      : "N/A"}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Form card ── */}
      <div className="rounded-xl bg-surface border border-line overflow-hidden">
        {/* Mode tabs */}
        <div className="flex">
          {(["borrow", "repay"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { resetForm(); setMode(m); }}
              className={clsx(
                "flex-1 py-3 text-[11px] font-mono tracking-wider uppercase transition-all border-b-2",
                mode === m
                  ? "text-btc border-btc bg-surface-raised"
                  : "text-fg-dim border-transparent hover:text-fg-muted"
              )}
            >
              {m === "borrow" ? "Deposit & Borrow" : "Repay & Withdraw"}
            </button>
          ))}
        </div>

        <div className="p-4">
          {step === "input" && mode === "borrow" && (
            <div className="space-y-4">
              {/* BTC price — live from CoinGecko */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-void border border-line">
                <span className="text-[10px] font-mono text-fg-dim">BTC Price</span>
                <div className="flex items-center gap-1.5">
                  {priceLoading ? (
                    <span className="text-[12px] font-mono text-fg-dim">Loading...</span>
                  ) : (
                    <span className="text-[12px] font-mono font-bold text-btc">{fmtDollar(btcPrice)}</span>
                  )}
                  <span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" title="Live price" />
                </div>
              </div>

              {/* WBTC input — the only thing user types */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
                    WBTC to Deposit
                  </span>
                  {btcPrice > 0 && (
                    <span className="text-[9px] font-mono text-fg-dim">
                      Min: {minWbtc.toFixed(6)} WBTC ({fmtDollar(MIN_DEPOSIT_USD)})
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={wbtcInput}
                  onChange={(e) => setWbtcInput(e.target.value)}
                  placeholder={minWbtc > 0 ? minWbtc.toFixed(6) : "0.001"}
                  className={clsx(
                    "w-full bg-void border rounded-lg px-3 py-2.5 text-[14px] font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none transition-colors",
                    borrowPreview.isBelowMin
                      ? "border-down/50 focus:border-down/70"
                      : "border-line focus:border-btc/40"
                  )}
                />
                {borrowPreview.isBelowMin ? (
                  <p className="text-[10px] font-mono text-down mt-1 pl-1">
                    Below minimum deposit — at least {fmtDollar(MIN_DEPOSIT_USD)} worth of WBTC required
                  </p>
                ) : borrowPreview.colBtc > 0 ? (
                  <p className="text-[10px] font-mono text-fg-dim mt-1 pl-1">
                    Collateral value: <span className="text-fg-muted">{fmtDollar(borrowPreview.colUsd)}</span>
                    {" · "}Max borrow: <span className="text-btc">{fmtDollar(borrowPreview.colUsd * MAX_LTV)}</span>
                  </p>
                ) : null}
              </div>

              {/* LTV slider — auto-calculates borrow amount */}
              {borrowPreview.colBtc > 0 && !borrowPreview.isBelowMin && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
                        Borrow Ratio (LTV)
                      </span>
                      <span className={clsx("text-[12px] font-mono font-bold", ltvColor(ltvPct))}>
                        {ltvPct}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="70"
                      step="5"
                      value={ltvPct}
                      onChange={(e) => setLtvPct(Number(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-overlay accent-btc"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-fg-dim mt-1">
                      <span>0% (no borrow)</span>
                      <span>70% (max)</span>
                    </div>
                  </div>

                  {/* Auto-calculated borrow amount */}
                  <div className="rounded-lg bg-void border border-line p-3 space-y-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-fg-dim">You will borrow</span>
                      <span className="font-mono font-bold text-fg">
                        {fmtDollar(borrowPreview.borrowAmount)} USDC
                      </span>
                    </div>
                    <div className="h-px bg-line" />

                    {/* LTV bar */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-mono text-fg-dim">LTV</span>
                        <span className={clsx("text-[10px] font-mono font-bold", ltvColor(borrowPreview.actualLtv))}>
                          {borrowPreview.actualLtv.toFixed(1)}% / 70%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden relative">
                        <div className="absolute left-[70%] top-0 bottom-0 w-px bg-down/40 z-10" />
                        <div
                          className={clsx("h-full rounded-full transition-all", ltvBarColor(borrowPreview.actualLtv))}
                          style={{ width: `${Math.min(100, borrowPreview.actualLtv / 0.7)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between text-[11px]">
                      <span className="text-fg-dim">Health Factor</span>
                      <span className={clsx("font-mono font-bold",
                        borrowPreview.healthFactor === Infinity ? "text-up" : healthColor(borrowPreview.healthFactor)
                      )}>
                        {borrowPreview.healthFactor === Infinity ? "Safe" : borrowPreview.healthFactor.toFixed(2) + "x"}
                      </span>
                    </div>

                    {borrowPreview.liqPrice > 0 && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-fg-dim">Liquidation if BTC drops to</span>
                        <span className="font-mono font-bold text-down">{fmtDollar(borrowPreview.liqPrice)}</span>
                      </div>
                    )}

                    {borrowPreview.liqPrice > 0 && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-fg-dim">Buffer from current price</span>
                        <span className={clsx("font-mono font-bold",
                          ((1 - borrowPreview.liqPrice / btcPrice) * 100) > 25 ? "text-up" : "text-caution"
                        )}>
                          BTC can drop {((1 - borrowPreview.liqPrice / btcPrice) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Warnings */}
                  {borrowPreview.isBelowMinBorrow && (
                    <div className="rounded-md bg-down/10 border border-down/20 px-3 py-2">
                      <p className="text-[10px] font-mono text-down">
                        Minimum borrow is {NOSTRA_MIN_BORROW_USDC} USDC — increase collateral or LTV, or set LTV to 0% for deposit only
                      </p>
                    </div>
                  )}
                  {borrowPreview.healthFactor < 1.5 && borrowPreview.healthFactor !== Infinity && (
                    <div className="rounded-md bg-caution/10 border border-caution/20 px-3 py-2">
                      <p className="text-[10px] font-mono text-caution">
                        Low health factor — consider reducing LTV for safety
                      </p>
                    </div>
                  )}
                </>
              )}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={clsx(
                  "w-full py-3 rounded-lg text-[12px] font-mono tracking-wider uppercase transition-all",
                  canSubmit
                    ? "bg-btc/15 text-btc border border-btc/25 hover:bg-btc/25"
                    : "bg-surface-overlay text-fg-dim border border-line cursor-not-allowed"
                )}
              >
                {!isConnected ? "Connect Wallet"
                  : priceLoading ? "Loading Price..."
                  : borrowPreview.colBtc <= 0 ? "Enter WBTC Amount"
                  : borrowPreview.isBelowMin ? `Min ${minWbtc.toFixed(6)} WBTC`
                  : ltvPct === 0 ? "Deposit Collateral Only"
                  : `Deposit & Borrow ${fmtDollar(borrowPreview.borrowAmount)}`}
              </button>
            </div>
          )}

          {step === "input" && mode === "repay" && (
            <div className="space-y-4">
              {!hasExistingPosition ? (
                <div className="text-center py-8">
                  <p className="text-[13px] text-fg-dim">No active position to repay</p>
                </div>
              ) : (
                <>
                  {/* Repay slider */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
                        Repay Debt
                      </span>
                      <span className="text-[12px] font-mono font-bold text-fg">
                        {repayPct}% — {fmtDollar(Number(position.debt) / 1e6 * repayPct / 100)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={repayPct}
                      onChange={(e) => setRepayPct(Number(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-overlay accent-btc"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-fg-dim mt-1">
                      <span>0%</span>
                      <span>100% (${fmtUsd(position.debt)})</span>
                    </div>
                  </div>

                  {/* Withdraw slider */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
                        Withdraw Collateral
                      </span>
                      <span className="text-[12px] font-mono font-bold text-fg">
                        {withdrawPct}% — {(Number(position.collateral) / 1e8 * withdrawPct / 100).toFixed(6)} BTC
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={withdrawPct}
                      onChange={(e) => setWithdrawPct(Number(e.target.value))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-overlay accent-btc"
                    />
                    <div className="flex justify-between text-[9px] font-mono text-fg-dim mt-1">
                      <span>0%</span>
                      <span>100% ({fmtBtc(position.collateral)} WBTC)</span>
                    </div>
                  </div>

                  {/* Repay preview */}
                  {repayPreview && (repayPreview.repayAmount > 0 || repayPreview.withdrawBtc > 0) && (
                    <div className="rounded-lg bg-void border border-line p-3 space-y-2">
                      <p className="text-[9px] font-mono text-fg-dim tracking-widest uppercase">After Transaction</p>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-fg-dim">Remaining Collateral</span>
                        <span className="font-mono text-fg-muted">
                          {repayPreview.remainingCol.toFixed(6)} BTC ({fmtDollar(repayPreview.remainingCol * btcPrice)})
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-fg-dim">Remaining Debt</span>
                        <span className="font-mono text-fg-muted">
                          {fmtDollar(repayPreview.remainingDebt)} USDC
                        </span>
                      </div>
                      {repayPreview.remainingDebt > 0 && (
                        <>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-fg-dim">Health Factor</span>
                            <span className={clsx("font-mono font-bold", healthColor(repayPreview.healthFactor))}>
                              {repayPreview.healthFactor === Infinity ? "Safe" : repayPreview.healthFactor.toFixed(2) + "x"}
                            </span>
                          </div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-fg-dim">Liquidation Price</span>
                            <span className="font-mono font-bold text-down">{fmtDollar(repayPreview.liqPrice)}</span>
                          </div>
                        </>
                      )}
                      {repayPreview.isOverLtv && (
                        <div className="rounded-md bg-down/10 border border-down/20 px-3 py-2 mt-1">
                          <p className="text-[10px] font-mono text-down">
                            Cannot withdraw this much — would exceed 70% LTV. Repay more debt first.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={clsx(
                      "w-full py-3 rounded-lg text-[12px] font-mono tracking-wider uppercase transition-all",
                      canSubmit
                        ? "bg-btc/15 text-btc border border-btc/25 hover:bg-btc/25"
                        : "bg-surface-overlay text-fg-dim border border-line cursor-not-allowed"
                    )}
                  >
                    {!isConnected ? "Connect Wallet"
                      : repayPct === 100 && withdrawPct === 100 ? "Close Position"
                      : repayPct > 0 && withdrawPct > 0 ? "Repay & Withdraw"
                      : repayPct > 0 ? "Repay Debt"
                      : withdrawPct > 0 ? "Withdraw Collateral"
                      : "Select Amount"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Pending */}
          {step === "pending" && (
            <div className="text-center py-8 space-y-3">
              <div className="w-10 h-10 mx-auto rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center animate-pulse">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F7931A" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-fg">{status || "Processing..."}</p>
              <p className="text-[11px] text-fg-dim font-mono">
                {mode === "borrow" ? "Depositing collateral & borrowing USDC..." : "Repaying debt & withdrawing collateral..."}
              </p>
            </div>
          )}

          {/* Success */}
          {step === "success" && (
            <div className="text-center py-6 space-y-3">
              <div className="w-10 h-10 mx-auto rounded-full bg-up/10 border border-up/20 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3DD68C" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-fg">
                {mode === "borrow" ? "Position Opened" : "Position Updated"}
              </p>
              {txHash && (
                <a href={`${VOYAGER_BASE}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-mono text-btc hover:underline">
                  View on Voyager
                </a>
              )}
              <button onClick={resetForm}
                className="block mx-auto text-[11px] font-mono text-fg-dim hover:text-fg-muted transition-colors">
                Done
              </button>
            </div>
          )}

          {/* Error */}
          {step === "error" && (
            <div className="text-center py-6 space-y-3">
              <div className="w-10 h-10 mx-auto rounded-full bg-down/10 border border-down/20 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-fg">Transaction Failed</p>
              <p className="text-[11px] text-fg-dim font-mono max-w-[280px] mx-auto truncate">{errorMsg}</p>
              <button onClick={resetForm} className="text-[11px] font-mono text-btc hover:underline">Try Again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
