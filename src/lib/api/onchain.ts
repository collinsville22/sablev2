const RPC = "https://rpc.starknet.lava.build";

// starknet_keccak("total_assets") & ((1 << 250) - 1)
const TOTAL_ASSETS_SELECTOR = "0x21e1f7868a42adf8781cf7d3a76817ceaaafda5d56b7e7d8f26bc4f27ecdbe2";

/** Calls total_assets() on a vault contract and returns TVL data. */
export async function fetchVaultOnChainTvl(
  vaultAddress: string,
  btcPrice: number,
): Promise<{ totalAssetsSats: number; tvlUsd: number; totalSuppliedBtc: number }> {
  try {
    const resp = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_call",
        params: {
          block_id: "latest",
          request: {
            contract_address: vaultAddress,
            entry_point_selector: TOTAL_ASSETS_SELECTOR,
            calldata: [],
          },
        },
      }),
    });

    const json = await resp.json();
    const result = json.result;
    if (!result || result.length < 2) {
      return { totalAssetsSats: 0, tvlUsd: 0, totalSuppliedBtc: 0 };
    }

    const low = BigInt(result[0]);
    const high = BigInt(result[1]);
    const totalAssetsSats = Number(low + (high << BigInt(128)));
    const totalSuppliedBtc = totalAssetsSats / 1e8;
    const tvlUsd = totalSuppliedBtc * btcPrice;

    return { totalAssetsSats, tvlUsd, totalSuppliedBtc };
  } catch {
    return { totalAssetsSats: 0, tvlUsd: 0, totalSuppliedBtc: 0 };
  }
}
