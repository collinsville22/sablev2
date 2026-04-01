"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import Link from "next/link";
import { clsx } from "clsx";
import { formatPercent, formatUsd } from "@/lib/format";
import { useVaults } from "@/hooks/use-vault-data";
import { useTokenBalance, useShareValue, useStrategyInfo, useVaultTotals } from "@/hooks/use-vault-contract";
import { useCdpPosition } from "@/hooks/use-cdp";
import { useVesuPosition, STAKING_POOLS } from "@/hooks/use-staking";
import { useDcaOrders, type DcaOrder } from "@/hooks/use-dca";
import { fetchBtcPrice } from "@/lib/api/price";
import { TOKENS, SABLE_CONTRACTS, RISK_LABELS, VAULT_STRATEGIES, VOYAGER_BASE } from "@/lib/constants";
import { getUnspentNotes, loadNotes, saveNotes, type UTXONote } from "@/lib/privacy/utxo";
import type { LiveVault } from "@/lib/api/vaults";

function EmptyState() {
  return (
    <div className="max-w-[1200px] mx-auto px-5 py-24">
      <div className="text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-surface border border-line flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
              stroke="#484B5B"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 11v6M9 14h6"
              stroke="#484B5B"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h2 className="text-lg font-medium text-fg mb-2">No Positions Yet</h2>
        <p className="text-[12px] text-fg-dim font-mono max-w-xs mx-auto mb-6">
          Connect your wallet and deposit into a vault to start earning BTC
          yield on StarkNet.
        </p>
        <Link
          href="/"
          className="inline-flex px-5 py-2.5 rounded-lg bg-btc/15 text-btc border border-btc/25 text-[12px] font-mono tracking-wider uppercase hover:bg-btc/25 transition-colors"
        >
          Explore Vaults
        </Link>
      </div>
    </div>
  );
}

const STRAT_TAG: Record<string, string> = {
  [VAULT_STRATEGIES.LENDING]: "LEND",
  [VAULT_STRATEGIES.DUAL_LENDING]: "DUAL",
  [VAULT_STRATEGIES.LP_PROVISION]: "LP",
  [VAULT_STRATEGIES.DELTA_NEUTRAL]: "D-N",
  [VAULT_STRATEGIES.LEVERAGE_LOOP]: "LOOP",
  [VAULT_STRATEGIES.MULTI_STRATEGY]: "MULTI",
};

const VAULT_ADDRESSES = Object.values(SABLE_CONTRACTS);

