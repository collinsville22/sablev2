"use client";

import { useAccount, useSendTransaction } from "@starknet-react/core";
import { useMemo, useCallback, useState, useEffect } from "react";
import { RpcProvider, Contract, uint256 } from "starknet";
import { STARKNET_RPC } from "@/lib/rpc";
import { TOKENS, VESU_POOLS } from "@/lib/constants";
import { ERC20_ABI } from "@/lib/abi/erc4626";
const REFRESH_INTERVAL = 60_000; // 60s

export interface StakingPoolConfig {
  slug: string;
  name: string;
  poolId: string;
  vTokenAddress: string;
  vTokenSymbol: string;
  riskLevel: 1 | 2;
  description: string;
  howItWorks: string[];
  risks: string[];
}

export const STAKING_POOLS: StakingPoolConfig[] = [
  {
    slug: "prime",
    name: "Vesu PRIME",
    poolId: VESU_POOLS.PRIME.id,
    vTokenAddress: VESU_POOLS.PRIME.vTokenAddress,
    vTokenSymbol: VESU_POOLS.PRIME.vTokenSymbol,
    riskLevel: 1,
    description: "Supply WBTC to the Vesu PRIME lending pool. Earn base lending interest plus STRK rewards from BTCFi Season.",
    howItWorks: [
      "Deposit WBTC into Vesu PRIME pool",
      "Receive vWBTC tokens (interest-bearing)",
      "Earn supply APY from borrower interest",
      "Earn STRK BTCFi Season rewards",
    ],
    risks: [
      "Vesu smart contract risk",
      "WBTC wrapper risk",
    ],
  },
  {
    slug: "re7-xbtc",
    name: "Vesu Re7 xBTC",
    poolId: VESU_POOLS.RE7_XBTC.id,
    vTokenAddress: VESU_POOLS.RE7_XBTC.vTokenAddress,
    vTokenSymbol: VESU_POOLS.RE7_XBTC.vTokenSymbol,
    riskLevel: 2,
    description: "Supply WBTC to the Re7 xBTC pool on Vesu. Higher BTCFi rewards during the incentive program.",
    howItWorks: [
      "Deposit WBTC into Vesu Re7 xBTC pool",
      "Receive vWBTC-Re7xBTC tokens (interest-bearing)",
      "Earn supply APY from borrower interest",
      "Earn enhanced STRK BTCFi Season rewards",
    ],
    risks: [
      "Vesu smart contract risk",
      "Re7 pool curator risk",
      "WBTC wrapper risk",
    ],
  },
];

export function getPoolBySlug(slug: string): StakingPoolConfig | undefined {
  return STAKING_POOLS.find((p) => p.slug === slug);
}

export interface StakingPoolData {
  config: StakingPoolConfig;
  supplyApy: number;
  btcFiApr: number;
  totalApy: number;
  utilization: number;
  tvlUsd: number;
  totalSuppliedBtc: number;
  btcPrice: number;
  borrowApr: number;
}

export function useStakingPools() {
  const [pools, setPools] = useState<StakingPoolData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/staking");
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const items: Array<{
        slug: string;
        supplyApy: number;
        btcFiApr: number;
        totalApy: number;
        utilization: number;
        tvlUsd: number;
        totalSupplied: number;
        btcPrice: number;
        borrowApr: number;
      }> = await res.json();

      const mapped = items
        .map((item) => {
          const config = STAKING_POOLS.find((p) => p.slug === item.slug);
          if (!config) return null;
          return {
            config,
            supplyApy: item.supplyApy,
            btcFiApr: item.btcFiApr,
            totalApy: item.totalApy,
            utilization: item.utilization,
            tvlUsd: item.tvlUsd,
            totalSuppliedBtc: item.totalSupplied,
            btcPrice: item.btcPrice,
            borrowApr: item.borrowApr,
          } satisfies StakingPoolData;
        })
        .filter((r): r is StakingPoolData => r !== null);

      setPools(mapped);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch pool data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  return { pools, loading, error, refresh };
}

export function useStakingPool(slug: string) {
  const { pools, loading, error } = useStakingPools();
  const pool = pools.find((p) => p.config.slug === slug) ?? null;
  return { pool, loading, error };
}

export function useVesuPosition(vTokenAddress: string) {
  const { address } = useAccount();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);

  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);

  useEffect(() => {
    if (!address) {
      setBalance(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const token = new Contract({
      abi: ERC20_ABI as unknown as import("starknet").Abi,
      address: vTokenAddress,
      providerOrAccount: provider,
    });

    token
      .call("balance_of", [address])
      .then((result) => {
        if (!cancelled) {
          setBalance(BigInt(result.toString()));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBalance(BigInt(0));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [address, vTokenAddress, provider]);

  return { balance, loading };
}

export function useVesuDeposit(poolId: string) {
  const { account, address } = useAccount();
  const { sendAsync } = useSendTransaction({});

  // Find vToken address from pool config
  const vTokenAddress = useMemo(() => {
    const config = STAKING_POOLS.find((p) => p.poolId === poolId);
    return config?.vTokenAddress ?? "";
  }, [poolId]);

  const deposit = useCallback(
    async (amount: bigint) => {
      if (!account || !address) throw new Error("Wallet not connected");
      if (!vTokenAddress) throw new Error("Unknown pool");

      const amountU256 = uint256.bnToUint256(amount);

      // Call 1: Approve WBTC to vToken contract
      // Call 2: vToken.deposit(assets, receiver) — ERC-4626
      const calls = [
        {
          contractAddress: TOKENS.WBTC.address,
          entrypoint: "approve",
          calldata: [vTokenAddress, amountU256.low.toString(), amountU256.high.toString()],
        },
        {
          contractAddress: vTokenAddress,
          entrypoint: "deposit",
          calldata: [amountU256.low.toString(), amountU256.high.toString(), address],
        },
      ];

      return await sendAsync(calls);
    },
    [account, address, vTokenAddress, sendAsync],
  );

  return { deposit };
}

export function useVesuWithdraw(poolId: string) {
  const { account, address } = useAccount();
  const { sendAsync } = useSendTransaction({});

  // Find vToken address from pool config
  const vTokenAddress = useMemo(() => {
    const config = STAKING_POOLS.find((p) => p.poolId === poolId);
    return config?.vTokenAddress ?? "";
  }, [poolId]);

  const withdraw = useCallback(
    async (amount: bigint) => {
      if (!account || !address) throw new Error("Wallet not connected");
      if (!vTokenAddress) throw new Error("Unknown pool");

      const amountU256 = uint256.bnToUint256(amount);

      // Single call: vToken.withdraw(assets, receiver, owner) — ERC-4626
      // Withdraws the specified WBTC amount by burning the required shares
      const calls = [
        {
          contractAddress: vTokenAddress,
          entrypoint: "withdraw",
          calldata: [amountU256.low.toString(), amountU256.high.toString(), address, address],
        },
      ];

      return await sendAsync(calls);
    },
    [account, address, vTokenAddress, sendAsync],
  );

  return { withdraw };
}
