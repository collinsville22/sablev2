import { NextRequest, NextResponse } from "next/server";
import { RpcProvider, Account, CallData, uint256 } from "starknet";
import { SABLE_CONTRACTS, TOKENS } from "@/lib/constants";

const RPC_URL = process.env.STARKNET_RPC!;
const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY!;
const CURATOR_ADDR = process.env.CURATOR_ADDRESS!;

const VAULT_MAP: Record<string, string> = {
  sentinel: SABLE_CONTRACTS.SENTINEL,
  citadel: SABLE_CONTRACTS.CITADEL,
  trident: SABLE_CONTRACTS.TRIDENT,
  delta_neutral: SABLE_CONTRACTS.DELTA_NEUTRAL,
  turbo: SABLE_CONTRACTS.TURBO,
  apex: SABLE_CONTRACTS.APEX,
};

export async function POST(req: NextRequest) {
  try {
    const { vaultId } = await req.json();
    const vaultAddr = VAULT_MAP[vaultId];
    if (!vaultAddr) {
      return NextResponse.json({ error: "Unknown vault" }, { status: 400 });
    }

    const provider = new RpcProvider({ nodeUrl: RPC_URL });
    const account = new Account({
      provider,
      address: CURATOR_ADDR,
      signer: CURATOR_KEY,
      cairoVersion: "1",
    });

    const balResult = await provider.callContract({
      contractAddress: TOKENS.WBTC.address,
      entrypoint: "balanceOf",
      calldata: [vaultAddr],
    });
    const idle = BigInt(balResult[0]);

    if (idle === BigInt(0)) {
      return NextResponse.json({ status: "no_idle_funds" });
    }

    const u = uint256.bnToUint256(idle);
    let calls;

    switch (vaultId) {
      case "sentinel":
        calls = [{
          contractAddress: vaultAddr,
          entrypoint: "deploy_to_vesu",
          calldata: CallData.compile([u]),
        }];
        break;

      case "citadel":
        calls = [{
          contractAddress: vaultAddr,
          entrypoint: "stake_to_endur",
          calldata: CallData.compile([u]),
        }];
        break;

      case "trident":
        calls = [{
          contractAddress: vaultAddr,
          entrypoint: "execute_staking_loop",
          calldata: CallData.compile([u, 3]),
        }];
        break;

      case "delta_neutral":
        calls = [{
          contractAddress: vaultAddr,
          entrypoint: "deploy_collateral",
          calldata: CallData.compile([u]),
        }];
        break;

      case "turbo":
        calls = [{
          contractAddress: vaultAddr,
          entrypoint: "deploy_to_vesu",
          calldata: CallData.compile([u]),
        }];
        break;

      case "apex":
        calls = [{
          contractAddress: vaultAddr,
          entrypoint: "deploy_split",
          calldata: CallData.compile([u]),
        }];
        break;

      default:
        return NextResponse.json({ error: "No strategy" }, { status: 400 });
    }

    const result = await account.execute(calls);
    await provider.waitForTransaction(result.transaction_hash);

    return NextResponse.json({
      status: "deployed",
      tx: result.transaction_hash,
      amount: idle.toString(),
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