function VaultPositionCard({ vault }: { vault: LiveVault }) {
  const [expanded, setExpanded] = useState(true);
  const { balance, loading: balLoading } = useTokenBalance(vault.vTokenAddress);
  const { wbtcValue } = useShareValue(vault.vTokenAddress, balance);
  const strategyInfo = useStrategyInfo(vault.vTokenAddress);
  const vaultTotals = useVaultTotals(vault.vTokenAddress);

  const shares = balance ? Number(balance) / 1e8 : 0;
  const hasPosition = shares > 0;

  if (!hasPosition && !balLoading) return null;
  if (balLoading) {
    return (
      <div className="rounded-xl bg-surface border border-line p-5 animate-pulse">
        <div className="h-4 bg-surface-overlay rounded w-48 mb-2" />
        <div className="h-6 bg-surface-overlay rounded w-32" />
      </div>
    );
  }

  const sharePrice = vaultTotals && vaultTotals.totalSupply > BigInt(0)
    ? Number(vaultTotals.totalAssets) / Number(vaultTotals.totalSupply)
    : 1;
  const wbtcAmount = wbtcValue ? Number(wbtcValue) / 1e8 : shares * sharePrice;
  const usdValue = wbtcAmount * vault.btcPrice;
  const risk = RISK_LABELS[vault.riskLevel];

  const fmtBtcShort = (v: number) => (v / 1e8).toFixed(4);
  const fmtUsdc = (v: number) => `$${(v / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const collateralBtc = strategyInfo ? strategyInfo.collateral / 1e8 : 0;
  const collateralUsd = collateralBtc * vault.btcPrice;

  // Liquidation factor from Vesu API (e.g. 0.95 for Re7 xBTC), fallback 0.95
  const liqThreshold = vault.liquidationFactor || 0.95;

  const isUsdcDebt = ["delta-neutral", "turbo", "apex"].includes(vault.id);
  const debtDisplay = strategyInfo && strategyInfo.debt > 0
    ? isUsdcDebt ? fmtUsdc(strategyInfo.debt) : `${fmtBtcShort(strategyInfo.debt)} WBTC`
    : null;
  const debtUsd = strategyInfo && strategyInfo.debt > 0
    ? isUsdcDebt ? strategyInfo.debt / 1e6 : (strategyInfo.debt / 1e8) * vault.btcPrice
    : 0;

  const netEquityUsd = collateralUsd - debtUsd;

  let healthFactor: number | undefined;
  if (strategyInfo && strategyInfo.debt > 0) {
    healthFactor = debtUsd > 0 ? (collateralUsd * liqThreshold) / debtUsd : undefined;
  }

  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="font-display text-xl text-btc italic leading-none flex-shrink-0">B</span>
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-fg">{vault.name}</p>
              <span className="text-[8px] font-mono tracking-widest text-fg-dim uppercase bg-surface-overlay px-1.5 py-0.5 rounded">
                {STRAT_TAG[vault.strategy]}
              </span>
              <span className={clsx(
                "text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded border",
                vault.riskLevel <= 2
                  ? "bg-up/10 border-up/20 text-up"
                  : vault.riskLevel === 3
                    ? "bg-caution/10 border-caution/20 text-caution"
                    : "bg-down/10 border-down/20 text-down"
              )}>
                {risk.label}
              </span>
            </div>
            <p className="text-[10px] text-fg-dim font-mono truncate">{vault.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-fg-dim font-mono mb-0.5">Value</p>
            <p className="text-[14px] font-mono font-bold text-btc">{formatUsd(usdValue)}</p>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-fg-dim font-mono mb-0.5">APY</p>
            <p className="text-[14px] font-mono font-semibold text-up">{formatPercent(vault.apy.total)}</p>
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={clsx("text-fg-dim transition-transform", expanded && "rotate-180")}
          >
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {/* Expanded details — inline, no redirect */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-line">
          {/* Position grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4">
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">yvBTC Shares</p>
              <p className="text-[15px] font-mono font-bold text-btc">
                {shares.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">WBTC Value</p>
              <p className="text-[15px] font-mono font-bold">
                {wbtcAmount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">USD Value</p>
              <p className="text-[15px] font-mono font-bold">{formatUsd(usdValue)}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">Share Price</p>
              <p className="text-[15px] font-mono font-bold">{sharePrice.toFixed(4)}</p>
            </div>
          </div>

          {/* On-chain strategy data */}
          {strategyInfo && strategyInfo.collateral > 0 && (
            <div className="rounded-lg bg-surface-overlay p-4 mb-3">
              <p className="text-[9px] font-mono text-fg-dim tracking-widest uppercase mb-3">
                On-Chain State
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Collateral</span>
                  <span className="font-mono text-fg">
                    {vault.id === "citadel" || vault.id === "trident"
                      ? `${fmtBtcShort(strategyInfo.collateral)} xWBTC`
                      : `${fmtBtcShort(strategyInfo.collateral)} WBTC`}
                  </span>
                </div>
                {debtDisplay && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-dim">Debt</span>
                    <span className="font-mono text-down">{debtDisplay}</span>
                  </div>
                )}
                {strategyInfo.loops > 0 && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-dim">Loops</span>
                    <span className="font-mono text-fg">{strategyInfo.loops}</span>
                  </div>
                )}
                {healthFactor && healthFactor < 100 && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-dim">Health</span>
                    <span className={clsx(
                      "font-mono font-semibold",
                      healthFactor > 1.5 ? "text-up" : healthFactor > 1.2 ? "text-caution" : "text-down"
                    )}>
                      {healthFactor > 10 ? ">10" : healthFactor.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Net Equity</span>
                  <span className="font-mono text-up">{formatUsd(netEquityUsd)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-fg-dim">Status</span>
                  <span className={clsx("font-mono", strategyInfo.paused ? "text-down" : "text-up")}>
                    {strategyInfo.paused ? "Paused" : "Active"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Actions row */}
          <div className="flex items-center gap-3 pt-2">
            <Link
              href={`/vault/${vault.id}`}
              className="text-[11px] font-mono text-btc hover:underline"
            >
              Deposit / Withdraw
            </Link>
            <span className="text-fg-dim text-[11px]">|</span>
            <a
              href={`${VOYAGER_BASE}/contract/${vault.vTokenAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-fg-dim hover:text-btc transition-colors"
            >
              View on Voyager
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function WalletSummary({ btcPrice }: { btcPrice: number }) {
  const { address } = useAccount();
  const wbtcBalance = useTokenBalance(TOKENS.WBTC.address);
  const usdcBalance = useTokenBalance(TOKENS.USDC.address);

  const wbtcAmount = wbtcBalance.balance
    ? Number(wbtcBalance.balance) / 10 ** TOKENS.WBTC.decimals
    : 0;
  const usdcAmount = usdcBalance.balance
    ? Number(usdcBalance.balance) / 10 ** TOKENS.USDC.decimals
    : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
      <div className="rounded-xl bg-surface border border-btc/20 p-5 animate-fade-up" style={{ animationDelay: "0.05s" }}>
        <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
          WBTC Balance
        </p>
        <p className="text-2xl font-mono font-bold tracking-tight text-btc">
          {wbtcBalance.loading ? (
            <span className="text-fg-dim animate-pulse">...</span>
          ) : (
            wbtcAmount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")
          )}
        </p>
        <p className="text-[11px] text-fg-dim font-mono mt-0.5">
          {btcPrice > 0 ? formatUsd(wbtcAmount * btcPrice) : ""}
        </p>
      </div>
      <div className="rounded-xl bg-surface border border-line p-5 animate-fade-up" style={{ animationDelay: "0.07s" }}>
        <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
          USDC Balance
        </p>
        <p className="text-2xl font-mono font-bold tracking-tight">
          {usdcBalance.loading ? (
            <span className="text-fg-dim animate-pulse">...</span>
          ) : (
            `$${usdcAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          )}
        </p>
      </div>
      <div className="rounded-xl bg-surface border border-line p-5 animate-fade-up" style={{ animationDelay: "0.09s" }}>
        <p className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1">
          Wallet
        </p>
        <p className="text-[13px] font-mono text-fg-muted mt-2 break-all">
          {address ? `${address.slice(0, 10)}...${address.slice(-8)}` : ""}
        </p>
      </div>
    </div>
  );
}

function ShieldedNotesSection() {
  const [notes, setNotes] = useState<UTXONote[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setNotes(getUnspentNotes());
  }, []);

  if (notes.length === 0 && !expanded) return null;

  const handleExport = () => {
    const allNotes = loadNotes();
    const json = JSON.stringify(allNotes.map(n => ({...n, amount: n.amount.toString()})), null, 2);
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalShares = notes.reduce((s, n) => s + n.amount, BigInt(0));

  return (
    <div className="mt-8 space-y-4 animate-fade-up" style={{ animationDelay: "0.15s" }}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
          Shielded UTXO Notes ({notes.length})
        </p>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] font-mono text-btc hover:underline"
        >
          {expanded ? "Hide" : "Manage"}
        </button>
      </div>

      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note) => (
            <div key={note.commitment} className="rounded-lg bg-surface border border-line p-3 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-mono text-fg">
                  {(Number(note.amount) / 1e8).toFixed(6)} BTC (shares)
                </p>
                <p className="text-[9px] font-mono text-fg-dim mt-0.5">
                  {note.commitment.slice(0, 16)}...{note.commitment.slice(-8)}
                </p>
              </div>
              <div className="text-right">
                <p className={clsx("text-[9px] font-mono", note.index >= 0 ? "text-up" : "text-caution")}>
                  {note.index >= 0 ? `Leaf #${note.index}` : "Pending"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && (
        <div className="rounded-xl bg-surface border border-line p-4 space-y-3">
          <button
            onClick={handleExport}
            className="w-full py-2 rounded text-[10px] font-mono bg-surface-overlay border border-line hover:border-btc/30 transition-colors"
          >
            {copied ? "Copied!" : "Export All Notes (JSON)"}
          </button>
        </div>
      )}
    </div>
  );
}

function StakingPositionCard({ pool, btcPrice }: { pool: typeof STAKING_POOLS[number]; btcPrice: number }) {
  const { balance, loading } = useVesuPosition(pool.vTokenAddress);
  const { wbtcValue } = useShareValue(pool.vTokenAddress, balance);
  const [expanded, setExpanded] = useState(true);

  const vTokens = balance ? Number(balance) / 1e18 : 0;
  const wbtcAmount = wbtcValue ? Number(wbtcValue) / 1e8 : 0;
  const hasPosition = vTokens > 0;

  if (!hasPosition && !loading) return null;
  if (loading) {
    return (
      <div className="rounded-xl bg-surface border border-line p-5 animate-pulse">
        <div className="h-4 bg-surface-overlay rounded w-48 mb-2" />
        <div className="h-6 bg-surface-overlay rounded w-32" />
      </div>
    );
  }

  const usdValue = wbtcAmount * btcPrice;

  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="font-display text-xl text-btc italic leading-none flex-shrink-0">S</span>
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-fg">{pool.name}</p>
              <span className="text-[8px] font-mono tracking-widest text-fg-dim uppercase bg-surface-overlay px-1.5 py-0.5 rounded">
                STAKE
              </span>
            </div>
            <p className="text-[10px] text-fg-dim font-mono truncate">{pool.vTokenSymbol} position</p>
          </div>
        </div>

        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-fg-dim font-mono mb-0.5">Value</p>
            <p className="text-[14px] font-mono font-bold text-btc">{formatUsd(usdValue)}</p>
          </div>
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            className={clsx("text-fg-dim transition-transform", expanded && "rotate-180")}
          >
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-line">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 py-4">
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">{pool.vTokenSymbol}</p>
              <p className="text-[15px] font-mono font-bold text-btc">
                {vTokens.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">WBTC Value</p>
              <p className="text-[15px] font-mono font-bold">
                {wbtcAmount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">USD Value</p>
              <p className="text-[15px] font-mono font-bold">{formatUsd(usdValue)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Link href={`/stake/${pool.slug}`} className="text-[11px] font-mono text-btc hover:underline">
              Manage Stake
            </Link>
            <span className="text-fg-dim text-[11px]">|</span>
            <a
              href={`${VOYAGER_BASE}/contract/${pool.vTokenAddress}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[11px] font-mono text-fg-dim hover:text-btc transition-colors"
            >
              View on Voyager
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function DcaOrdersSection({ btcPrice }: { btcPrice: number }) {
  const { orders, loading } = useDcaOrders();
  const [expanded, setExpanded] = useState(true);

  const activeOrders = orders.filter((o: DcaOrder) => o.active);

  if (activeOrders.length === 0 && !loading) return null;

  if (loading) {
    return (
      <div className="rounded-xl bg-surface border border-line p-5 animate-pulse">
        <div className="h-4 bg-surface-overlay rounded w-48 mb-2" />
        <div className="h-6 bg-surface-overlay rounded w-32" />
      </div>
    );
  }

  const totalBtcReceived = activeOrders.reduce((s: number, o: DcaOrder) => s + Number(o.btcReceived) / 1e8, 0);
  const totalDeposited = activeOrders.reduce((s: number, o: DcaOrder) => s + Number(o.deposited) / 1e18, 0);
  const totalSpent = activeOrders.reduce((s: number, o: DcaOrder) => s + Number(o.spent) / 1e18, 0);

  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="font-display text-xl text-btc italic leading-none flex-shrink-0">D</span>
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-fg">DCA Orders</p>
              <span className="text-[8px] font-mono tracking-widest text-fg-dim uppercase bg-surface-overlay px-1.5 py-0.5 rounded">
                DCA
              </span>
            </div>
            <p className="text-[10px] text-fg-dim font-mono truncate">
              {activeOrders.length} active order{activeOrders.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-fg-dim font-mono mb-0.5">BTC Received</p>
            <p className="text-[14px] font-mono font-bold text-btc">
              {totalBtcReceived.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}
            </p>
          </div>
          <svg
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            className={clsx("text-fg-dim transition-transform", expanded && "rotate-180")}
          >
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-line space-y-3 pt-4">
          {activeOrders.map((order: DcaOrder) => {
            const progress = order.totalOrders > 0 ? order.executedOrders / order.totalOrders : 0;
            const btcRec = Number(order.btcReceived) / 1e8;
            const remaining = Number(order.deposited - order.spent) / 1e18;

            return (
              <div key={order.id} className="rounded-lg bg-surface-overlay p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-mono text-fg">
                    Order #{order.id} {order.smart && <span className="text-btc text-[9px]">[SMART]</span>}
                  </p>
                  <p className="text-[10px] font-mono text-fg-dim">
                    {order.executedOrders}/{order.totalOrders} executed
                  </p>
                </div>
                <div className="h-1.5 rounded-full bg-void overflow-hidden">
                  <div
                    className="h-full rounded-full bg-btc transition-all"
                    style={{ width: `${Math.min(100, progress * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-fg-dim">Received: <span className="text-btc">{btcRec.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} WBTC</span></span>
                  <span className="text-fg-dim">Refundable: {remaining.toFixed(4)}</span>
                </div>
              </div>
            );
          })}

          <div className="flex items-center gap-3 pt-1">
            <Link href="/dca" className="text-[11px] font-mono text-btc hover:underline">
              Manage DCA
            </Link>
            <span className="text-fg-dim text-[11px]">|</span>
            <a
              href={`${VOYAGER_BASE}/contract/${SABLE_CONTRACTS.DCA}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[11px] font-mono text-fg-dim hover:text-btc transition-colors"
            >
              View on Voyager
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function CdpPositionSection({ btcPrice }: { btcPrice: number }) {
  const { position, loading } = useCdpPosition();
  const [expanded, setExpanded] = useState(true);

  const hasPosition = position && !loading && (position.collateral > BigInt(0) || position.debt > BigInt(0));

  if (!hasPosition && !loading) return null;

  if (loading) {
    return (
      <div className="rounded-xl bg-surface border border-line p-5 animate-pulse">
        <div className="h-4 bg-surface-overlay rounded w-48 mb-2" />
        <div className="h-6 bg-surface-overlay rounded w-32" />
      </div>
    );
  }

  if (!position) return null;

  const colBtc = Number(position.collateral) / 1e8;
  const colUsd = colBtc * btcPrice;
  const debtUsdc = Number(position.debt) / 1e6;
  const netEquity = colUsd - debtUsdc;
  const ltv = colUsd > 0 ? (debtUsdc / colUsd) * 100 : 0;
  const healthFactor = Number(position.healthBps) / 10000;
  const liqPrice = position.debt > BigInt(0) && position.collateral > BigInt(0)
    ? debtUsdc / (colBtc * 0.7)
    : 0;

  return (
    <div className="rounded-xl bg-surface border border-line overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-raised transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="font-display text-xl text-btc italic leading-none flex-shrink-0">C</span>
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-fg">BTC-Backed CDP</p>
              <span className="text-[8px] font-mono tracking-widest text-fg-dim uppercase bg-surface-overlay px-1.5 py-0.5 rounded">
                CDP
              </span>
            </div>
            <p className="text-[10px] text-fg-dim font-mono truncate">Deposit WBTC, borrow USDC via Vesu</p>
          </div>
        </div>

        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-fg-dim font-mono mb-0.5">Net Equity</p>
            <p className="text-[14px] font-mono font-bold text-btc">{formatUsd(netEquity)}</p>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-fg-dim font-mono mb-0.5">Health</p>
            <p className={clsx(
              "text-[14px] font-mono font-semibold",
              healthFactor >= 2 ? "text-up" : healthFactor >= 1.5 ? "text-caution" : "text-down"
            )}>
              {healthFactor >= 999 ? "Safe" : healthFactor.toFixed(2) + "x"}
            </p>
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={clsx("text-fg-dim transition-transform", expanded && "rotate-180")}
          >
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-line">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4">
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">Collateral</p>
              <p className="text-[15px] font-mono font-bold text-btc">
                {colBtc.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} <span className="text-[10px] text-fg-dim">WBTC</span>
              </p>
              <p className="text-[10px] font-mono text-fg-dim">{formatUsd(colUsd)}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">Debt</p>
              <p className="text-[15px] font-mono font-bold text-down">
                ${debtUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] text-fg-dim">USDC</span>
              </p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">LTV</p>
              <p className={clsx(
                "text-[15px] font-mono font-bold",
                ltv <= 45 ? "text-up" : ltv <= 60 ? "text-caution" : "text-down"
              )}>
                {ltv.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-fg-dim tracking-wider uppercase mb-0.5">Liq. Price</p>
              <p className="text-[15px] font-mono font-bold text-down">
                {liqPrice > 0 ? formatUsd(liqPrice) : "N/A"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Link
              href="/cdp"
              className="text-[11px] font-mono text-btc hover:underline"
            >
              Manage Position
            </Link>
            <span className="text-fg-dim text-[11px]">|</span>
            <a
              href={`${VOYAGER_BASE}/contract/${SABLE_CONTRACTS.CDP}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-fg-dim hover:text-btc transition-colors"
            >
              View on Voyager
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const { vaults, loading } = useVaults();
  const [btcPrice, setBtcPrice] = useState(0);

  useEffect(() => {
    fetchBtcPrice().then(setBtcPrice);
  }, []);

  if (!isConnected) {
    return <EmptyState />;
  }

  const price = vaults.length > 0 ? vaults[0].btcPrice : btcPrice;

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <div className="flex items-center justify-between mb-8 animate-fade-up">
        <div>
          <p className="text-[11px] font-mono text-fg-dim tracking-widest uppercase mb-1">
            Portfolio
          </p>
          <h1 className="text-3xl font-display italic text-fg">Your Positions</h1>
        </div>
        <Link
          href="/"
          className="text-[11px] font-mono text-btc hover:underline"
        >
          Explore All Vaults
        </Link>
      </div>

      <WalletSummary btcPrice={price} />

      <div className="space-y-4 animate-fade-up" style={{ animationDelay: "0.13s" }}>
        <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
          Vault Positions
        </p>

        {loading ? (
          <div className="rounded-xl bg-surface border border-line p-8 text-center">
            <p className="text-fg-dim font-mono text-[12px] animate-pulse">Loading vaults...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {vaults.map((vault) => (
              <VaultPositionCard key={vault.id} vault={vault} />
            ))}
          </div>
        )}
      </div>

      {/* Staking Positions */}
      <div className="mt-8 space-y-4 animate-fade-up" style={{ animationDelay: "0.14s" }}>
        <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
          Staking Positions
        </p>
        <div className="space-y-3">
          {STAKING_POOLS.map((pool) => (
            <StakingPositionCard key={pool.slug} pool={pool} btcPrice={price} />
          ))}
        </div>
      </div>

      {/* CDP Position */}
      <div className="mt-8 space-y-4 animate-fade-up" style={{ animationDelay: "0.15s" }}>
        <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
          CDP Position
        </p>
        <CdpPositionSection btcPrice={price} />
      </div>

      {/* DCA Orders */}
      <div className="mt-8 space-y-4 animate-fade-up" style={{ animationDelay: "0.16s" }}>
        <p className="text-[10px] font-mono text-fg-dim tracking-widest uppercase">
          DCA Orders
        </p>
        <DcaOrdersSection btcPrice={price} />
      </div>

      <ShieldedNotesSection />
    </div>
  );
}
