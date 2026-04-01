"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount } from "@starknet-react/core";
import {
  type Keypair,
  deriveKeypair,
  saveKeypair,
  loadKeypair,
} from "@/lib/privacy/keypair";

export function useKeypair() {
  const { address, account } = useAccount();
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (address) {
      const cached = loadKeypair();
      if (cached) setKeypair(cached);
    }
  }, [address]);

  const derive = useCallback(async () => {
    if (!address || !account) {
      setError("Connect wallet first");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const typedData = {
        types: {
          StarkNetDomain: [
            { name: "name", type: "felt" },
            { name: "version", type: "felt" },
          ],
          Message: [
            { name: "action", type: "felt" },
          ],
        },
        primaryType: "Message" as const,
        domain: { name: "Sable V2", version: "1" },
        message: { action: "sable-v2-derive-keys" },
      };

      const signature = await account.signMessage(typedData);
      const sigArray = Array.isArray(signature) ? signature : [String(signature), "0x1"];
      const r = sigArray[0] || "0x1";
      const s = sigArray[1] || "0x2";

      const kp = await deriveKeypair(r, s);
      saveKeypair(kp);
      setKeypair(kp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to derive keypair");
    } finally {
      setIsLoading(false);
    }
  }, [address, account]);

  return {
    keypair,
    isReady: !!keypair,
    isLoading,
    error,
    deriveKeypair: derive,
  };
}
