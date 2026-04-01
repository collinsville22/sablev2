"use client";

import { useState } from "react";
import { useAccount } from "@starknet-react/core";
import { useKeypair } from "@/hooks/use-keypair";
import { useShieldedPoolV5 } from "@/hooks/use-shielded-pool-v5";
import { formatTokenAmount } from "@/lib/format";

const POOL_ADDRESS = "0x0a8b17a3dab4f3721457c53f0c77a50feffed4c3439d786a9e6931787727343";
const WBTC_ADDRESS = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac";

type Tab = "deposit" | "transfer" | "withdraw";

export default function PrivacyPage() {
  const { address, isConnected } = useAccount();
  const { keypair, isReady, isLoading: keypairLoading, deriveKeypair } = useKeypair();
  const { notes, balance, status, deposit, withdraw, resetStatus } = useShieldedPoolV5(
    POOL_ADDRESS,
    keypair
  );
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Sable V2 Privacy Pool</h1>
        <p className="text-fg/60 mb-8">
          UTXO shielded transfers with association set compliance.
          Connect your wallet to get started.
        </p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold mb-4">Privacy Key Setup</h1>
        <p className="text-fg/60 mb-6">
          Sign a message to derive your privacy keypair. This is a one-time
          setup — the same wallet always produces the same keys.
        </p>
        <div className="bg-panel border border-edge rounded-xl p-6 max-w-md">
          <h2 className="text-lg font-semibold mb-4">Derive Privacy Keys</h2>
          <p className="text-sm text-fg/50 mb-4">
            Your wallet will ask you to sign a message. This does NOT send a
            transaction or spend any funds.
          </p>
          <button
            onClick={deriveKeypair}
            disabled={keypairLoading}
            className="w-full py-3 px-4 bg-btc text-void font-semibold rounded-lg hover:bg-btc/90 disabled:opacity-50 transition-colors"
          >
            {keypairLoading ? "Signing..." : "Sign to Derive Keys"}
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    try {
      const sats = BigInt(Math.floor(parseFloat(amount) * 1e8));
      if (tab === "deposit") {
        await deposit(sats, WBTC_ADDRESS);
      } else if (tab === "transfer") {
        if (!recipient) return;
        await withdraw(sats, recipient);
      } else if (tab === "withdraw") {
        if (!recipient) return;
        await withdraw(sats, recipient);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Sable V2 Privacy Pool</h1>
        <p className="text-fg/60">
          UTXO model with variable amounts, shielded transfers, and association set compliance.
        </p>
      </div>

      <div className="bg-panel border border-edge rounded-xl p-6 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm text-fg/50 mb-1">Shielded Balance</p>
            <p className="text-2xl font-bold">
              {formatTokenAmount(balance, 8, 6)} BTC
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-fg/50 mb-1">Unspent Notes</p>
            <p className="text-2xl font-bold">{notes.length}</p>
          </div>
        </div>
        {keypair && (
          <div className="mt-4 pt-4 border-t border-edge">
            <p className="text-xs text-fg/30 font-mono">
              Spending pubkey: {keypair.spendingPubkey.slice(0, 10)}...{keypair.spendingPubkey.slice(-8)}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-panel border border-btc/20 rounded-lg p-3 text-center">
          <p className="text-xs text-btc font-semibold mb-1">UTXO Model</p>
          <p className="text-xs text-fg/50">Variable amounts</p>
        </div>
        <div className="bg-panel border border-green-500/20 rounded-lg p-3 text-center">
          <p className="text-xs text-green-400 font-semibold mb-1">Association Sets</p>
          <p className="text-xs text-fg/50">Compliance proofs</p>
        </div>
        <div className="bg-panel border border-purple-500/20 rounded-lg p-3 text-center">
          <p className="text-xs text-purple-400 font-semibold mb-1">Stealth Addresses</p>
          <p className="text-xs text-fg/50">ECDH note delivery</p>
        </div>
      </div>

      <div className="bg-panel border border-edge rounded-xl p-6">
        <div className="flex gap-1 bg-void rounded-lg p-1 mb-6">
          {(["deposit", "transfer", "withdraw"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); resetStatus(); }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-panel text-fg border border-edge"
                  : "text-fg/50 hover:text-fg/70"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="block text-sm text-fg/50 mb-2">
            Amount (BTC)
          </label>
          <input
            type="number"
            step="0.00000001"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.001"
            className="w-full bg-void border border-edge rounded-lg px-4 py-3 text-fg placeholder-fg/30 focus:outline-none focus:border-btc/50"
          />
        </div>

        {tab !== "deposit" && (
          <div className="mb-4">
            <label className="block text-sm text-fg/50 mb-2">
              {tab === "transfer" ? "Recipient Address" : "Withdrawal Address"}
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-void border border-edge rounded-lg px-4 py-3 text-fg placeholder-fg/30 focus:outline-none focus:border-btc/50 font-mono text-sm"
            />
          </div>
        )}

        {status.step !== "idle" && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${
              status.step === "error"
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : status.step === "done"
                ? "bg-green-500/10 text-green-400 border border-green-500/20"
                : "bg-btc/10 text-btc border border-btc/20"
            }`}
          >
            {status.message}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!amount || status.step === "proving" || status.step === "submitting"}
          className="w-full py-3 px-4 bg-btc text-void font-semibold rounded-lg hover:bg-btc/90 disabled:opacity-50 transition-colors"
        >
          {status.step === "proving"
            ? "Generating ZK Proof..."
            : status.step === "submitting"
            ? "Submitting..."
            : tab === "deposit"
            ? "Shield BTC"
            : tab === "transfer"
            ? "Send Privately"
            : "Withdraw to Address"}
        </button>
      </div>

      {notes.length > 0 && (
        <div className="mt-6 bg-panel border border-edge rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Your Shielded Notes</h2>
          <div className="space-y-2">
            {notes.map((note, i) => (
              <div
                key={note.commitment}
                className="flex justify-between items-center bg-void rounded-lg px-4 py-3"
              >
                <div>
                  <p className="text-sm font-mono">
                    {formatTokenAmount(note.amount, 8, 6)} BTC
                  </p>
                  <p className="text-xs text-fg/30">
                    Leaf #{note.index} &middot; {note.commitment.slice(0, 10)}...
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    note.spent
                      ? "bg-red-500/10 text-red-400"
                      : "bg-green-500/10 text-green-400"
                  }`}
                >
                  {note.spent ? "Spent" : "Unspent"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-panel border border-edge rounded-xl p-5">
          <h3 className="font-semibold mb-3">How it works</h3>
          <ol className="space-y-2 text-sm text-fg/60">
            <li>1. Derive privacy keys from wallet signature (one-time)</li>
            <li>2. Deposit BTC — creates a shielded UTXO note with vault shares</li>
            <li>3. Transfer privately — spend notes, create new notes for recipient</li>
            <li>4. Withdraw — prove you own a note, redeem shares for BTC</li>
          </ol>
        </div>
        <div className="bg-panel border border-edge rounded-xl p-5">
          <h3 className="font-semibold mb-3">Privacy guarantees</h3>
          <ul className="space-y-2 text-sm text-fg/60">
            <li>Groth16 ZK proof — zero knowledge of deposit/withdrawal link</li>
            <li>Depth-20 Merkle tree — 1M+ anonymity set capacity</li>
            <li>Dual proof — association set compliance without identity reveal</li>
            <li>ECDH stealth — encrypted note delivery via Stark curve</li>
            <li>Vault shares — yield accrues while funds are shielded</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
