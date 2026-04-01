"use client";

import { useAccount, useSendTransaction } from "@starknet-react/core";
import { useMemo, useCallback, useState, useEffect } from "react";
import { Contract, RpcProvider, uint256, CallData } from "starknet";
import { STARKNET_RPC } from "@/lib/rpc";
import { ERC4626_ABI, ERC20_ABI } from "@/lib/abi/erc4626";

const STRATEGY_ABI = [
  {
    type: "function",
    name: "get_strategy_info",
    inputs: [],
    outputs: [
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
      { type: "core::integer::u8" },
      { type: "core::bool" },
    ],
    state_mutability: "view",
  },
] as const;

const MIN_DEPOSIT_ABI = [
  {
    type: "function",
    name: "min_deposit",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
] as const;

export function useVaultRead(vaultAddress: string) {
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);

  const vault = useMemo(
    () => new Contract({ abi: ERC4626_ABI as unknown as import("starknet").Abi, address: vaultAddress, providerOrAccount: provider }),
    [vaultAddress, provider]
  );

  const getTotalAssets = useCallback(async (): Promise<bigint> => {
    const result = await vault.call("total_assets");
    return BigInt(result.toString());
  }, [vault]);

  const getTotalSupply = useCallback(async (): Promise<bigint> => {
    const result = await vault.call("total_supply");
    return BigInt(result.toString());
  }, [vault]);

  const getShareBalance = useCallback(
    async (account: string): Promise<bigint> => {
      const result = await vault.call("balance_of", [account]);
      return BigInt(result.toString());
    },
    [vault]
  );

  const previewDeposit = useCallback(
    async (assets: bigint): Promise<bigint> => {
      const u = uint256.bnToUint256(assets);
      const result = await vault.call("preview_deposit", [u]);
      return BigInt(result.toString());
    },
    [vault]
  );

  const previewWithdraw = useCallback(
    async (assets: bigint): Promise<bigint> => {
      const u = uint256.bnToUint256(assets);
      const result = await vault.call("preview_withdraw", [u]);
      return BigInt(result.toString());
    },
    [vault]
  );

  return { getTotalAssets, getTotalSupply, getShareBalance, previewDeposit, previewWithdraw };
}

export function useVaultWrite(vaultAddress: string, assetAddress: string) {
  const { account, address } = useAccount();
  const { sendAsync } = useSendTransaction({});

  const deposit = useCallback(
    async (assets: bigint) => {
      if (!account || !address) throw new Error("Wallet not connected");

      const assetU256 = uint256.bnToUint256(assets);
      const maxU256 = uint256.bnToUint256(BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));

      const calls = [
        {
          contractAddress: assetAddress,
          entrypoint: "approve",
          calldata: CallData.compile([vaultAddress, maxU256]),
        },
        {
          contractAddress: vaultAddress,
          entrypoint: "deposit",
          calldata: CallData.compile([assetU256, address]),
        },
      ];

      return await sendAsync(calls);
    },
    [account, address, vaultAddress, assetAddress, sendAsync]
  );

  const withdraw = useCallback(
    async (assets: bigint) => {
      if (!account || !address) throw new Error("Wallet not connected");

      const assetU256 = uint256.bnToUint256(assets);

      const calls = [
        {
          contractAddress: vaultAddress,
          entrypoint: "withdraw",
          calldata: CallData.compile([assetU256, address, address]),
        },
      ];

      return await sendAsync(calls);
    },
    [account, address, vaultAddress, sendAsync]
  );

  const redeem = useCallback(
    async (shares: bigint) => {
      if (!account || !address) throw new Error("Wallet not connected");

      const sharesU256 = uint256.bnToUint256(shares);

      const calls = [
        {
          contractAddress: vaultAddress,
          entrypoint: "redeem",
          calldata: CallData.compile([sharesU256, address, address]),
        },
      ];

      return await sendAsync(calls);
    },
    [account, address, vaultAddress, sendAsync]
  );

  return { deposit, withdraw, redeem };
}

