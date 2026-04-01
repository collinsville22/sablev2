/** Centralized Starknet RPC URL for all client-side hooks.
 *  Reads from NEXT_PUBLIC_STARKNET_RPC env var, falls back to Lava (free, CORS-friendly). */
export const STARKNET_RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC || "https://rpc.starknet.lava.build";
