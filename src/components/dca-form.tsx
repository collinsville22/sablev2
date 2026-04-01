"use client";

import { useState } from "react";
import { useAccount } from "@starknet-react/core";
import { clsx } from "clsx";
import { TOKENS, VOYAGER_BASE } from "@/lib/constants";
import {
  useDcaQuote,
  useDcaOrders,
  useDcaHistory,
  useMayerMultiple,
  useKeeperFee,
  formatTokenAmount,
  getTokenSymbol,
  FREQUENCY_LABELS,
  type DcaFrequency,
} from "@/hooks/use-dca";

type Step = "config" | "preview" | "success";

export const SELL_TOKENS = [
  { address: TOKENS.ETH.address, symbol: "ETH", name: "Ether", decimals: 18, icon: "/tokens/eth.svg" },
  { address: TOKENS.USDC.address, symbol: "USDC", name: "USD Coin", decimals: 6, icon: "/tokens/usdc.svg" },
  { address: TOKENS.USDT.address, symbol: "USDT", name: "Tether", decimals: 6, icon: "/tokens/usdt.svg" },
  { address: TOKENS.STRK.address, symbol: "STRK", name: "Starknet", decimals: 18, icon: "/tokens/strk.svg" },
] as const;

const FREQUENCIES: { value: DcaFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
];

