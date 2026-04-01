const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

let priceCache: { usd: number; ts: number } | null = null;
const CACHE_TTL = 30_000;

export async function fetchBtcPrice(): Promise<number> {
  if (priceCache && Date.now() - priceCache.ts < CACHE_TTL) {
    return priceCache.usd;
  }

  try {
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    const json = await res.json();
    const usd = json.bitcoin.usd as number;
    priceCache = { usd, ts: Date.now() };
    return usd;
  } catch {
    return priceCache?.usd ?? 0;
  }
}
