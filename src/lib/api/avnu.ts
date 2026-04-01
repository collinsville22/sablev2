const AVNU_API = "https://starknet.api.avnu.fi";

export const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const WBTC_ADDRESS = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac";
export const AVNU_ROUTER = "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f";

export interface AvnuQuote {
  quoteId: string;
  sellTokenAddress: string;
  sellAmount: string; // hex
  sellAmountInUsd: number;
  buyTokenAddress: string;
  buyAmount: string; // hex
  buyAmountInUsd: number;
  gasFees: string;
  gasFeesInUsd: number;
  priceImpact: number;
  routes: AvnuRoute[];
  estimatedSlippage: number;
}

export interface AvnuRoute {
  name: string;
  percent: number;
  sellTokenAddress: string;
  buyTokenAddress: string;
}

export interface AvnuBuildCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

/** Get a swap quote from AVNU */
export async function getAvnuQuote(
  sellToken: string,
  buyToken: string,
  sellAmount: bigint,
  takerAddress?: string,
): Promise<AvnuQuote> {
  const params = new URLSearchParams({
    sellTokenAddress: sellToken,
    buyTokenAddress: buyToken,
    sellAmount: "0x" + sellAmount.toString(16),
  });
  if (takerAddress) params.set("takerAddress", takerAddress);

  const res = await fetch(`${AVNU_API}/swap/v3/quotes?${params}`);
  if (!res.ok) throw new Error(`AVNU quote error: ${res.status}`);
  const quotes = (await res.json()) as AvnuQuote[];
  if (!quotes.length) throw new Error("No AVNU quotes available");
  return quotes[0];
}

/** Build swap transaction calldata from a quote */
export async function buildAvnuSwap(
  quoteId: string,
  takerAddress: string,
  slippage = 0.01,
): Promise<AvnuBuildCall[]> {
  const res = await fetch(`${AVNU_API}/swap/v3/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteId,
      takerAddress,
      slippage,
      includeApprove: true,
    }),
  });
  if (!res.ok) throw new Error(`AVNU build error: ${res.status}`);
  const data = await res.json();
  return data.calls as AvnuBuildCall[];
}

/** Parse a hex amount string to bigint */
export function parseHexAmount(hex: string): bigint {
  return BigInt(hex);
}
