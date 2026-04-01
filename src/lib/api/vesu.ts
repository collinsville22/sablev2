const VESU_API = "https://api.vesu.xyz";

export interface VesuPool {
  id: string;
  name: string;
  isDeprecated: boolean;
  protocolVersion: string;
  owner: string;
  assets: VesuAsset[];
  pairs?: VesuPair[];
}

export interface VesuAsset {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  vToken: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  usdPrice: { value: string; decimals: number };
  stats: {
    canBeBorrowed: boolean;
    totalSupplied: { value: string; decimals: number };
    totalDebt: { value: string; decimals: number };
    currentUtilization: { value: string; decimals: number };
    supplyApy: { value: string; decimals: number };
    btcFiSupplyApr: { value: string; decimals: number } | null;
    borrowApr: { value: string; decimals: number };
    lstApr: { value: string; decimals: number } | null;
  };
}

export interface VesuPair {
  collateralAssetAddress: string;
  debtAssetAddress: string;
  maxLTV: { value: string; decimals: number };
  liquidationFactor: { value: string; decimals: number };
}

let poolsCache: { data: VesuPool[]; ts: number } | null = null;
const poolDetailCache = new Map<string, { data: VesuPool; ts: number }>();
const CACHE_TTL = 60_000;

function parseVesuDecimal(v: { value: string; decimals: number }): number {
  return Number(BigInt(v.value)) / 10 ** v.decimals;
}

export { parseVesuDecimal };

export async function fetchVesuPools(): Promise<VesuPool[]> {
  if (poolsCache && Date.now() - poolsCache.ts < CACHE_TTL) {
    return poolsCache.data;
  }

  const res = await fetch(`${VESU_API}/pools`);
  if (!res.ok) throw new Error(`Vesu API error: ${res.status}`);
  const json = await res.json();

  const pools = (Array.isArray(json) ? json : json.data || []) as VesuPool[];
  const active = pools.filter((p) => !p.isDeprecated);
  poolsCache = { data: active, ts: Date.now() };
  return active;
}

/** Fetches a single pool with full detail including pairs (liquidation parameters). */
async function fetchPoolDetail(poolId: string): Promise<VesuPool> {
  const cached = poolDetailCache.get(poolId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const res = await fetch(`${VESU_API}/pools/${poolId}`);
  if (!res.ok) throw new Error(`Vesu pool API error: ${res.status}`);
  const json = await res.json();
  const pool = (json.data ?? json) as VesuPool;
  poolDetailCache.set(poolId, { data: pool, ts: Date.now() });
  return pool;
}

/** Extracts the minimum liquidation factor across all pairs in a pool (conservative). */
function extractLiquidationFactor(pool: VesuPool): number {
  const pairs = pool.pairs || [];
  if (pairs.length === 0) return 0;
  return Math.min(...pairs.map((p) => parseVesuDecimal(p.liquidationFactor)));
}

export async function fetchVesuWbtcData(poolId: string) {
  const pool = await fetchPoolDetail(poolId);
  if (!pool) return null;

  const wbtc = pool.assets.find((a) => a.symbol === "WBTC");
  if (!wbtc) return null;

  const supplyApy = parseVesuDecimal(wbtc.stats.supplyApy) * 100;
  const btcFiApr = wbtc.stats.btcFiSupplyApr
    ? parseVesuDecimal(wbtc.stats.btcFiSupplyApr) * 100
    : 0;
  const borrowApr = parseVesuDecimal(wbtc.stats.borrowApr) * 100;
  const utilization = parseVesuDecimal(wbtc.stats.currentUtilization) * 100;
  const totalSupplied =
    Number(BigInt(wbtc.stats.totalSupplied.value)) /
    10 ** wbtc.stats.totalSupplied.decimals;
  const btcPrice = parseVesuDecimal(wbtc.usdPrice);

  const usdc = pool.assets.find((a) => a.symbol === "USDC");
  const usdcBorrowApr = usdc ? parseVesuDecimal(usdc.stats.borrowApr) * 100 : borrowApr;
  const usdcSupplyApy = usdc ? parseVesuDecimal(usdc.stats.supplyApy) * 100 : 0;

  const liquidationFactor = extractLiquidationFactor(pool);

  return {
    pool: pool.name,
    poolId: pool.id,
    asset: wbtc,
    vTokenAddress: wbtc.vToken.address,
    vTokenSymbol: wbtc.vToken.symbol,
    supplyApy,
    btcFiApr,
    totalApy: supplyApy + btcFiApr,
    borrowApr,
    usdcBorrowApr,
    usdcSupplyApy,
    utilization,
    totalSupplied,
    tvlUsd: totalSupplied * btcPrice,
    btcPrice,
    liquidationFactor,
  };
}

/** Fetches xWBTC-specific btcFiSupplyApr from a Vesu pool (returns 0 if null). */
export async function fetchVesuXwbtcBtcFi(poolId: string): Promise<number> {
  try {
    const pool = await fetchPoolDetail(poolId);
    if (!pool) return 0;
    const xwbtc = pool.assets.find(
      (a) => a.symbol.toLowerCase() === "xwbtc" || a.symbol.toLowerCase() === "xstrk-wbtc"
    );
    if (!xwbtc || !xwbtc.stats.btcFiSupplyApr) return 0;
    return parseVesuDecimal(xwbtc.stats.btcFiSupplyApr) * 100;
  } catch {
    return 0;
  }
}

export async function fetchVesuUsdcData(poolId: string) {
  const pool = await fetchPoolDetail(poolId);
  if (!pool) return null;

  const usdc = pool.assets.find((a) => a.symbol === "USDC");
  if (!usdc) return null;

  const supplyApy = parseVesuDecimal(usdc.stats.supplyApy) * 100;
  const borrowApr = parseVesuDecimal(usdc.stats.borrowApr) * 100;
  const utilization = parseVesuDecimal(usdc.stats.currentUtilization) * 100;
  const totalSupplied =
    Number(BigInt(usdc.stats.totalSupplied.value)) /
    10 ** usdc.stats.totalSupplied.decimals;
  const usdcPrice = parseVesuDecimal(usdc.usdPrice);

  return {
    supplyApy,
    borrowApr,
    utilization,
    totalSupplied,
    tvlUsd: totalSupplied * usdcPrice,
  };
}
