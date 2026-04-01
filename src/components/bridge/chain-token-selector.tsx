"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { clsx } from "clsx";
import type { OneClickToken, ChainInfo } from "@/lib/api/oneclick";

export function ChainSelector({
  chains,
  selected,
  onSelect,
  label,
}: {
  chains: ChainInfo[];
  selected: string | null;
  onSelect: (chain: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [openUp, setOpenUp] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = useCallback(() => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 260);
    }
    setOpen(!open);
  }, [open]);

  const selectedChain = chains.find((c) => c.id === selected);

  return (
    <div className="relative" ref={ref}>
      <label className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1 block">
        {label}
      </label>
      <button
        onClick={handleOpen}
        className={clsx(
          "w-full flex items-center justify-between h-10 px-3 rounded-lg bg-void border transition-colors text-left",
          open ? "border-btc/40" : "border-line hover:border-line-bright",
        )}
      >
        <span className={clsx("text-[13px] font-mono truncate", selected ? "text-fg" : "text-fg-dim")}>
          {selectedChain?.name || "Select chain"}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={clsx("text-fg-dim transition-transform shrink-0", open && "rotate-180")}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className={clsx(
            "absolute z-50 min-w-[200px] max-h-[240px] overflow-y-auto rounded-lg bg-surface-overlay border border-line shadow-2xl shadow-black/40",
            openUp ? "bottom-full mb-1 left-0 right-0" : "top-full mt-1 left-0 right-0",
          )}
        >
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => { onSelect(chain.id); setOpen(false); }}
              className={clsx(
                "w-full px-3 py-2 text-left text-[12px] font-mono transition-colors flex items-center justify-between",
                chain.id === selected
                  ? "text-btc bg-btc/5"
                  : "text-fg-muted hover:text-fg hover:bg-surface-hover",
              )}
            >
              <span>{chain.name}</span>
              <span className="text-[10px] text-fg-dim">{chain.tokenCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TokenSelector({
  tokens,
  selected,
  onSelect,
  label,
}: {
  tokens: OneClickToken[];
  selected: OneClickToken | null;
  onSelect: (token: OneClickToken) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const [openUp, setOpenUp] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = useCallback(() => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 280);
    }
    setOpen(!open);
  }, [open]);

  const filtered = search
    ? tokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(search.toLowerCase()) ||
          (t.assetId && t.assetId.toLowerCase().includes(search.toLowerCase())),
      )
    : tokens;

  return (
    <div className="relative" ref={ref}>
      <label className="text-[10px] font-mono text-fg-dim tracking-wider uppercase mb-1 block">
        {label}
      </label>
      <button
        onClick={handleOpen}
        className={clsx(
          "w-full flex items-center justify-between h-10 px-3 rounded-lg bg-void border transition-colors text-left",
          open ? "border-btc/40" : "border-line hover:border-line-bright",
        )}
      >
        <span className={clsx("text-[13px] font-mono truncate", selected ? "text-fg" : "text-fg-dim")}>
          {selected?.symbol || "Select token"}
        </span>
        {selected && (
          <span className="text-[10px] font-mono text-fg-dim shrink-0 ml-1">
            ${selected.price?.toFixed(2) ?? "—"}
          </span>
        )}
      </button>

      {open && (
        <div
          className={clsx(
            "absolute z-50 min-w-[200px] rounded-lg bg-surface-overlay border border-line shadow-2xl shadow-black/40 overflow-hidden",
            openUp ? "bottom-full mb-1 left-0 right-0" : "top-full mt-1 left-0 right-0",
          )}
        >
          <div className="p-2 border-b border-line">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-void border border-line rounded px-2 py-1.5 text-[11px] font-mono text-fg placeholder:text-fg-dim/40 focus:outline-none focus:border-btc/30"
              autoFocus
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-fg-dim font-mono">
                No tokens found
              </div>
            ) : (
              filtered.map((token, i) => (
                <button
                  key={`${token.assetId}-${i}`}
                  onClick={() => { onSelect(token); setOpen(false); setSearch(""); }}
                  className={clsx(
                    "w-full px-3 py-2 text-left transition-colors flex items-center justify-between",
                    token.assetId === selected?.assetId
                      ? "text-btc bg-btc/5"
                      : "text-fg-muted hover:text-fg hover:bg-surface-hover",
                  )}
                >
                  <span className="text-[12px] font-mono font-medium">{token.symbol}</span>
                  <span className="text-[10px] font-mono text-fg-dim">
                    ${token.price?.toFixed(2) ?? "—"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
