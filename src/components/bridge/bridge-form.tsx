"use client";

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { useAccount } from "@starknet-react/core";
import { useBridge, type BridgeDirection } from "@/hooks/use-bridge";
import { ChainSelector, TokenSelector } from "./chain-token-selector";
import { BridgeTracker } from "./bridge-tracker";
import { VOYAGER_BASE, TOKENS } from "@/lib/constants";
import { useTokenBalance } from "@/hooks/use-vault-contract";

export function BridgeForm() {
  const { isConnected } = useAccount();
  const bridge = useBridge();
  const { state } = bridge;

  const { balance: strkBalance, loading: strkLoading } = useTokenBalance(TOKENS.STRK.address);
  const [inDenom, setInDenom] = useState<"token" | "usd">("token");
  const [inDisplay, setInDisplay] = useState("");
  const [outDisplay, setOutDisplay] = useState("");

  const formattedStrkBalance = strkBalance !== null
    ? (Number(strkBalance) / 1e18).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
    : "—";

  const isQuoted = state.step === "quoted" && state.quote;
  const isExecuting = ![
    "idle", "quoting", "quoted", "error", "complete",
  ].includes(state.step);
  const numAmount = parseFloat(state.amount) || 0;

  const sourcePrice = state.sourceToken?.price || 0;
  const inDisplayNum = parseFloat(inDisplay) || 0;

  const inSecondaryValue = state.direction === "in" && inDisplayNum > 0 && sourcePrice > 0
    ? inDenom === "token"
      ? `~$${(inDisplayNum * sourcePrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : `~${(inDisplayNum / sourcePrice).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} ${state.sourceToken?.symbol || ""}`
    : null;

  const setInAmount = (displayVal: string) => {
    setInDisplay(displayVal);
    const num = parseFloat(displayVal) || 0;
    if (inDenom === "usd" && sourcePrice > 0) {
      const tokenVal = num / sourcePrice;
      bridge.setAmount(tokenVal > 0 ? tokenVal.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : "");
    } else {
      bridge.setAmount(displayVal);
    }
  };

  const toggleInDenom = () => {
    if (inDisplayNum > 0 && sourcePrice > 0) {
      if (inDenom === "token") {
        setInDisplay((inDisplayNum * sourcePrice).toFixed(2));
      } else {
        const tokenVal = inDisplayNum / sourcePrice;
        setInDisplay(tokenVal.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));
      }
    }
    setInDenom((d) => (d === "token" ? "usd" : "token"));
  };

  const setOutAmount = (displayVal: string) => {
    setOutDisplay(displayVal);
    bridge.setAmount(displayVal);
  };

  const handleMax = () => {
    if (strkBalance !== null && strkBalance > BigInt(0)) {
      const strkVal = (Number(strkBalance) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
      setOutDisplay(strkVal);
      bridge.setAmount(strkVal);
    }
  };

  useEffect(() => {
    if (state.direction === "out" && state.amount === "" && outDisplay !== "") {
      setOutDisplay("");
    }
  }, [state.direction, state.amount, outDisplay]);

  useEffect(() => {
    if (state.direction === "in" && state.amount === "" && inDisplay !== "") {
      setInDisplay("");
      setInDenom("token");
    }
  }, [state.direction, state.amount, inDisplay]);

  useEffect(() => {
    setInDenom("token");
    setInDisplay("");
  }, [state.sourceToken]);

  return (
    <div className="rounded-xl bg-surface border border-line">
      {/* Direction tabs */}
      <div className="flex rounded-t-xl overflow-hidden">
        {(["in", "out"] as const).map((dir) => (
          <button
            key={dir}
            onClick={() => bridge.setDirection(dir)}
            className={clsx(
              "flex-1 py-3 text-[12px] font-mono tracking-wider uppercase transition-all border-b-2",
              state.direction === dir
                ? "text-fg border-btc bg-surface-raised"
                : "text-fg-dim border-transparent hover:text-fg-muted",
            )}
          >
            {dir === "in" ? "Bridge In" : "Bridge Out"}
          </button>
        ))}
      </div>

      <div className="p-4">
        {/* ── Input Form ── */}
        {!isExecuting && state.step !== "complete" && state.step !== "error" && (
          <div className="space-y-4">
            {/* Info banner */}
            <div className="rounded-lg bg-btc/5 border border-btc/15 p-3">
              <p className="text-[11px] text-btc font-mono">
                {state.direction === "in"
                  ? "Bridge any token from multiple chains to STRK on Starknet."
                  : "Bridge STRK from Starknet to any token on multiple chains."}
              </p>
            </div>

            {/* Source / Destination selection */}
            {state.direction === "in" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <ChainSelector
                    chains={bridge.chains}
                    selected={state.sourceChain}
                    onSelect={bridge.setSourceChain}
                    label="From chain"
                  />
                  <TokenSelector
                    tokens={bridge.sourceTokens}
                    selected={state.sourceToken}
                    onSelect={bridge.setSourceToken}
                    label="Token"
                  />
                </div>

                {/* Amount input — with USD toggle */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
                      Amount
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={inDisplay}
                      onChange={(e) => setInAmount(e.target.value)}
                      placeholder={inDenom === "usd" ? "0.00" : "0.00"}
                      className="w-full bg-void border border-line rounded-lg px-3 py-3 pr-20 text-xl font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/40 transition-colors"
                    />
                    <button
                      onClick={toggleInDenom}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-fg-dim hover:text-btc transition-colors flex items-center gap-1"
                      title="Toggle USD / token input"
                    >
                      {inDenom === "usd" ? "USD" : (state.sourceToken?.symbol || "—")}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                    </button>
                  </div>
                  {inSecondaryValue && (
                    <p className="text-[10px] font-mono text-fg-dim mt-1 pl-1">{inSecondaryValue}</p>
                  )}
                </div>

                {/* Refund address on source chain */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
                      Your {state.sourceChain ? bridge.chains.find(c => c.id === state.sourceChain)?.name || state.sourceChain : ""} address
                    </span>
                    <span className="text-[9px] font-mono text-fg-dim/60">for refunds</span>
                  </div>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={state.refundAddress}
                    onChange={(e) => bridge.setRefundAddress(e.target.value)}
                    placeholder={getAddressPlaceholder(state.sourceChain)}
                    className="w-full bg-void border border-line rounded-lg px-3 py-2.5 text-[12px] font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/40 transition-colors"
                  />
                </div>

                {/* Directional arrow */}
                <div className="flex justify-center -my-1">
                  <div className="w-8 h-8 rounded-full bg-surface-overlay border border-line flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-btc">
                      <path d="M12 5v14m0 0l-4-4m4 4l4-4" />
                    </svg>
                  </div>
                </div>

                {/* Destination (fixed: STRK on Starknet) */}
                <div className="rounded-lg bg-void border border-line px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">
                      Receive on Starknet
                    </p>
                    <p className="text-[13px] font-mono text-fg font-medium">STRK</p>
                  </div>
                  <span className="font-mono text-lg text-btc font-bold leading-none">S</span>
                </div>
              </>
            ) : (
              <>
                {/* Source (fixed: STRK on Starknet) */}
                <div className="rounded-lg bg-void border border-line px-3 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">
                      From Starknet
                    </p>
                    <p className="text-[13px] font-mono text-fg font-medium">STRK</p>
                  </div>
                  <span className="font-mono text-lg text-btc font-bold leading-none">S</span>
                </div>

                {/* Amount input — with balance + MAX */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">Amount</span>
                    {isConnected && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-fg-dim">
                          Bal: {strkLoading ? "..." : formattedStrkBalance} STRK
                        </span>
                        {strkBalance !== null && strkBalance > BigInt(0) && (
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
                      value={outDisplay}
                      onChange={(e) => setOutAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-void border border-line rounded-lg px-3 py-3 pr-20 text-xl font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/40 transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-fg-dim">
                      STRK
                    </span>
                  </div>
                </div>

                {/* Directional arrow */}
                <div className="flex justify-center -my-1">
                  <div className="w-8 h-8 rounded-full bg-surface-overlay border border-line flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-btc">
                      <path d="M12 5v14m0 0l-4-4m4 4l4-4" />
                    </svg>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <ChainSelector
                    chains={bridge.chains}
                    selected={state.destChain}
                    onSelect={bridge.setDestChain}
                    label="To chain"
                  />
                  <TokenSelector
                    tokens={bridge.destTokens}
                    selected={state.destToken}
                    onSelect={bridge.setDestToken}
                    label="Token"
                  />
                </div>

                {/* Destination address */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
                      Destination address
                    </span>
                  </div>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={state.destAddress}
                    onChange={(e) => bridge.setDestAddress(e.target.value)}
                    placeholder={getAddressPlaceholder(state.destChain)}
                    className="w-full bg-void border border-line rounded-lg px-3 py-2.5 text-[12px] font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/40 transition-colors"
                  />
                </div>
              </>
            )}

            {/* Quote loading */}
            {state.quoteLoading && (
              <div className="rounded-lg bg-surface-overlay border border-line p-3 text-center">
                <p className="text-[11px] font-mono text-fg-dim animate-pulse">
                  Fetching best rate...
                </p>
              </div>
            )}

            {/* Quote display */}
            {isQuoted && state.quote && (
              <QuoteDisplay quote={state.quote} />
            )}

            {/* Error */}
            {state.error && (
              <div className="rounded-lg bg-down/8 border border-down/20 p-3">
                <p className="text-[11px] font-mono text-down">{state.error}</p>
              </div>
            )}

            {/* CTA Button */}
            <button
              onClick={state.direction === "in" ? bridge.startBridgeIn : bridge.startBridgeOut}
              disabled={!isConnected || !isQuoted || numAmount <= 0 || (state.direction === "in" && !state.refundAddress.trim())}
              className={clsx(
                "w-full py-3 rounded-lg text-[12px] font-mono tracking-wider uppercase transition-all",
                isConnected && isQuoted && numAmount > 0
                  ? "bg-btc/15 text-btc border border-btc/25 hover:bg-btc/25"
                  : "bg-surface-overlay text-fg-dim border border-line cursor-not-allowed",
              )}
            >
              {!isConnected
                ? "Connect Wallet"
                : state.step === "quoting"
                  ? "Getting Quote..."
                  : !isQuoted
                    ? "Enter Amount"
                    : state.direction === "in"
                      ? "Bridge to STRK"
                      : "Bridge Out"}
            </button>
          </div>
        )}

        {/* ── Executing States ── */}
        {isExecuting && (
          <div className="space-y-5">
            {/* Deposit address for bridge IN */}
            {state.step === "awaiting-deposit" && state.depositAddress && (
              <DepositAddressCard
                address={state.depositAddress}
                chain={state.sourceChain || ""}
                token={state.sourceToken?.symbol || ""}
                amount={state.amount}
              />
            )}

            {/* Progress tracker */}
            <BridgeTracker
              direction={state.direction}
              currentStep={state.step}
              oneClickStatus={state.oneClickStatus}
            />

            {/* Wallet signing state */}
            {state.step === "awaiting-transfer" && (
              <div className="text-center py-6">
                <div className="w-10 h-10 mx-auto rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center animate-pulse">
                  <span className="font-mono text-lg text-btc font-bold">S</span>
                </div>
                <p className="text-[13px] font-medium text-fg mt-3">Confirm in wallet...</p>
              </div>
            )}

            {/* Pending states */}
            {(state.step === "transfer-pending" || state.step === "notifying-1click") && (
              <div className="text-center py-6">
                <div className="w-10 h-10 mx-auto rounded-full bg-btc/10 border border-btc/20 flex items-center justify-center animate-pulse">
                  <span className="font-mono text-lg text-btc font-bold">S</span>
                </div>
                <p className="text-[13px] font-medium text-fg mt-3">Processing...</p>
                {state.starknetTxHash && (
                  <a
                    href={`${VOYAGER_BASE}/tx/${state.starknetTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-mono text-btc hover:underline mt-1 inline-block"
                  >
                    View on Voyager
                  </a>
                )}
              </div>
            )}

            {/* Error during execution */}
            {state.error && (
              <div className="rounded-lg bg-down/8 border border-down/20 p-3">
                <p className="text-[11px] font-mono text-down">{state.error}</p>
              </div>
            )}

            {/* Cancel */}
            <button
              onClick={bridge.reset}
              className="w-full py-2 text-[11px] font-mono text-fg-dim hover:text-fg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Error Terminal ── */}
        {state.step === "error" && !isExecuting && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-down/10 border border-down/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-fg">Bridge Failed</p>
            <p className="text-[11px] text-fg-dim font-mono max-w-[280px] mx-auto truncate">
              {state.error}
            </p>
            <button
              onClick={bridge.reset}
              className="text-[11px] font-mono text-btc hover:underline"
            >
              Try Again
            </button>
          </div>
        )}

        {/* ── Success ── */}
        {state.step === "complete" && (
          <div className="text-center py-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-up/10 border border-up/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3DD68C" strokeWidth="2.5" strokeLinecap="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-fg">
              {state.direction === "in"
                ? "STRK received on Starknet"
                : `${state.quote?.outputSymbol || "Tokens"} sent to destination`}
            </p>
            {state.starknetTxHash && (
              <a
                href={`${VOYAGER_BASE}/tx/${state.starknetTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-btc hover:underline block"
              >
                View on Voyager
              </a>
            )}
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={bridge.reset}
                className="px-4 py-2 rounded-lg text-[11px] font-mono text-fg-dim border border-line hover:text-fg-muted hover:border-line-bright transition-all"
              >
                Bridge Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuoteDisplay({
  quote,
}: {
  quote: NonNullable<ReturnType<typeof useBridge>["state"]["quote"]>;
}) {
  return (
    <div className="space-y-1.5">
      {/* Big receive amount */}
      <div className="rounded-lg bg-surface-overlay border border-line p-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-fg-dim tracking-wider uppercase">
          You receive
        </span>
        <span
          className="text-xl font-mono font-bold text-btc"
          style={{ textShadow: "0 0 30px rgba(247,147,26,0.15)" }}
        >
          {quote.outputAmount} {quote.outputSymbol}
        </span>
      </div>

      {/* Quote details */}
      <div className="space-y-1.5">
        {[
          ["Route", `${quote.inputSymbol} → ${quote.outputSymbol}`],
          ["Est. time", `~${quote.timeEstimate}s`],
          ["Value", `$${quote.inputUsd.toFixed(2)} → $${quote.outputUsd.toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between text-[11px]">
            <span className="text-fg-dim">{label}</span>
            <span className={clsx("font-mono", label === "Route" ? "text-btc" : "text-fg-muted")}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getAddressPlaceholder(chain: string | null): string {
  switch (chain?.toLowerCase()) {
    case "btc": return "bc1q...";
    case "sol": return "So1...";
    case "ton": return "EQ...";
    case "tron": return "T...";
    case "xrp": return "r...";
    case "ltc": return "ltc1q...";
    case "doge": return "D...";
    case "bch": return "bitcoincash:q...";
    case "near": return "account.near";
    case "stellar": return "G...";
    case "cardano": return "addr1...";
    case "sui": case "aptos": return "0x...";
    default: return "0x...";
  }
}

function DepositAddressCard({
  address,
  chain,
  token,
  amount,
}: {
  address: string;
  chain: string;
  token: string;
  amount: string;
}) {
  const handleCopy = () => {
    navigator.clipboard.writeText(address);
  };

  const isBtcLike = ["btc", "ltc", "doge", "bch"].includes(chain.toLowerCase());

  return (
    <div className="rounded-lg bg-btc/5 border border-btc/20 p-4 space-y-3">
      <p className="text-[11px] font-mono text-btc font-medium">
        Send exactly {amount} {token} to this {chain} address:
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] font-mono text-fg bg-void rounded-lg px-2.5 py-2 break-all border border-line">
          {address}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 px-2.5 py-2 rounded-lg bg-btc/10 text-btc text-[10px] font-mono hover:bg-btc/20 transition-colors border border-btc/20"
        >
          Copy
        </button>
      </div>
      <p className="text-[10px] font-mono text-fg-dim">
        The bridge will automatically detect your deposit and process the transfer.
      </p>
      {isBtcLike && (
        <p className="text-[10px] font-mono text-down/80">
          Important: Send the exact amount. If your wallet deducts fees from the send amount,
          the deposit will be considered incomplete and refunded (minus a ~1500 sat fee).
          Set network fees to be paid separately, not deducted from the amount.
        </p>
      )}
    </div>
  );
}
