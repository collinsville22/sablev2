const YIELDS_URL = "https://yields.llama.fi/pools";
const CHART_URL = "https://yields.llama.fi/chart";

export interface DefiLlamaPool {
  pool: string;
  project: string;
  symbol: string;
  chain: string;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  tvlUsd: number;
  rewardTokens: string[] | null;
  underlyingTokens: string[] | null;
  poolMeta: string | null;
}

export interface DefiLlamaChartPoint {
  timestamp: string;
  apy: number;
  apyBase: number;
  apyReward: number | null;
  tvlUsd: number;
}

let poolCache: { data: DefiLlamaPool[]; ts: number } | null = null;
const CACHE_TTL = 60_000;

export async function fetchStarknetBtcPools(): Promise<DefiLlamaPool[]> {
  if (poolCache && Date.now() - poolCache.ts < CACHE_TTL) {
    return poolCache.data;
  }

  const res = await fetch(YIELDS_URL);
  if (!res.ok) throw new Error(`DefiLlama yields API error: ${res.status}`);
  const json = await res.json();

  const pools: DefiLlamaPool[] = (json.data as DefiLlamaPool[]).filter(
    (p) =>
      p.chain === "Starknet" &&
      p.symbol.toLowerCase().includes("btc")
  );

  poolCache = { data: pools, ts: Date.now() };
  return pools;
}

export async function fetchPoolChart(
  poolId: string,
): Promise<DefiLlamaChartPoint[]> {
  const res = await fetch(`${CHART_URL}/${poolId}`);
  if (!res.ok) throw new Error(`DefiLlama chart API error: ${res.status}`);
  const json = await res.json();
  return json.data as DefiLlamaChartPoint[];
}
