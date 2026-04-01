import { NextResponse } from "next/server";
import { RpcProvider, Account, outsideExecution } from "starknet";

interface BlockGasPrices {
  l1_gas_price?: { price_in_fri?: string };
  l1_data_gas_price?: { price_in_fri?: string };
  l2_gas_price?: { price_in_fri?: string };
}

interface TransactionReceipt {
  execution_status?: string;
  revert_reason?: string;
  events?: Array<{ from_address?: string; keys?: string[]; data?: string[] }>;
}

const RPC_URL = process.env.STARKNET_RPC!;
const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY!;
const CURATOR_ADDR = process.env.CURATOR_ADDRESS!;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { signerAddress, signature, outsideExecution: oe } = body;

    if (!signerAddress || !signature || !oe?.calls?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const provider = new RpcProvider({ nodeUrl: RPC_URL });
    const curator = new Account({ provider, address: CURATOR_ADDR, signer: CURATOR_KEY });

    const outsideTx = {
      signerAddress,
      version: "2" as const,
      outsideExecution: oe,
      signature,
    };

    const executeCalls = outsideExecution.buildExecuteFromOutsideCall(outsideTx);

    const block = await provider.getBlock("latest");
    const gasPrices = block as unknown as BlockGasPrices;
    const l1Price = BigInt(gasPrices.l1_gas_price?.price_in_fri ?? "0x800000000000");
    const l1DataPrice = BigInt(gasPrices.l1_data_gas_price?.price_in_fri ?? "0x800000000000");
    const l2Price = BigInt(gasPrices.l2_gas_price?.price_in_fri ?? "0x2000000000");

    const result = await curator.execute(executeCalls, {
      resourceBounds: {
        l2_gas: { max_amount: BigInt("0x47868C00"), max_price_per_unit: l2Price * BigInt(3) },
        l1_gas: { max_amount: BigInt("0x100"), max_price_per_unit: l1Price * BigInt(3) },
        l1_data_gas: { max_amount: BigInt("0x5000"), max_price_per_unit: l1DataPrice * BigInt(3) },
      },
    });

    const receipt = await provider.waitForTransaction(result.transaction_hash, {
      retryInterval: 3000,
    });

    const typedReceipt = receipt as unknown as TransactionReceipt;

    return NextResponse.json({
      transaction_hash: result.transaction_hash,
      execution_status: typedReceipt.execution_status ?? "UNKNOWN",
      revert_reason: typedReceipt.revert_reason || null,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
