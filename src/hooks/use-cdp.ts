"use client";

import { useAccount } from "@starknet-react/core";
import { useMemo, useCallback, useState, useEffect } from "react";
import { Contract, RpcProvider, uint256, CallData, type Call } from "starknet";
import { STARKNET_RPC } from "@/lib/rpc";
import { SABLE_CONTRACTS, TOKENS, NOSTRA } from "@/lib/constants";
import { CDP_ABI } from "@/lib/abi/cdp";

const CDP_ADDRESS = SABLE_CONTRACTS.CDP;
const DUSDC_ADDRESS = NOSTRA.DUSDC;

/** Read user's CDP position (collateral, debt, health factor, max borrow) */
export function useCdpPosition() {
  const { address } = useAccount();
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);
  const [data, setData] = useState<{
    collateral: bigint;
    debt: bigint;
    healthBps: bigint;
    maxBorrow: bigint;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function fetchPosition() {
      try {
        const cdp = new Contract({ abi: CDP_ABI as unknown as import("starknet").Abi, address: CDP_ADDRESS, providerOrAccount: provider });
        const [posResult, maxBorrowResult] = await Promise.all([
          cdp.get_position(address),
          cdp.get_max_borrow(address),
        ]);

        if (cancelled) return;

        // get_position returns (wbtc_collateral, usdc_debt, health_factor_bps)
        const collateral = BigInt(posResult[0]?.toString() ?? posResult.toString());
        const debt = BigInt(posResult[1]?.toString() ?? "0");
        const healthBps = BigInt(posResult[2]?.toString() ?? "0");
        const maxBorrow = BigInt(maxBorrowResult?.toString() ?? "0");

        setData({ collateral, debt, healthBps, maxBorrow });
        setLoading(false);
      } catch {
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      }
    }

    fetchPosition();
    return () => { cancelled = true; };
  }, [address, provider]);

  return { position: data, loading };
}

/** Read global CDP stats (totalCollateral, totalDebt, userCount) */
export function useCdpStats() {
  const provider = useMemo(() => new RpcProvider({ nodeUrl: STARKNET_RPC }), []);
  const [data, setData] = useState<{
    totalCollateral: bigint;
    totalDebt: bigint;
    userCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function fetchStats() {
      try {
        const cdp = new Contract({ abi: CDP_ABI as unknown as import("starknet").Abi, address: CDP_ADDRESS, providerOrAccount: provider });
        const [col, debt, count] = await Promise.all([
          cdp.total_collateral(),
          cdp.total_debt(),
          cdp.user_count(),
        ]);

        if (cancelled) return;

        setData({
          totalCollateral: BigInt(col?.toString() ?? "0"),
          totalDebt: BigInt(debt?.toString() ?? "0"),
          userCount: Number(count?.toString() ?? "0"),
        });
        setLoading(false);
      } catch {
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      }
    }

    fetchStats();
    return () => { cancelled = true; };
  }, [provider]);

  return { stats: data, loading };
}

