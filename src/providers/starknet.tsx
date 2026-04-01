"use client";

import { type ReactNode } from "react";
import { mainnet } from "@starknet-react/chains";
import { StarknetConfig, jsonRpcProvider, argent, braavos } from "@starknet-react/core";
import { STARKNET_RPC } from "@/lib/rpc";

const chains = [mainnet];
const connectors = [argent(), braavos()];
const provider = jsonRpcProvider({ rpc: () => ({ nodeUrl: STARKNET_RPC }) });

export function StarknetProvider({ children }: { children: ReactNode }) {
  return (
    <StarknetConfig
      chains={chains}
      provider={provider}
      connectors={connectors}
      autoConnect
    >
      {children}
    </StarknetConfig>
  );
}
