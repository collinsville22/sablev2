import { NextResponse } from "next/server";
import { Account, RpcProvider, CallData } from "starknet";

const CURATOR_PRIVATE_KEY = process.env.CURATOR_PRIVATE_KEY || "";
const CURATOR_ADDRESS = process.env.CURATOR_ADDRESS || "";
const RPC_URL = process.env.STARKNET_RPC || "https://rpc.starknet.lava.build";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      poolAddress,
      calldata,
      depositor,
      recipient,
      relayer,
      fee,
      extAmount,
      extDataHash,
      encryptedOutput0,
      encryptedOutput1,
      ephemeralPubkey0,
      ephemeralPubkey1,
    } = body;

    if (!poolAddress || !calldata) {
      return NextResponse.json({ error: "Missing poolAddress or calldata" }, { status: 400 });
    }

    const provider = new RpcProvider({ nodeUrl: RPC_URL });
    const curator = new Account({ provider, address: CURATOR_ADDRESS, signer: CURATOR_PRIVATE_KEY });

    const toU256 = (val: string) => {
      const n = BigInt(val || "0");
      const mask128 = (BigInt(1) << BigInt(128)) - BigInt(1);
      return { low: (n & mask128).toString(), high: (n >> BigInt(128)).toString() };
    };

    const call = {
      contractAddress: poolAddress,
      entrypoint: "transact",
      calldata: CallData.compile({
        proof_with_hints: calldata,
        depositor: depositor || "0x0",
        recipient: recipient || "0x0",
        relayer: relayer || CURATOR_ADDRESS,
        fee: toU256(fee),
        ext_amount: toU256(extAmount),
        ext_data_hash: toU256(extDataHash),
        encrypted_output_0: encryptedOutput0 || [],
        encrypted_output_1: encryptedOutput1 || [],
        ephemeral_pubkey_0: toU256(ephemeralPubkey0),
        ephemeral_pubkey_1: toU256(ephemeralPubkey1),
      }),
    };

    const tx = await curator.execute([call], {
      resourceBounds: {
        l2_gas: {
          max_amount: BigInt("0x47868C00"),
          max_price_per_unit: BigInt("0x3B9ACA00"),
        },
        l1_gas: {
          max_amount: BigInt(0),
          max_price_per_unit: BigInt(0),
        },
        l1_data_gas: {
          max_amount: BigInt("0x5000"),
          max_price_per_unit: BigInt("0x174876E800"),
        },
      },
    });

    const receipt = await provider.waitForTransaction(tx.transaction_hash, {
      retryInterval: 3000,
    });

    return NextResponse.json({
      transaction_hash: tx.transaction_hash,
      execution_status: (receipt as Record<string, unknown>).execution_status || "UNKNOWN",
      revert_reason: (receipt as Record<string, unknown>).revert_reason || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Relayer transact error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
