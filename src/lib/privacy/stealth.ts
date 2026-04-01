import { RpcProvider } from "starknet";
import { STARKNET_RPC } from "@/lib/rpc";

const STEALTH_REGISTRY_ABI = [
  {
    type: "function",
    name: "get_keys",
    inputs: [{ name: "user", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "(core::integer::u256, core::integer::u256)" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "is_registered",
    inputs: [{ name: "user", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::bool" }],
    state_mutability: "view",
  },
] as const;

export async function lookupStealthKeys(
  registryAddress: string,
  userAddress: string
): Promise<{ spendingPubkey: string; viewingPubkey: string } | null> {
  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC });

  try {
    const isRegistered = await provider.callContract({
      contractAddress: registryAddress,
      entrypoint: "is_registered",
      calldata: [userAddress],
    });
    if (isRegistered[0] === "0x0") return null;

    const keys = await provider.callContract({
      contractAddress: registryAddress,
      entrypoint: "get_keys",
      calldata: [userAddress],
    });
    return {
      spendingPubkey: "0x" + BigInt(keys[0]).toString(16),
      viewingPubkey: "0x" + BigInt(keys[2]).toString(16),
    };
  } catch {
    return null;
  }
}

export const KEYPAIR_DERIVATION_MESSAGE = {
  types: {
    StarkNetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
    Message: [
      { name: "action", type: "felt" },
    ],
  },
  primaryType: "Message" as const,
  domain: {
    name: "Sable V2",
    version: "1",
    chainId: "0x534e5f4d41494e",
  },
  message: {
    action: "sable-v2-derive-keys",
  },
};
