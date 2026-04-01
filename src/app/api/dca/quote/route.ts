import { NextResponse } from "next/server";
import { getAvnuQuote } from "@/lib/api/avnu";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sellToken = searchParams.get("sell");
    const buyToken = searchParams.get("buy");
    const amountStr = searchParams.get("amount");

    if (!sellToken || !buyToken || !amountStr) {
      return NextResponse.json({ error: "Missing sell, buy, or amount parameter" }, { status: 400 });
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const DECIMALS: Record<string, number> = {
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7": 18, // ETH
      "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8": 6,  // USDC
      "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8": 6,  // USDT
      "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d": 18, // STRK
      "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac": 8,  // WBTC
    };

    const decimals = DECIMALS[sellToken.toLowerCase()] ?? DECIMALS[sellToken] ?? 18;
    const sellAmountRaw = BigInt(Math.floor(amount * 10 ** decimals));

    const quote = await getAvnuQuote(sellToken, buyToken, sellAmountRaw);

    return NextResponse.json({
      buyAmount: (parseInt(quote.buyAmount, 16) / 1e8).toFixed(8),
      buyAmountUsd: quote.buyAmountInUsd,
      sellAmountUsd: quote.sellAmountInUsd,
      priceImpact: quote.priceImpact,
      gasFeeUsd: quote.gasFeesInUsd,
      route: quote.routes.map((r) => r.name).join(" → ") || "AVNU",
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
