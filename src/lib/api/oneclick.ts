const ONECLICK_API = "https://1click.chaindefuser.com";
const STRK_ASSET_ID = "nep141:starknet.omft.near";

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
}

export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number; // basis points, e.g. 100 = 1%
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string; // smallest units
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string; // ISO 8601
}

export interface OneClickQuoteResponse {
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    timeEstimate: number; // seconds
    depositAddress?: string; // non-dry quotes return this inside quote
  };
  depositAddress?: string; // may also appear at top level
  quoteRequest: OneClickQuoteRequest;
}

export type OneClickStatusValue =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "COMPLETED"
  | "SUCCESS"
  | "FAILED"
  | "REFUNDED"
  | "INCOMPLETE_DEPOSIT";

export interface OneClickStatus {
  status: OneClickStatusValue;
  swapDetails?: {
    originChainTxHashes?: string[];
    destinationChainTxHashes?: string[];
  };
}

export interface ChainInfo {
  id: string;
  name: string;
  tokenCount: number;
}

let tokenCache: { data: OneClickToken[]; ts: number } | null = null;
const TOKEN_CACHE_TTL = 300_000; // 5 minutes

const CHAIN_NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  eth: "Ethereum",
  bitcoin: "Bitcoin",
  btc: "Bitcoin",
  solana: "Solana",
  sol: "Solana",
  base: "Base",
  arbitrum: "Arbitrum",
  arb: "Arbitrum",
  near: "NEAR",
  polygon: "Polygon",
  pol: "Polygon",
  avalanche: "Avalanche",
  avax: "Avalanche",
  bsc: "BNB Chain",
  optimism: "Optimism",
  op: "Optimism",
  gnosis: "Gnosis",
  ton: "TON",
  tron: "TRON",
  sui: "Sui",
  stellar: "Stellar",
  doge: "Dogecoin",
  xrp: "XRP",
  ltc: "Litecoin",
  bch: "Bitcoin Cash",
  zec: "Zcash",
  bera: "Berachain",
  starknet: "Starknet",
  cardano: "Cardano",
  aptos: "Aptos",
  monad: "Monad",
};

function chainDisplayName(id: string): string {
  return CHAIN_NAMES[id.toLowerCase()] || id.charAt(0).toUpperCase() + id.slice(1);
}

export async function fetchOneClickTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.ts < TOKEN_CACHE_TTL) {
    return tokenCache.data;
  }

  const res = await fetch(`${ONECLICK_API}/v0/tokens`);
  if (!res.ok) throw new Error(`1Click tokens API error: ${res.status}`);
  const data = (await res.json()) as OneClickToken[];
  tokenCache = { data, ts: Date.now() };
  return data;
}

export async function getOneClickQuote(
  params: OneClickQuoteRequest,
): Promise<OneClickQuoteResponse> {
  const res = await fetch(`${ONECLICK_API}/v0/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    const msg = err.message || `1Click quote error: ${res.status}`;
    // Make "amount too low" errors user-friendly
    const tooLowMatch = msg.match(/try at least (\d+)/);
    if (tooLowMatch) {
      // Convert smallest units to human-readable (STRK = 18 decimals)
      const minRaw = BigInt(tooLowMatch[1]);
      const minHuman = Number(minRaw) / 1e18;
      throw new Error(`Amount too low for bridge. Minimum ~${minHuman.toFixed(1)} STRK required.`);
    }

    // Timeout: solver couldn't fulfill in time — suggest retry
    if (/timeout/i.test(msg)) {
      throw new Error("Bridge quote timed out — solvers are busy. Please try again.");
    }

    // Make refund/recipient address errors user-friendly
    if (/refundTo.*not valid/i.test(msg)) {
      const addr = params.refundTo;
      const short = addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
      throw new Error(`Refund address (${short}) is not valid for the source chain. Make sure you entered your address on the source chain (not your Starknet address).`);
    }
    if (/recipient.*not valid/i.test(msg)) {
      throw new Error("Destination address is not valid for the target chain.");
    }

    throw new Error(msg);
  }
  const data = (await res.json()) as OneClickQuoteResponse;
  if (!data.depositAddress && data.quote?.depositAddress) {
    data.depositAddress = data.quote.depositAddress;
  }
  return data;
}

export async function submitOneClickDeposit(
  depositAddress: string,
  txHash: string,
): Promise<void> {
  const res = await fetch(`${ONECLICK_API}/v0/deposit/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ depositAddress, txHash }),
  });
  if (!res.ok) {
    // Non-critical: 1Click monitors deposits automatically
  }
}

export async function getOneClickStatus(
  depositAddress: string,
): Promise<OneClickStatus> {
  const res = await fetch(
    `${ONECLICK_API}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
  );
  if (!res.ok) throw new Error(`1Click status error: ${res.status}`);
  return res.json();
}

/** Build a deadline string ~24h from now */
export function makeDeadline(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

/** Valid placeholder address per chain for dry quotes (refundTo/recipient) */
const CHAIN_PLACEHOLDER_ADDR: Record<string, string> = {
  btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  ltc: "LSdTvMHRm8sScqwCi6x9wzYQae8JeZhx6y",
  doge: "D5dNbgFowCsM6xKT2pJVnXqYNenm1ps3yR",
  bch: "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
  xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  sol: "So11111111111111111111111111111111111111112",
  ton: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  stellar: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
  near: "system",
  dash: "XkNPrBSJtrHZUvUqb3JF4g5rMB3uzaJfEL",
  sui: "0x0000000000000000000000000000000000000000000000000000000000000001",
  aptos: "0x0000000000000000000000000000000000000000000000000000000000000001",
  zec: "t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU",
};

/** Get a valid placeholder address for dry quotes on a given chain */
export function getChainPlaceholderAddress(chain: string): string {
  return CHAIN_PLACEHOLDER_ADDR[chain.toLowerCase()]
    || "0x0000000000000000000000000000000000000001"; // EVM default
}

/** The STRK asset ID used for all Starknet bridge operations */
export { STRK_ASSET_ID };

const PINNED_CHAINS = ["btc", "eth", "sol", "base", "arb"];

/** Get unique chains from token list (excluding Starknet) */
export function getAvailableChains(tokens: OneClickToken[]): ChainInfo[] {
  const chainMap = new Map<string, number>();
  for (const t of tokens) {
    const chain = t.blockchain.toLowerCase();
    if (chain === "starknet") continue; // exclude Starknet — it's always the "other side"
    chainMap.set(chain, (chainMap.get(chain) || 0) + 1);
  }
  return Array.from(chainMap.entries())
    .map(([id, count]) => ({ id, name: chainDisplayName(id), tokenCount: count }))
    .sort((a, b) => {
      const aPin = PINNED_CHAINS.indexOf(a.id);
      const bPin = PINNED_CHAINS.indexOf(b.id);
      if (aPin !== -1 && bPin !== -1) return aPin - bPin;
      if (aPin !== -1) return -1;
      if (bPin !== -1) return 1;
      return b.tokenCount - a.tokenCount;
    });
}

/** Get tokens available on a specific chain */
export function getChainTokens(tokens: OneClickToken[], chain: string): OneClickToken[] {
  return tokens
    .filter((t) => t.blockchain.toLowerCase() === chain.toLowerCase())
    .sort((a, b) => (b.price || 0) - (a.price || 0)); // highest value first
}
