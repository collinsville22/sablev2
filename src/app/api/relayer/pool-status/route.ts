import { NextResponse } from "next/server";
import { RpcProvider, Contract } from "starknet";

function isValidStarknetAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(addr);
}

const RPC_URL = process.env.STARKNET_RPC!;

// V4 pool ABI — no batch_size or pending_deposits (variable batches)
const POOL_STATUS_ABI = [
  { type: "function", name: "denomination", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "undeployed_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "active_deposits", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "total_deposits", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "total_assets", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "max_fee_bps", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "max_fee", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_next_index", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
] as unknown as import("starknet").Abi;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const poolAddress = searchParams.get("pool");

    if (!poolAddress) {
      return NextResponse.json({ error: "Missing pool parameter" }, { status: 400 });
    }

    if (!isValidStarknetAddress(poolAddress)) {
      return NextResponse.json({ error: "Invalid pool address" }, { status: 400 });
    }

    const provider = new RpcProvider({ nodeUrl: RPC_URL });
    const pool = new Contract({
      abi: POOL_STATUS_ABI,
      address: poolAddress,
      providerOrAccount: provider,
    });

    const [
      denomination,
      undeployedCount,
      activeDeposits,
      totalDeposits,
      totalAssets,
      maxFeeBps,
      maxFee,
      nextIndex,
    ] = await Promise.all([
      pool.call("denomination").catch(() => "0"),
      pool.call("undeployed_count").catch(() => "0"),
      pool.call("active_deposits").catch(() => "0"),
      pool.call("total_deposits").catch(() => "0"),
      pool.call("total_assets").catch(() => "0"),
      pool.call("max_fee_bps").catch(() => "500"),
      pool.call("max_fee").catch(() => "0"),
      pool.call("get_next_index").catch(() => "0"),
    ]);

    return NextResponse.json({
      denomination: BigInt(denomination.toString()).toString(),
      undeployedCount: Number(undeployedCount.toString()),
      activeDeposits: Number(activeDeposits.toString()),
      totalDeposits: Number(totalDeposits.toString()),
      totalAssets: BigInt(totalAssets.toString()).toString(),
      maxFeeBps: Number(maxFeeBps.toString()),
      maxFee: BigInt(maxFee.toString()).toString(),
      nextIndex: Number(nextIndex.toString()),
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
