"use client";

import { useAccount, useConnect, useDisconnect } from "@starknet-react/core";
import { useState, useRef, useEffect } from "react";
import { formatAddress } from "@/lib/format";
import { clsx } from "clsx";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (isConnected && address) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 h-8 px-3 rounded-md bg-surface-raised border border-line hover:border-line-bright transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-gradient-to-br from-btc to-[#FF6B00]" />
          <span className="text-[12px] font-mono text-fg-muted">
            {formatAddress(address)}
          </span>
        </button>
        {open && (
          <div className="absolute right-0 mt-1.5 w-44 rounded-lg bg-surface-overlay border border-line shadow-2xl shadow-black/40 overflow-hidden">
            <button
              onClick={() => { disconnect(); setOpen(false); }}
              className="w-full px-3 py-2.5 text-left text-[12px] text-fg-dim hover:text-down hover:bg-surface-hover transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          "h-8 px-4 rounded-md text-[12px] font-medium transition-all",
          "bg-btc/10 text-btc border border-btc/20 hover:bg-btc/20 hover:border-btc/30"
        )}
      >
        Connect
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-52 rounded-lg bg-surface-overlay border border-line shadow-2xl shadow-black/40 overflow-hidden">
          {connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={() => { connect({ connector }); setOpen(false); }}
              className="w-full px-3 py-2.5 text-left text-[12px] text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors flex items-center gap-2.5"
            >
              <span className="w-5 h-5 rounded bg-surface flex items-center justify-center text-[10px] font-mono text-fg-dim">
                {connector.name[0]}
              </span>
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