export function useStrategyInfo(vaultAddress: string | null) {
  const [info, setInfo] = useState<{
    collateral: number;
    debt: number;
    loops: number;
    paused: boolean;
  } | null>(null);

  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);

  useEffect(() => {
    if (!vaultAddress) {
      setInfo(null);
      return;
    }

    let cancelled = false;

    const vault = new Contract({ abi: STRATEGY_ABI as unknown as import("starknet").Abi, address: vaultAddress, providerOrAccount: provider });
    vault
      .call("get_strategy_info")
      .then((result: unknown) => {
        if (cancelled) return;
        // starknet.js auto-combines u256 (lo+hi) into single BigInt values
        // So result is 4 elements: [collateral, debt, loops, paused]
        const arr = Array.isArray(result) ? result : Object.values(result as Record<string, unknown>);
        const collateral = Number(BigInt(arr[0] || 0));
        const debt = Number(BigInt(arr[1] || 0));
        const loops = Number(arr[2] || 0);
        const paused = Boolean(arr[3]);
        setInfo({ collateral, debt, loops, paused });
      })
      .catch(() => {
        if (!cancelled) setInfo({ collateral: 0, debt: 0, loops: 0, paused: false });
      });

    return () => { cancelled = true; };
  }, [vaultAddress, provider]);

  return info;
}

export function useTokenBalance(tokenAddress: string) {
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

    const token = new Contract({ abi: ERC20_ABI as unknown as import("starknet").Abi, address: tokenAddress, providerOrAccount: provider });
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
  }, [address, tokenAddress, provider]);

  return { balance, loading };
}

/** Converts user's share balance to underlying WBTC value via on-chain convert_to_assets */
export function useShareValue(vaultAddress: string | null, shareBalance: bigint | null) {
  const [wbtcValue, setWbtcValue] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);

  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);

  useEffect(() => {
    if (!vaultAddress || !shareBalance || shareBalance === BigInt(0)) {
      setWbtcValue(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const vault = new Contract({ abi: ERC4626_ABI as unknown as import("starknet").Abi, address: vaultAddress, providerOrAccount: provider });
    const u = uint256.bnToUint256(shareBalance);
    vault
      .call("convert_to_assets", [u])
      .then((result: unknown) => {
        if (!cancelled) {
          setWbtcValue(BigInt((result as { toString(): string }).toString()));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Fallback: assume 1:1 ratio
          setWbtcValue(shareBalance);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [vaultAddress, shareBalance, provider]);

  return { wbtcValue, loading };
}

/** Reads total_assets and total_supply for share price calculation */
export function useVaultTotals(vaultAddress: string | null) {
  const [data, setData] = useState<{ totalAssets: bigint; totalSupply: bigint } | null>(null);

  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);

  useEffect(() => {
    if (!vaultAddress) {
      setData(null);
      return;
    }

    let cancelled = false;

    const vault = new Contract({ abi: ERC4626_ABI as unknown as import("starknet").Abi, address: vaultAddress, providerOrAccount: provider });
    Promise.all([
      vault.call("total_assets"),
      vault.call("total_supply"),
    ])
      .then(([assets, supply]) => {
        if (!cancelled) {
          setData({
            totalAssets: BigInt(assets.toString()),
            totalSupply: BigInt(supply.toString()),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });

    return () => { cancelled = true; };
  }, [vaultAddress, provider]);

  return data;
}

/** Reads min_deposit() from vault contract (returns sats as bigint, or null if not supported) */
export function useMinDeposit(vaultAddress: string | null) {
  const [minDeposit, setMinDeposit] = useState<bigint | null>(null);

  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);

  useEffect(() => {
    if (!vaultAddress) {
      setMinDeposit(null);
      return;
    }

    let cancelled = false;

    const vault = new Contract({ abi: MIN_DEPOSIT_ABI as unknown as import("starknet").Abi, address: vaultAddress, providerOrAccount: provider });
    vault
      .call("min_deposit")
      .then((result: unknown) => {
        if (!cancelled) {
          setMinDeposit(BigInt((result as { toString(): string }).toString()));
        }
      })
      .catch(() => {
        if (!cancelled) setMinDeposit(null);
      });

    return () => { cancelled = true; };
  }, [vaultAddress, provider]);

  return minDeposit;
}
