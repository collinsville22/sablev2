"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import {
  fetchOneClickTokens,
  getOneClickQuote,
  getOneClickStatus,
  submitOneClickDeposit,
  getAvailableChains,
  getChainTokens,
  makeDeadline,
  STRK_ASSET_ID,
  type OneClickToken,
  type ChainInfo,
  type OneClickStatusValue,
  getChainPlaceholderAddress,
} from "@/lib/api/oneclick";
import { TOKENS } from "@/lib/constants";

export type BridgeDirection = "in" | "out";

export type BridgeStep =
  | "idle"           // form input
  | "quoting"        // fetching quote
  | "quoted"         // quote ready, awaiting user action
  | "getting-deposit-addr"  // getting non-dry 1Click quote
  | "awaiting-deposit"      // deposit address shown, waiting for user to send
  | "awaiting-1click"       // polling 1Click (deposit detected, processing)
  | "awaiting-transfer"     // user signing STRK transfer
  | "transfer-pending"      // transfer TX submitted
  | "notifying-1click"      // submitting deposit notification
  | "awaiting-1click-out"   // polling 1Click outbound
  | "complete"
  | "error";

export interface CombinedQuote {
  inputAmount: string;
  inputSymbol: string;
  inputUsd: number;
  outputAmount: string;
  outputSymbol: string;
  outputUsd: number;
  timeEstimate: number;       // seconds
  oneClickAmountOut: string;  // raw smallest units
}

export interface BridgeState {
  direction: BridgeDirection;
  step: BridgeStep;
  sourceChain: string | null;
  sourceToken: OneClickToken | null;
  destChain: string | null;
  destToken: OneClickToken | null;
  amount: string;
  destAddress: string;
  refundAddress: string; // source chain address for refunds (bridge IN)
  quote: CombinedQuote | null;
  quoteLoading: boolean;
  depositAddress: string | null;
  starknetTxHash: string | null;
  oneClickStatus: OneClickStatusValue | null;
  error: string | null;
}

const INITIAL_STATE: BridgeState = {
  direction: "in",
  step: "idle",
  sourceChain: null,
  sourceToken: null,
  destChain: null,
  destToken: null,
  amount: "",
  destAddress: "",
  refundAddress: "",
  quote: null,
  quoteLoading: false,
  depositAddress: null,
  starknetTxHash: null,
  oneClickStatus: null,
  error: null,
};

const SESSION_KEY = "sable_bridge";
const QUOTE_DEBOUNCE_MS = 800;
const STATUS_POLL_MS = 5000;

const STRK_ADDRESS = TOKENS.STRK.address;

