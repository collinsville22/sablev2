import { NextResponse } from "next/server";
import { fetchVesuWbtcData } from "@/lib/api/vesu";
import { VESU_POOLS } from "@/lib/constants";

const POOLS = [
  { slug: "prime", name: "Vesu PRIME", poolId: VESU_POOLS.PRIME.id },
  { slug: "re7-xbtc", name: "Vesu Re7 xBTC", poolId: VESU_POOLS.RE7_XBTC.id },
];

export async function GET() {
  try {
    const results = await Promise.all(
      POOLS.map(async (config) => {
        try {
          const data = await fetchVesuWbtcData(config.poolId);
          if (!data) return null;
          return {
            slug: config.slug,
            name: config.name,
            poolId: config.poolId,
            supplyApy: data.supplyApy,
            btcFiApr: data.btcFiApr,
            totalApy: data.totalApy,
            utilization: data.utilization,
            tvlUsd: data.tvlUsd,
            totalSupplied: data.totalSupplied,
            btcPrice: data.btcPrice,
            borrowApr: data.borrowApr,
          };
        } catch {
          return null;
        }
      }),
    );

    const valid = results.filter((r) => r !== null);
    return NextResponse.json(valid, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch pools" },
      { status: 500 },
    );
  }
}