/** CDP actions: depositAndBorrow + repayAndWithdraw with multicall */
export function useCdpActions() {
  const { account, address } = useAccount();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const depositAndBorrow = useCallback(
    async (wbtcAmount: bigint, usdcBorrowAmount: bigint): Promise<string | null> => {
      if (!account || !address) {
        setError("Wallet not connected");
        return null;
      }

      setPending(true);
      setError(null);

      try {
        const wbtcU256 = uint256.bnToUint256(wbtcAmount);
        const usdcU256 = uint256.bnToUint256(usdcBorrowAmount);

        // Multicall: approve WBTC + deposit_and_borrow
        const calls: Call[] = [];

        if (wbtcAmount > BigInt(0)) {
          calls.push({
            contractAddress: TOKENS.WBTC.address,
            entrypoint: "approve",
            calldata: CallData.compile([CDP_ADDRESS, wbtcU256]),
          });
        }

        calls.push({
          contractAddress: CDP_ADDRESS,
          entrypoint: "deposit_and_borrow",
          calldata: CallData.compile([wbtcU256, usdcU256]),
        });

        setStatus("Approving + depositing...");
        const result = await account.execute(calls);
        setStatus("Waiting for confirmation...");

        const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
        await provider.waitForTransaction(result.transaction_hash, { retryInterval: 3000 });

        setPending(false);
        setStatus("");
        return result.transaction_hash;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPending(false);
        setStatus("");
        return null;
      }
    },
    [account, address],
  );

  const repayAndWithdraw = useCallback(
    async (usdcRepayAmount: bigint, wbtcWithdrawAmount: bigint, fullRepay?: boolean): Promise<string | null> => {
      if (!account || !address) {
        setError("Wallet not connected");
        return null;
      }

      setPending(true);
      setError(null);

      try {
        const wbtcU256 = uint256.bnToUint256(wbtcWithdrawAmount);
        const calls: Call[] = [];

        if (fullRepay && usdcRepayAmount > BigInt(0)) {
          // Full repay: bypass CDP contract and repay Nostra directly.
          // Pass uint256.MAX to Nostra's repay() — standard DeFi pattern
          // for "repay all". Nostra determines the exact debt at execution
          // time and pulls only what's needed, avoiding the interest accrual
          // race condition.
          const maxU256 = uint256.bnToUint256(BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));
          // Approve Nostra to pull user's full USDC balance
          const approveU256 = uint256.bnToUint256(usdcRepayAmount);
          calls.push({
            contractAddress: TOKENS.USDC.address,
            entrypoint: "approve",
            calldata: CallData.compile([DUSDC_ADDRESS, approveU256]),
          });
          calls.push({
            contractAddress: DUSDC_ADDRESS,
            entrypoint: "repay",
            calldata: CallData.compile([CDP_ADDRESS, maxU256]),
          });
          // Withdraw collateral through CDP with 0 repay (already repaid above)
          const zeroU256 = uint256.bnToUint256(BigInt(0));
          calls.push({
            contractAddress: CDP_ADDRESS,
            entrypoint: "repay_and_withdraw",
            calldata: CallData.compile([zeroU256, wbtcU256]),
          });
        } else {
          // Normal partial repay through CDP contract
          const usdcU256 = uint256.bnToUint256(usdcRepayAmount);
          if (usdcRepayAmount > BigInt(0)) {
            calls.push({
              contractAddress: TOKENS.USDC.address,
              entrypoint: "approve",
              calldata: CallData.compile([CDP_ADDRESS, usdcU256]),
            });
          }
          calls.push({
            contractAddress: CDP_ADDRESS,
            entrypoint: "repay_and_withdraw",
            calldata: CallData.compile([usdcU256, wbtcU256]),
          });
        }

        setStatus("Approving + repaying...");
        const result = await account.execute(calls);
        setStatus("Waiting for confirmation...");

        const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
        await provider.waitForTransaction(result.transaction_hash, { retryInterval: 3000 });

        setPending(false);
        setStatus("");
        return result.transaction_hash;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPending(false);
        setStatus("");
        return null;
      }
    },
    [account, address],
  );

  const closePosition = useCallback(
    async (usdcApproveAmount: bigint): Promise<string | null> => {
      if (!account || !address) {
        setError("Wallet not connected");
        return null;
      }

      setPending(true);
      setError(null);

      try {
        // Multicall: approve USDC to CDP + close_position
        // close_position reads the exact dUSDC debt atomically and repays it
        const approveU256 = uint256.bnToUint256(usdcApproveAmount);
        const calls: Call[] = [
          {
            contractAddress: TOKENS.USDC.address,
            entrypoint: "approve",
            calldata: CallData.compile([CDP_ADDRESS, approveU256]),
          },
          {
            contractAddress: CDP_ADDRESS,
            entrypoint: "close_position",
            calldata: [],
          },
        ];

        setStatus("Closing position...");
        const result = await account.execute(calls);
        setStatus("Waiting for confirmation...");

        const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });
        await provider.waitForTransaction(result.transaction_hash, { retryInterval: 3000 });

        setPending(false);
        setStatus("");
        return result.transaction_hash;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPending(false);
        setStatus("");
        return null;
      }
    },
    [account, address],
  );

  return { depositAndBorrow, repayAndWithdraw, closePosition, pending, status, error };
}