export function useBridge() {
  const { address, isConnected } = useAccount();
  const { sendAsync } = useSendTransaction({});

  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);

  const [state, setState] = useState<BridgeState>(INITIAL_STATE);
  const cancelRef = useRef(false);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const chains = useMemo(() => getAvailableChains(tokens), [tokens]);
  const sourceTokens = useMemo(
    () => (state.sourceChain ? getChainTokens(tokens, state.sourceChain) : []),
    [tokens, state.sourceChain],
  );
  const destTokens = useMemo(
    () => (state.destChain ? getChainTokens(tokens, state.destChain) : []),
    [tokens, state.destChain],
  );

  useEffect(() => {
    fetchOneClickTokens()
      .then(setTokens)
      .catch(() => {})
      .finally(() => setTokensLoading(false));
  }, []);

  useEffect(() => {
    if (state.direction === "in" && address && !state.destAddress) {
      setState((s) => ({ ...s, destAddress: address }));
    }
  }, [state.direction, address, state.destAddress]);

  useEffect(() => {
    if (state.step !== "idle" && state.step !== "complete" && state.step !== "error") {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          direction: state.direction,
          step: state.step,
          depositAddress: state.depositAddress,
          amount: state.amount,
          destAddress: state.destAddress,
        }));
      } catch { /* ignore */ }
    }
  }, [state.step, state.direction, state.depositAddress, state.amount, state.destAddress]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const addressRef = useRef(address);
  addressRef.current = address;
  const quoteIdRef = useRef(0);

  const fetchQuote = useCallback(async () => {
    const s = stateRef.current;
    const addr = addressRef.current;
    const { direction, sourceToken, destToken, amount } = s;
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) return;

    if (direction === "in" && !sourceToken) return;
    if (direction === "out" && (!destToken || !s.destAddress.trim())) return;

    const thisQuoteId = ++quoteIdRef.current;
    setState((prev) => ({ ...prev, quoteLoading: true, error: null }));

    try {
      let quote: CombinedQuote;

      if (direction === "in" && sourceToken) {
        const amountSmallest = BigInt(Math.floor(numAmount * 10 ** sourceToken.decimals)).toString();
        const sourceChain = sourceToken.blockchain.toLowerCase();
        const refundAddr = s.refundAddress.replace(/[^\x20-\x7E]/g, "").trim();
        const refundTo = refundAddr || getChainPlaceholderAddress(sourceChain);

        const res = await getOneClickQuote({
          dry: true,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          originAsset: sourceToken.assetId,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: STRK_ASSET_ID,
          amount: amountSmallest,
          refundTo,
          refundType: "ORIGIN_CHAIN",
          recipient: addr || "0x0000000000000000000000000000000000000001",
          recipientType: "DESTINATION_CHAIN",
          deadline: makeDeadline(),
        });

        if (quoteIdRef.current !== thisQuoteId) return;

        const strkOut = BigInt(res.quote.amountOut);
        quote = {
          inputAmount: amount,
          inputSymbol: sourceToken.symbol,
          inputUsd: parseFloat(res.quote.amountInUsd),
          outputAmount: (Number(strkOut) / 1e18).toFixed(2),
          outputSymbol: "STRK",
          outputUsd: parseFloat(res.quote.amountOutUsd),
          timeEstimate: res.quote.timeEstimate,
          oneClickAmountOut: res.quote.amountOut,
        };
      } else if (direction === "out" && destToken) {
        const strkSmallest = BigInt(Math.floor(numAmount * 1e18)).toString();

        const res = await getOneClickQuote({
          dry: true,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          originAsset: STRK_ASSET_ID,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: destToken.assetId,
          amount: strkSmallest,
          refundTo: addr || "0x0000000000000000000000000000000000000001",
          refundType: "ORIGIN_CHAIN",
          recipient: s.destAddress.replace(/[^\x20-\x7E]/g, "").trim(),
          recipientType: "DESTINATION_CHAIN",
          deadline: makeDeadline(),
        });

        if (quoteIdRef.current !== thisQuoteId) return;

        const destOut = BigInt(res.quote.amountOut);
        quote = {
          inputAmount: amount,
          inputSymbol: "STRK",
          inputUsd: parseFloat(res.quote.amountInUsd),
          outputAmount: (Number(destOut) / 10 ** destToken.decimals).toFixed(
            Math.min(destToken.decimals, 8),
          ),
          outputSymbol: destToken.symbol,
          outputUsd: parseFloat(res.quote.amountOutUsd),
          timeEstimate: res.quote.timeEstimate,
          oneClickAmountOut: res.quote.amountOut,
        };
      } else {
        return;
      }

      if (quoteIdRef.current === thisQuoteId && !cancelRef.current) {
        setState((prev) => ({ ...prev, quote, quoteLoading: false, step: "quoted" }));
      }
    } catch (e) {
      if (quoteIdRef.current === thisQuoteId && !cancelRef.current) {
        const msg = e instanceof Error ? e.message : "Quote failed";
        const s = stateRef.current;
        const isRefundError = msg.toLowerCase().includes("refund address") || msg.toLowerCase().includes("refundto");
        const noUserAddr = s.direction === "in" && !s.refundAddress.trim();
        if (isRefundError && noUserAddr) {
          setState((prev) => ({ ...prev, quoteLoading: false, step: "idle" }));
        } else {
          setState((prev) => ({
            ...prev,
            quoteLoading: false,
            error: msg,
            step: "idle",
          }));
        }
      }
    }
  }, []);

  useEffect(() => {
    const numAmount = parseFloat(state.amount);
    if (!numAmount || numAmount <= 0) {
      setState((s) => ({ ...s, quote: null, step: "idle" }));
      return;
    }
    if (state.direction === "in" && !state.sourceToken) return;
    if (state.direction === "out" && (!state.destToken || !state.destAddress.trim())) return;

    setState((s) => ({ ...s, step: "quoting" }));
    clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);

    return () => clearTimeout(quoteTimer.current);
  }, [state.amount, state.sourceToken, state.destToken, state.direction, state.destAddress, state.refundAddress, fetchQuote]);

  const startPolling = useCallback((depositAddr: string) => {
    clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await getOneClickStatus(depositAddr);
        setState((s) => {
          if (s.depositAddress !== depositAddr) return s;
          const newState = { ...s, oneClickStatus: res.status };

          if (res.status === "COMPLETED" || res.status === "SUCCESS") {
            clearInterval(pollTimer.current);
            return { ...newState, step: "complete" };
          }
          if (res.status === "FAILED" || res.status === "REFUNDED") {
            clearInterval(pollTimer.current);
            return { ...newState, step: "error", error: `Bridge ${res.status.toLowerCase()}` };
          }
          if (res.status === "KNOWN_DEPOSIT_TX" || res.status === "PROCESSING") {
            const newStep = s.direction === "in" ? "awaiting-1click" : "awaiting-1click-out";
            return { ...newState, step: newStep };
          }
          return newState;
        });
      } catch { /* retry next interval */ }
    }, STATUS_POLL_MS);
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(pollTimer.current);
      cancelRef.current = true;
    };
  }, []);

  const setDirection = useCallback((dir: BridgeDirection) => {
    setState({
      ...INITIAL_STATE,
      direction: dir,
      destAddress: dir === "in" && address ? address : "",
    });
  }, [address]);

  const setSourceChain = useCallback((chain: string) => {
    setState((s) => ({ ...s, sourceChain: chain, sourceToken: null, quote: null, step: "idle" }));
  }, []);

  const setSourceToken = useCallback((token: OneClickToken) => {
    setState((s) => ({ ...s, sourceToken: token, quote: null, step: "idle" }));
  }, []);

  const setDestChain = useCallback((chain: string) => {
    setState((s) => ({ ...s, destChain: chain, destToken: null, quote: null, step: "idle" }));
  }, []);

  const setDestToken = useCallback((token: OneClickToken) => {
    setState((s) => ({ ...s, destToken: token, quote: null, step: "idle" }));
  }, []);

  const setAmount = useCallback((amount: string) => {
    setState((s) => ({ ...s, amount }));
  }, []);

  const setDestAddress = useCallback((addr: string) => {
    setState((s) => ({ ...s, destAddress: addr }));
  }, []);

  const setRefundAddress = useCallback((addr: string) => {
    setState((s) => ({ ...s, refundAddress: addr }));
  }, []);

  const startBridgeIn = useCallback(async () => {
    if (!state.sourceToken || !address || !state.quote || !state.refundAddress.trim()) return;

    setState((s) => ({ ...s, step: "getting-deposit-addr", error: null }));

    try {
      const numAmount = parseFloat(state.amount);
      const amountSmallest = BigInt(Math.floor(numAmount * 10 ** state.sourceToken.decimals)).toString();
      const refundTo = state.refundAddress.replace(/[^\x20-\x7E]/g, "").trim();

      const res = await getOneClickQuote({
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: state.sourceToken.assetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: STRK_ASSET_ID,
        amount: amountSmallest,
        refundTo,
        refundType: "ORIGIN_CHAIN",
        recipient: address,
        recipientType: "DESTINATION_CHAIN",
        deadline: makeDeadline(),
      });

      if (!res.depositAddress) throw new Error("Bridge service unavailable. Try again.");

      setState((s) => ({
        ...s,
        depositAddress: res.depositAddress!,
        step: "awaiting-deposit",
      }));

      startPolling(res.depositAddress!);
    } catch (e) {
      setState((s) => ({
        ...s,
        step: "error",
        error: e instanceof Error ? e.message : "Failed to start bridge",
      }));
    }
  }, [state.sourceToken, state.amount, state.quote, state.refundAddress, address, startPolling]);

  const startBridgeOut = useCallback(async () => {
    if (!state.destToken || !address || !state.quote) return;

    setState((s) => ({ ...s, step: "awaiting-transfer", error: null }));

    let depositAddr: string | null = null;

    try {
      const numAmount = parseFloat(state.amount);
      const strkSmallest = BigInt(Math.floor(numAmount * 1e18));

      const quoteParams = {
        dry: false as const,
        swapType: "EXACT_INPUT" as const,
        slippageTolerance: 100,
        originAsset: STRK_ASSET_ID,
        depositType: "ORIGIN_CHAIN" as const,
        destinationAsset: state.destToken.assetId,
        amount: strkSmallest.toString(),
        refundTo: address,
        refundType: "ORIGIN_CHAIN" as const,
        recipient: state.destAddress.replace(/[^\x20-\x7E]/g, "").trim(),
        recipientType: "DESTINATION_CHAIN" as const,
        deadline: makeDeadline(),
      };

      let oneClickRes;
      try {
        oneClickRes = await getOneClickQuote(quoteParams);
      } catch (e) {
        // Retry once on timeout
        if (e instanceof Error && /timed? ?out|timeout/i.test(e.message)) {
          quoteParams.deadline = makeDeadline();
          oneClickRes = await getOneClickQuote(quoteParams);
        } else {
          throw e;
        }
      }

      if (!oneClickRes.depositAddress) throw new Error("Bridge service unavailable. Try again.");
      depositAddr = oneClickRes.depositAddress;

      const strkLow = strkSmallest & ((BigInt(1) << BigInt(128)) - BigInt(1));
      const strkHigh = strkSmallest >> BigInt(128);

      setState((s) => ({ ...s, depositAddress: depositAddr }));

      const result = await sendAsync([{
        contractAddress: STRK_ADDRESS,
        entrypoint: "transfer",
        calldata: [depositAddr!, strkLow.toString(), strkHigh.toString()],
      }]);

      setState((s) => ({
        ...s,
        starknetTxHash: result.transaction_hash,
        step: "notifying-1click",
      }));

      await submitOneClickDeposit(depositAddr, result.transaction_hash);

      setState((s) => ({ ...s, step: "awaiting-1click-out" }));

      startPolling(depositAddr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isUserReject = msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("cancel");

      if (!depositAddr) {
        // Error BEFORE deposit address obtained — safe to go back to form
        if (isUserReject || /timed? ?out|timeout/i.test(msg)) {
          setState((s) => ({ ...s, step: "quoted", error: "Bridge quote timed out. Please try again." }));
        } else {
          setState((s) => ({ ...s, step: "error", error: msg }));
        }
      } else if (isUserReject) {
        // User rejected wallet popup — safe to go back
        setState((s) => ({ ...s, step: "quoted", error: "Transaction rejected" }));
      } else {
        // Error AFTER deposit address obtained (wallet timeout, network error, etc.)
        // Do NOT go back to form — the wallet popup might still be active
        // Start polling the deposit address in case user confirms wallet anyway
        startPolling(depositAddr);
        setState((s) => ({
          ...s,
          step: "awaiting-1click-out",
          error: null,
        }));
      }
    }
  }, [state.destToken, state.destAddress, state.amount, state.quote, address, sendAsync, startPolling]);

  const reset = useCallback(() => {
    clearInterval(pollTimer.current);
    cancelRef.current = false;
    setState({
      ...INITIAL_STATE,
      direction: state.direction,
      destAddress: state.direction === "in" && address ? address : "",
    });
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, [state.direction, address]);

  return {
    state,
    tokens,
    tokensLoading,
    chains,
    sourceTokens,
    destTokens,
    setDirection,
    setSourceChain,
    setSourceToken,
    setDestChain,
    setDestToken,
    setAmount,
    setDestAddress,
    setRefundAddress,
    startBridgeIn,
    startBridgeOut,
    reset,
  };
}
