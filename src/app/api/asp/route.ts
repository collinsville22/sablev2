import { NextResponse } from "next/server";
import { RpcProvider } from "starknet";

const RPC_URL = process.env.NEXT_PUBLIC_STARKNET_RPC || "https://rpc.starknet.lava.build";
const POOL_ADDRESS = "0x0a8b17a3dab4f3721457c53f0c77a50feffed4c3439d786a9e6931787727343";
const NEW_COMMITMENT_SELECTOR = "0x22e3e55b690d7d609fdd9acbb8a48098de7fa7874cf95d975b1264b0c24d161";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    if (searchParams.get("root") === "true") {
      const provider = new RpcProvider({ nodeUrl: RPC_URL });
      const result = await provider.callContract({
        contractAddress: POOL_ADDRESS,
        entrypoint: "get_last_root",
        calldata: [],
      });
      const rootLow = BigInt(result[0]);
      const rootHigh = BigInt(result[1]);
      const root = "0x" + ((rootHigh << BigInt(128)) + rootLow).toString(16);
      return NextResponse.json({ root });
    }

    const commitments: string[] = [];
    let continuationToken: string | undefined;

    do {
      const body = {
        jsonrpc: "2.0",
        method: "starknet_getEvents",
        params: {
          filter: {
            address: POOL_ADDRESS,
            keys: [[NEW_COMMITMENT_SELECTOR]],
            from_block: { block_number: 0 },
            to_block: "latest",
            chunk_size: 100,
            ...(continuationToken ? { continuation_token: continuationToken } : {}),
          },
        },
        id: 1,
      };

      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      const result = json.result || {};

      for (const evt of result.events || []) {
        const low = BigInt(evt.keys[1] || "0");
        const high = BigInt(evt.keys[2] || "0");
        commitments.push("0x" + ((high << BigInt(128)) + low).toString(16));
      }

      continuationToken = result.continuation_token;
    } while (continuationToken);

    return NextResponse.json({ commitments, mode: "permissive" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
