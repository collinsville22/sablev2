"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { RpcProvider, Contract, CallData } from "starknet";
import { TOKENS, SABLE_CONTRACTS, VOYAGER_BASE } from "@/lib/constants";
import { STARKNET_RPC } from "@/lib/rpc";

export type DcaFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export type DcaStep =
  | "idle"
  | "approving"    // signing approve + create_order
  | "pending"      // tx submitted
  | "complete"
  | "error";

export interface DcaOrder {
  id: number;
  owner: string;
  sellToken: string;
  sellAmountPer: bigint;    // raw amount per execution
  frequency: number;        // seconds
  totalOrders: number;
  executedOrders: number;
  nextExecution: number;    // timestamp
  active: boolean;
  smart: boolean;
  deposited: bigint;
  spent: bigint;
  btcReceived: bigint;
}

export interface DcaQuote {
  buyAmount: string;
  buyAmountUsd: number;
  sellAmountUsd: number;
  priceImpact: number;
  gasFeeUsd: number;
  route: string;
}

export interface MayerMultipleData {
  spot: number;
  twap200d: number;
  mayerMultiple: number;
  band: string;
  multiplier: number;
}

const DCA_CONTRACT = SABLE_CONTRACTS.DCA;

export const FREQUENCY_SECONDS: Record<DcaFrequency, number> = {
  daily: 24 * 60 * 60,
  weekly: 7 * 24 * 60 * 60,
  biweekly: 14 * 24 * 60 * 60,
  monthly: 30 * 24 * 60 * 60,
};

export const FREQUENCY_LABELS: Record<DcaFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
};

const TOKEN_DECIMALS: Record<string, number> = {
  [TOKENS.ETH.address]: 18,
  [TOKENS.USDC.address]: 6,
  [TOKENS.USDT.address]: 6,
  [TOKENS.STRK.address]: 18,
  [TOKENS.WBTC.address]: 8,
};

const DCA_ABI = [
  {
    type: "function",
    name: "get_order",
    inputs: [{ name: "order_id", type: "core::integer::u64" }],
    outputs: [
      { type: "core::starknet::contract_address::ContractAddress" },
      { type: "core::starknet::contract_address::ContractAddress" },
      { type: "core::integer::u256" },
      { type: "core::integer::u64" },
      { type: "core::integer::u32" },
      { type: "core::integer::u32" },
      { type: "core::integer::u64" },
      { type: "core::bool" },
      { type: "core::bool" },
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
    ],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_next_order_id",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_mayer_multiple",
    inputs: [],
    outputs: [
      { type: "core::integer::u128" },
      { type: "core::integer::u128" },
      { type: "core::integer::u128" },
    ],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_keeper_fee_bps",
    inputs: [],
    outputs: [{ type: "core::integer::u16" }],
    state_mutability: "view",
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
] as const;

/** Fetch a DCA quote from AVNU (display-only) */
export function useDcaQuote(sellToken: string, sellAmount: string) {
  const [quote, setQuote] = useState<DcaQuote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const amount = parseFloat(sellAmount);
    if (!sellToken || !amount || amount <= 0) {
      setQuote(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchQuote() {
      try {
        const res = await fetch(
          `/api/dca/quote?sell=${sellToken}&buy=${TOKENS.WBTC.address}&amount=${sellAmount}`
        );
        if (!res.ok) throw new Error("Quote failed");
        const data = await res.json();
        if (!cancelled) {
          setQuote(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setQuote(null);
          setLoading(false);
        }
      }
    }

    const timer = setTimeout(fetchQuote, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sellToken, sellAmount]);

  return { quote, loading };
}

/** Read Mayer Multiple from the DCA contract */
export function useMayerMultiple() {
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);
  const [data, setData] = useState<MayerMultipleData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      try {
        const contract = new Contract({ abi: DCA_ABI as unknown as import("starknet").Abi, address: DCA_CONTRACT, providerOrAccount: provider });
        const result = await contract.call("get_mayer_multiple");
        // Result is array: [spot, twap, mm] as BigInt
        const arr = result as unknown as Array<bigint | string>;
        const spot = Number(BigInt(arr[0]?.toString?.() ?? arr[0] ?? "0")) / 1e8;
        const twap = Number(BigInt(arr[1]?.toString?.() ?? arr[1] ?? "0")) / 1e8;
        const mm = Number(BigInt(arr[2]?.toString?.() ?? arr[2] ?? "0")) / 1e8;

        let band = "Normal";
        let multiplier = 1.0;
        if (mm < 0.8) { band = "Very Cheap"; multiplier = 1.5; }
        else if (mm < 1.0) { band = "Below Average"; multiplier = 1.25; }
        else if (mm < 1.5) { band = "Normal"; multiplier = 1.0; }
        else if (mm < 2.0) { band = "Expensive"; multiplier = 0.75; }
        else { band = "Overheated"; multiplier = 0.5; }

        if (!cancelled) {
          setData({ spot, twap200d: twap, mayerMultiple: mm, band, multiplier });
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      }
    }

    fetch();
    const interval = setInterval(fetch, 60_000); // refresh every minute
    return () => { cancelled = true; clearInterval(interval); };
  }, [provider]);

  return { data, loading };
}