export function DcaForm() {
  const { isConnected, address } = useAccount();
  const keeperFee = useKeeperFee();
  const [step, setStep] = useState<Step>("config");
  const [sellTokenIdx, setSellTokenIdx] = useState(0);
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<DcaFrequency>("weekly");
  const [totalOrders, setTotalOrders] = useState("4");
  const [smartDca, setSmartDca] = useState(true);

  const sellToken = SELL_TOKENS[sellTokenIdx];
  const { quote, loading: quoteLoading } = useDcaQuote(sellToken.address, amount);
  const { activeOrders, createOrder, cancelOrder, txStep, txHash, txError, resetTx } = useDcaOrders();
  const { history } = useDcaHistory();
  const { data: mayerData, loading: mayerLoading } = useMayerMultiple();

  const parsedAmount = parseFloat(amount) || 0;
  const parsedOrders = parseInt(totalOrders) || 0;

  const handleCreate = async () => {
    if (!isConnected || !address || parsedAmount <= 0 || parsedOrders <= 0) return;
    await createOrder({
      sellToken: sellToken.address,
      sellAmountHuman: amount,
      frequency,
      totalOrders: parsedOrders,
      smart: smartDca,
    });
    setStep("success");
  };

  const resetForm = () => {
    setStep("config");
    setAmount("");
    setTotalOrders("4");
    resetTx();
  };

  // Mayer Multiple color
  const mmColor = mayerData
    ? mayerData.mayerMultiple < 0.8 ? "text-up"
    : mayerData.mayerMultiple < 1.0 ? "text-up"
    : mayerData.mayerMultiple < 1.5 ? "text-fg"
    : mayerData.mayerMultiple < 2.0 ? "text-caution"
    : "text-down"
    : "text-fg-dim";

  return (
    <div className="space-y-6">
      {/* Mayer Multiple Indicator */}
      {smartDca && (
        <div className="rounded-xl bg-surface border border-line overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
              Mayer Multiple
            </p>
            {mayerData && (
              <span className={clsx("text-[13px] font-mono font-medium", mmColor)}>
                {mayerData.mayerMultiple.toFixed(2)}
              </span>
            )}
          </div>
          <div className="p-4">
            {mayerLoading ? (
              <p className="text-[11px] font-mono text-fg-dim animate-pulse">Loading oracle data...</p>
            ) : mayerData ? (
              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">BTC Spot</span>
                  <span className="font-mono text-fg-muted">${mayerData.spot.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">200-Day Average</span>
                  <span className="font-mono text-fg-muted">${mayerData.twap200d.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Band</span>
                  <span className={clsx("font-mono", mmColor)}>{mayerData.band}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Buy Multiplier</span>
                  <span className={clsx("font-mono font-medium", mmColor)}>{mayerData.multiplier}x</span>
                </div>
                {/* Visual bar */}
                <div className="mt-2 relative h-2 bg-void rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-up via-caution to-down rounded-full"
                    style={{ width: `${Math.min(mayerData.mayerMultiple / 3 * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] font-mono text-fg-dim/50">
                  <span>0</span>
                  <span>0.8</span>
                  <span>1.0</span>
                  <span>1.5</span>
                  <span>2.0</span>
                  <span>3.0</span>
                </div>
              </div>
            ) : (
              <p className="text-[11px] font-mono text-fg-dim">Oracle unavailable</p>
            )}
          </div>
        </div>
      )}

      {/* DCA Configuration */}
      <div className="rounded-xl bg-surface border border-line overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <p className="text-[12px] font-mono tracking-wider uppercase text-fg">
            Configure DCA
          </p>
        </div>

        <div className="p-4 space-y-4">
          {step === "config" && (
            <>
              {/* Smart DCA Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase block">
                    Smart DCA
                  </span>
                  <span className="text-[10px] font-mono text-fg-dim/60">
                    {smartDca ? "Buy more when cheap, less when expensive" : "Fixed amount each order"}
                  </span>
                </div>
                <button
                  onClick={() => setSmartDca(!smartDca)}
                  className={clsx(
                    "relative w-10 h-5 rounded-full transition-colors",
                    smartDca ? "bg-btc/30" : "bg-line"
                  )}
                >
                  <span
                    className={clsx(
                      "absolute top-0.5 w-4 h-4 rounded-full transition-all",
                      smartDca ? "left-5.5 bg-btc" : "left-0.5 bg-fg-dim"
                    )}
                  />
                </button>
              </div>

              {/* Sell token selector */}
              <div>
                <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase block mb-1.5">
                  Sell Token
                </span>
                <div className="flex flex-wrap gap-2">
                  {SELL_TOKENS.map((token, idx) => (
                    <button
                      key={token.symbol}
                      onClick={() => setSellTokenIdx(idx)}
                      className={clsx(
                        "flex-1 min-w-[70px] py-2 px-2 rounded-lg text-[11px] font-mono border transition-all",
                        sellTokenIdx === idx
                          ? "border-btc/40 bg-btc/8 text-btc"
                          : "border-line bg-surface-overlay text-fg-dim hover:border-line hover:text-fg-muted"
                      )}
                    >
                      {token.symbol}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount per order */}
              <div>
                <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase block mb-1.5">
                  Amount per Order ({sellToken.symbol})
                </span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-void border border-line rounded-lg px-3 py-3 text-xl font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/40 transition-colors"
                />
                {quote && !quoteLoading && (
                  <p className="text-[10px] font-mono text-fg-dim mt-1 pl-1">
                    ~{quote.buyAmount} WBTC per order (${quote.sellAmountUsd.toFixed(2)})
                  </p>
                )}
                {quoteLoading && parsedAmount > 0 && (
                  <p className="text-[10px] font-mono text-fg-dim mt-1 pl-1 animate-pulse">
                    Fetching quote...
                  </p>
                )}
              </div>

              {/* Frequency */}
              <div>
                <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase block mb-1.5">
                  Frequency
                </span>
                <div className="flex gap-2">
                  {FREQUENCIES.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setFrequency(f.value)}
                      className={clsx(
                        "flex-1 py-2 rounded-lg text-[11px] font-mono border transition-all",
                        frequency === f.value
                          ? "border-btc/40 bg-btc/8 text-btc"
                          : "border-line bg-surface-overlay text-fg-dim hover:text-fg-muted"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Number of orders */}
              <div>
                <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase block mb-1.5">
                  Number of Orders
                </span>
                <input
                  type="number"
                  value={totalOrders}
                  onChange={(e) => setTotalOrders(e.target.value)}
                  min="1"
                  max="365"
                  className="w-full bg-void border border-line rounded-lg px-3 py-2.5 text-[15px] font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/40 transition-colors"
                />
              </div>

              {/* Summary */}
              {parsedAmount > 0 && parsedOrders > 0 && (
                <div className="rounded-lg bg-surface-overlay border border-line p-3 space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-dim">Total Investment</span>
                    <span className="font-mono text-fg-muted">
                      {(parsedAmount * parsedOrders).toFixed(2)} {sellToken.symbol}
                    </span>
                  </div>
                  {smartDca && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-fg-dim">Total Deposit (1.5x for Smart)</span>
                      <span className="font-mono text-fg-muted">
                        {(parsedAmount * parsedOrders * 1.5).toFixed(2)} {sellToken.symbol}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-dim">Duration</span>
                    <span className="font-mono text-fg-muted">
                      {frequency === "daily" && `${parsedOrders} days`}
                      {frequency === "weekly" && `${parsedOrders} weeks`}
                      {frequency === "biweekly" && `${parsedOrders * 2} weeks`}
                      {frequency === "monthly" && `${parsedOrders} months`}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-dim">Strategy</span>
                    <span className={clsx("font-mono", smartDca ? "text-btc" : "text-fg-muted")}>
                      {smartDca ? "Smart DCA (Mayer Multiple)" : "Fixed DCA"}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-dim">Keeper Fee</span>
                    <span className="font-mono text-fg-muted">{keeperFee ? `${keeperFee}%` : "..."} per execution</span>
                  </div>
                  {quote && (
                    <>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-fg-dim">Est. WBTC per Order</span>
                        <span className="font-mono text-btc">{quote.buyAmount}</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-fg-dim">Route</span>
                        <span className="font-mono text-fg-muted">{quote.route}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Create button */}
              <button
                onClick={handleCreate}
                disabled={!isConnected || parsedAmount <= 0 || parsedOrders <= 0 || txStep === "approving" || txStep === "pending"}
                className={clsx(
                  "w-full py-3 rounded-lg text-[12px] font-mono tracking-wider uppercase transition-all",
                  isConnected && parsedAmount > 0 && parsedOrders > 0 && txStep === "idle"
                    ? "bg-btc/15 text-btc border border-btc/25 hover:bg-btc/25"
                    : "bg-surface-overlay text-fg-dim border border-line cursor-not-allowed"
                )}
              >
                {!isConnected
                  ? "Connect Wallet"
                  : txStep === "approving" ? "Sign Transaction..."
                  : txStep === "pending" ? "Confirming..."
                  : parsedAmount <= 0 ? "Enter Amount"
                  : `Create ${smartDca ? "Smart " : ""}DCA Order`}
              </button>

              {txError && (
                <p className="text-[11px] font-mono text-down text-center">{txError}</p>
              )}
            </>
          )}

          {step === "success" && (
            <div className="text-center py-6 space-y-3">
              <div className="w-10 h-10 mx-auto rounded-full bg-up/10 border border-up/20 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3DD68C" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-fg">DCA Order Created On-Chain</p>
              <p className="text-[11px] text-fg-dim font-mono">
                Your {smartDca ? "Smart " : ""}DCA order is live. A keeper bot will execute swaps at the scheduled frequency.
              </p>
              {txHash && (
                <a
                  href={`${VOYAGER_BASE}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-mono text-btc hover:underline block"
                >
                  View Transaction
                </a>
              )}
              <button
                onClick={resetForm}
                className="text-[11px] font-mono text-btc hover:underline"
              >
                Create Another
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Orders */}
      {activeOrders.length > 0 && (
        <div className="rounded-xl bg-surface border border-line overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
              Active Orders ({activeOrders.length})
            </p>
          </div>
          <div className="divide-y divide-line">
            {activeOrders.map((order) => {
              const symbol = getTokenSymbol(order.sellToken);
              const amountStr = formatTokenAmount(order.sellAmountPer, order.sellToken);
              const btcStr = formatTokenAmount(order.btcReceived, TOKENS.WBTC.address);
              const remaining = order.deposited - order.spent;
              const remainingStr = formatTokenAmount(remaining, order.sellToken);

              return (
                <div key={order.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-mono text-fg">
                        {amountStr} {symbol} → WBTC
                        {order.smart && <span className="ml-1.5 text-[9px] text-btc border border-btc/20 px-1 py-0.5 rounded">SMART</span>}
                      </p>
                      <p className="text-[10px] font-mono text-fg-dim mt-0.5">
                        {order.executedOrders}/{order.totalOrders} executed · {btcStr} WBTC received
                      </p>
                      <p className="text-[10px] font-mono text-fg-dim/60 mt-0.5">
                        Refundable: {remainingStr} {symbol}
                      </p>
                    </div>
                    <button
                      onClick={() => cancelOrder(order.id)}
                      className="text-[10px] font-mono text-down hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2 h-1 bg-void rounded-full overflow-hidden">
                    <div
                      className="h-full bg-btc/40 rounded-full transition-all"
                      style={{ width: `${(order.executedOrders / order.totalOrders) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Execution History */}
      {history.length > 0 && (
        <div className="rounded-xl bg-surface border border-line overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
              Execution History
            </p>
          </div>
          <div className="divide-y divide-line">
            {history.slice(0, 10).map((exec, i) => {
              const btcStr = formatTokenAmount(exec.btcReceived, TOKENS.WBTC.address);
              return (
                <div key={`${exec.txHash}-${i}`} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-mono text-fg">
                      #{exec.executionNumber} → {btcStr} WBTC
                    </p>
                    <p className="text-[10px] font-mono text-fg-dim mt-0.5">
                      Order #{exec.orderId}
                      {exec.mayerMultiple > 0 && ` · MM: ${exec.mayerMultiple.toFixed(2)}`}
                    </p>
                  </div>
                  <a
                    href={`${VOYAGER_BASE}/tx/${exec.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-btc hover:underline"
                  >
                    View TX
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
