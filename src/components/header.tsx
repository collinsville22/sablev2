"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { WalletButton } from "./wallet-button";

const NAV_ITEMS = [
  { href: "/bridge", label: "Bridge" },
  { href: "/", label: "Vaults" },
  { href: "/stake", label: "Stake" },
  { href: "/privacy", label: "Privacy" },
  { href: "/cdp", label: "CDP" },
  { href: "/dca", label: "DCA" },
  { href: "/portfolio", label: "Portfolio" },
] as const;

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-void/60 backdrop-blur-2xl border-b border-line">
      <div className="max-w-[1200px] mx-auto px-5">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-10">
            <Link href="/" className="flex items-center gap-2.5 group">
              <img src="/logo-sable.png" alt="Sable" width={30} height={30} className="w-[30px] h-[30px] flex-shrink-0 invert brightness-90 group-hover:brightness-100 transition-all" />
              <span className="text-[20px] font-display italic tracking-tight text-fg group-hover:text-btc transition-colors">
                Sable
              </span>
            </Link>

            <nav className="hidden sm:flex items-center">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "px-3 py-1 text-[13px] transition-colors relative",
                      isActive
                        ? "text-fg"
                        : "text-fg-dim hover:text-fg-muted"
                    )}
                  >
                    {item.label}
                    {isActive && (
                      <span className="absolute -bottom-[15px] left-3 right-3 h-px bg-btc" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-fg-dim font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" />
              mainnet
            </div>
            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
}
