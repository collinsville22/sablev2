import { NextResponse } from "next/server";
import { RpcProvider, Contract } from "starknet";

interface BlockGasPrices {
  l1_gas_price?: { price_in_fri?: string };
  l1_data_gas_price?: { price_in_fri?: string };
  l2_gas_price?: { price_in_fri?: string };
}

const RPC_URL = process.env.STARKNET_RPC!;

const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const WBTC_ADDRESS = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac";

// Estimated L2 gas for each operation (measured from mainnet txs)
const GAS_ESTIMATES = {
  deposit: BigInt(800_000),        // Merkle insert + transferFrom
  deploy_batch: BigInt(1_200_000), // Vault deposit + share accounting
  withdraw: BigInt(35_000_000),    // Groth16 verification + vault redeem
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const poolAddress = searchParams.get("pool");

    const provider = new RpcProvider({ nodeUrl: RPC_URL });

    const block = await provider.getBlock("latest");
    const gasPrices = block as unknown as BlockGasPrices;
    const l2Price = BigInt(gasPrices.l2_gas_price?.price_in_fri ?? "0x2000000000");
    const l1DataPrice = BigInt(gasPrices.l1_data_gas_price?.price_in_fri ?? "0x800000000000");

    // deposit: L2 gas + L1 data gas
    // deploy_batch: amortized by batch_size (3), so cost / 3
    // withdraw: L2 gas + L1 data gas (most expensive — Groth16 verify)
    const BATCH_SIZE = BigInt(3);
    const L1_DATA_PER_TX = BigInt(5000); // Estimated L1 data gas per tx

    const depositGasCost = GAS_ESTIMATES.deposit * l2Price + L1_DATA_PER_TX * l1DataPrice;
    const deployBatchGasCost = (GAS_ESTIMATES.deploy_batch * l2Price + L1_DATA_PER_TX * l1DataPrice) / BATCH_SIZE;
    const withdrawGasCost = GAS_ESTIMATES.withdraw * l2Price + L1_DATA_PER_TX * l1DataPrice;

    const totalStrkCost = depositGasCost + deployBatchGasCost + withdrawGasCost;

    // totalStrkCost is in fri (1 STRK = 10^18 fri)
    const totalStrk = Number(totalStrkCost) / 1e18;

    let strkUsd = 0.4;
    let btcUsd = 100000;
    try {
      const priceRes = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=starknet,bitcoin&vs_currencies=usd",
        { signal: AbortSignal.timeout(3000) }
      );
      if (priceRes.ok) {
        const prices = await priceRes.json();
        if (prices.starknet?.usd) strkUsd = prices.starknet.usd;
        if (prices.bitcoin?.usd) btcUsd = prices.bitcoin.usd;
      }
    } catch {}

    const costUsd = totalStrk * strkUsd;
    const costBtc = costUsd / btcUsd;
    const costSats = Math.ceil(costBtc * 1e8);

    // Add 20% margin for relayer profitability
    const feeSats = Math.max(Math.ceil(costSats * 1.2), 1);

    let maxFeeSats: number | null = null;
    let denomination: number | null = null;
    if (poolAddress) {
      try {
        const poolContract = new Contract({
          abi: [
            { type: "function", name: "max_fee", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
            { type: "function", name: "denomination", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
          ] as unknown as import("starknet").Abi,
          address: poolAddress,
          providerOrAccount: provider,
        });
        const [maxFeeResult, denomResult] = await Promise.all([
          poolContract.call("max_fee").catch(() => null),
          poolContract.call("denomination").catch(() => null),
        ]);
        if (maxFeeResult) maxFeeSats = Number(BigInt(maxFeeResult.toString()));
        if (denomResult) denomination = Number(BigInt(denomResult.toString()));
      } catch {}
    }

    // Cap fee at contract max if available
    const finalFee = maxFeeSats !== null ? Math.min(feeSats, maxFeeSats) : feeSats;

    return NextResponse.json({
      feeSats: finalFee,
      feeBreakdown: {
        depositGasStrk: Number(depositGasCost) / 1e18,
        deployBatchGasStrk: Number(deployBatchGasCost) / 1e18,
        withdrawGasStrk: Number(withdrawGasCost) / 1e18,
        totalGasStrk: totalStrk,
        totalGasUsd: costUsd,
        marginPercent: 20,
      },
      gasPrices: {
        l2GasPriceFri: l2Price.toString(),
        l1DataGasPriceFri: l1DataPrice.toString(),
      },
      prices: {
        strkUsd,
        btcUsd,
      },
      maxFeeSats,
      denomination,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