/** Read keeper fee from the DCA contract (in basis points → percentage) */
export function useKeeperFee() {
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);
  const [feePct, setFeePct] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const contract = new Contract({ abi: DCA_ABI as unknown as import("starknet").Abi, address: DCA_CONTRACT, providerOrAccount: provider });
    contract.call("get_keeper_fee_bps").then((result) => {
      if (!cancelled) {
        const bps = Number(BigInt(String(result)));
        setFeePct((bps / 100).toString());
      }
    }).catch(() => {
      if (!cancelled) setFeePct(null);
    });
    return () => { cancelled = true; };
  }, [provider]);

  return feePct;
}

/** Manage DCA orders on-chain */
export function useDcaOrders() {
  const { address } = useAccount();
  const { sendAsync } = useSendTransaction({});
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);
  const contract = useMemo(
    () => new Contract({ abi: DCA_ABI as unknown as import("starknet").Abi, address: DCA_CONTRACT, providerOrAccount: provider }),
    [provider]
  );

  const [orders, setOrders] = useState<DcaOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [txStep, setTxStep] = useState<DcaStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  // Fetch all orders belonging to connected user
  const fetchOrders = useCallback(async () => {
    if (!address) {
      setOrders([]);
      setLoading(false);
      return;
    }

    try {
      const nextId = await contract.call("get_next_order_id");
      const maxId = Number(BigInt(nextId?.toString?.() ?? nextId ?? "1"));
      const userOrders: DcaOrder[] = [];

      for (let i = 1; i < maxId; i++) {
        try {
          const result = await contract.call("get_order", [i]);
          const arr = result as unknown as Array<bigint | string | boolean>;
          const owner = arr[0]?.toString?.() ?? arr[0] ?? "0x0";
          // Normalize addresses for comparison
          const ownerNorm = BigInt(owner).toString(16).toLowerCase();
          const userNorm = BigInt(address).toString(16).toLowerCase();

          if (ownerNorm === userNorm) {
            userOrders.push({
              id: i,
              owner,
              sellToken: "0x" + BigInt(arr[1]?.toString?.() ?? arr[1] ?? "0").toString(16),
              sellAmountPer: BigInt(arr[2]?.toString?.() ?? arr[2] ?? "0"),
              frequency: Number(BigInt(arr[3]?.toString?.() ?? arr[3] ?? "0")),
              totalOrders: Number(BigInt(arr[4]?.toString?.() ?? arr[4] ?? "0")),
              executedOrders: Number(BigInt(arr[5]?.toString?.() ?? arr[5] ?? "0")),
              nextExecution: Number(BigInt(arr[6]?.toString?.() ?? arr[6] ?? "0")),
              active: Boolean(arr[7]),
              smart: Boolean(arr[8]),
              deposited: BigInt(arr[9]?.toString?.() ?? arr[9] ?? "0"),
              spent: BigInt(arr[10]?.toString?.() ?? arr[10] ?? "0"),
              btcReceived: BigInt(arr[11]?.toString?.() ?? arr[11] ?? "0"),
            });
          }
        } catch {
          // Skip orders that fail to read
        }
      }

      setOrders(userOrders);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [address, contract]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Create order: approve + create_order multicall
  const createOrder = useCallback(async (params: {
    sellToken: string;
    sellAmountHuman: string;
    frequency: DcaFrequency;
    totalOrders: number;
    smart: boolean;
  }) => {
    if (!address) {
      setTxError("Wallet not connected");
      return;
    }

    setTxStep("approving");
    setTxError(null);
    setTxHash(null);

    try {
      const decimals = TOKEN_DECIMALS[params.sellToken.toLowerCase()] ?? TOKEN_DECIMALS[params.sellToken] ?? 18;
      const amountPerRaw = BigInt(Math.floor(parseFloat(params.sellAmountHuman) * (10 ** decimals)));
      const frequencySecs = FREQUENCY_SECONDS[params.frequency];

      // For smart DCA, deposit 1.5x total to cover max multiplier
      const depositMultiplier = params.smart ? BigInt(150) : BigInt(100);
      const totalDeposit = (amountPerRaw * BigInt(params.totalOrders) * depositMultiplier) / BigInt(100);

      // Multicall: approve + create_order
      const mask128 = (BigInt(1) << BigInt(128)) - BigInt(1);
      const calls = [
        {
          contractAddress: params.sellToken,
          entrypoint: "approve",
          calldata: CallData.compile([DCA_CONTRACT, { low: totalDeposit & mask128, high: totalDeposit >> BigInt(128) }]),
        },
        {
          contractAddress: DCA_CONTRACT,
          entrypoint: "create_order",
          calldata: CallData.compile([
            params.sellToken,
            { low: amountPerRaw & mask128, high: amountPerRaw >> BigInt(128) },
            frequencySecs,
            params.totalOrders,
            params.smart ? 1 : 0,
          ]),
        },
      ];

      const result = await sendAsync(calls);
      setTxStep("pending");
      setTxHash(result.transaction_hash);

      // Wait briefly then refresh
      setTimeout(() => {
        setTxStep("complete");
        fetchOrders();
      }, 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("cancel")) {
        setTxStep("idle");
        setTxError("Transaction rejected");
      } else {
        setTxStep("error");
        setTxError(msg);
      }
    }
  }, [address, sendAsync, fetchOrders]);

  // Cancel order on-chain
  const cancelOrder = useCallback(async (orderId: number) => {
    if (!address) return;

    setTxStep("approving");
    setTxError(null);
    setTxHash(null);

    try {
      const result = await sendAsync([{
        contractAddress: DCA_CONTRACT,
        entrypoint: "cancel_order",
        calldata: CallData.compile([orderId]),
      }]);

      setTxStep("pending");
      setTxHash(result.transaction_hash);

      setTimeout(() => {
        setTxStep("complete");
        fetchOrders();
      }, 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("cancel")) {
        setTxStep("idle");
      } else {
        setTxStep("error");
        setTxError(msg);
      }
    }
  }, [address, sendAsync, fetchOrders]);

  const resetTx = useCallback(() => {
    setTxStep("idle");
    setTxError(null);
    setTxHash(null);
  }, []);

  const activeOrders = orders.filter((o) => o.active && o.executedOrders < o.totalOrders);

  return {
    orders,
    activeOrders,
    loading,
    createOrder,
    cancelOrder,
    refreshOrders: fetchOrders,
    txStep,
    txHash,
    txError,
    resetTx,
  };
}

/** Read DCA execution history from contract events */
export function useDcaHistory() {
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);
  const { address } = useAccount();
  const [history, setHistory] = useState<Array<{
    orderId: number;
    keeper: string;
    sellAmount: bigint;
    btcReceived: bigint;
    keeperFee: bigint;
    mayerMultiple: number;
    executionNumber: number;
    txHash: string;
    blockNumber: number;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setHistory([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchEvents() {
      try {
        const allEvents: typeof history = [];
        let continuationToken: string | undefined = undefined;

        while (true) {
          const result = await provider.getEvents({
            address: DCA_CONTRACT,
            keys: [[]],
            from_block: { block_number: 0 },
            to_block: "latest",
            chunk_size: 500,
            continuation_token: continuationToken,
          });

          for (const e of result.events) {
            // OrderExecuted event: keys[0]=selector, keys[1]=order_id, keys[2]=keeper
            // data[0..1]=sell_amount (u256), data[2..3]=btc_received (u256),
            // data[4..5]=keeper_fee (u256), data[6]=mayer_multiple (u128), data[7]=execution_number (u32)
            if (e.keys.length >= 3 && e.data.length >= 8) {
              const orderId = Number(BigInt(e.keys[1] || "0"));
              const keeper = e.keys[2] || "0x0";
              const sellAmount = BigInt(e.data[0] || "0") + (BigInt(e.data[1] || "0") << BigInt(128));
              const btcReceived = BigInt(e.data[2] || "0") + (BigInt(e.data[3] || "0") << BigInt(128));
              const keeperFee = BigInt(e.data[4] || "0") + (BigInt(e.data[5] || "0") << BigInt(128));
              const mayerMultiple = Number(BigInt(e.data[6] || "0")) / 1e8;
              const executionNumber = Number(BigInt(e.data[7] || "0"));

              allEvents.push({
                orderId,
                keeper,
                sellAmount,
                btcReceived,
                keeperFee,
                mayerMultiple,
                executionNumber,
                txHash: e.transaction_hash,
                blockNumber: e.block_number ?? 0,
              });
            }
          }

          if (result.continuation_token) {
            continuationToken = result.continuation_token;
          } else {
            break;
          }
        }

        if (!cancelled) {
          // Sort newest first
          allEvents.sort((a, b) => b.blockNumber - a.blockNumber);
          setHistory(allEvents);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setHistory([]);
          setLoading(false);
        }
      }
    }

    fetchEvents();
    return () => { cancelled = true; };
  }, [provider, address]);

  return { history, loading };
}

/** Helper: format raw amount to human readable */
export function formatTokenAmount(raw: bigint, tokenAddress: string): string {
  // Normalize address: pad to match TOKEN_DECIMALS keys (0x + 64 hex chars)
  let normalized: string;
  if (tokenAddress.startsWith("0x")) {
    normalized = "0x" + tokenAddress.slice(2).toLowerCase().padStart(64, "0");
  } else {
    normalized = "0x" + BigInt(tokenAddress).toString(16).toLowerCase().padStart(64, "0");
  }
  // Look up using normalized form against normalized keys
  let decimals = 18;
  for (const [addr, dec] of Object.entries(TOKEN_DECIMALS)) {
    const addrNorm = "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
    if (addrNorm === normalized) { decimals = dec; break; }
  }
  const val = Number(raw) / (10 ** decimals);
  if (decimals <= 8) return val.toFixed(8);
  return val.toFixed(6);
}

/** Helper: get token symbol from address */
export function getTokenSymbol(tokenAddress: string): string {
  // Normalize: convert decimal BigInt strings or unpadded hex to standard 0x-prefixed hex
  let normalized: string;
  if (tokenAddress.startsWith("0x")) {
    normalized = "0x" + tokenAddress.slice(2).toLowerCase().padStart(64, "0");
  } else {
    // Decimal string from BigInt
    normalized = "0x" + BigInt(tokenAddress).toString(16).toLowerCase().padStart(64, "0");
  }
  for (const token of Object.values(TOKENS)) {
    const tokenNorm = "0x" + token.address.slice(2).toLowerCase().padStart(64, "0");
    if (tokenNorm === normalized) return token.symbol;
  }
  return "???";
}
