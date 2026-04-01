import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { StarknetProvider } from "@/providers/starknet";
import { Header } from "@/components/header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sable V2 \u00B7 UTXO Privacy Pools for Bitcoin on StarkNet",
  description:
    "Private BTC yield with UTXO shielded transfers, association set compliance, and stealth addresses on StarkNet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-void text-fg`}
      >
        <StarknetProvider>
          <div className="relative min-h-screen flex flex-col overflow-x-hidden">
            <div
              className="pointer-events-none fixed inset-0 z-50 opacity-[0.03]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                animation: "grain 8s steps(10) infinite",
              }}
            />
            <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-btc/[0.03] blur-[120px]" />
            <Header />
            <main className="flex-1 relative">{children}</main>
          </div>
        </StarknetProvider>
      </body>
    </html>
  );
}
