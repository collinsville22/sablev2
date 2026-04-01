import { decryptNote, type Keypair } from "./keypair";
import { computeCommitment, type UTXONote } from "./utxo";

const NEW_COMMITMENT_SELECTOR = "0x22e3e55b690d7d609fdd9acbb8a48098de7fa7874cf95d975b1264b0c24d161";

export interface NewCommitmentEvent {
  commitment: string;
  leafIndex: number;
  encryptedOutput: Uint8Array;
  ephemeralPubkey: Uint8Array;
}

export async function scanForNotes(
  events: NewCommitmentEvent[],
  keypair: Keypair,
  knownIndices: Set<number> = new Set()
): Promise<UTXONote[]> {
  const discovered: UTXONote[] = [];

  for (const evt of events) {
    if (knownIndices.has(evt.leafIndex)) continue;

    const decrypted = decryptNote(
      keypair.viewingPrivkey,
      evt.ephemeralPubkey,
      evt.encryptedOutput
    );

    if (!decrypted) continue;

    const recomputed = await computeCommitment(
      decrypted.amount,
      keypair.spendingPubkey,
      "0x" + decrypted.blinding.toString(16)
    );

    if (recomputed.toLowerCase() !== evt.commitment.toLowerCase()) continue;

    discovered.push({
      amount: decrypted.amount,
      pubkey: keypair.spendingPubkey,
      blinding: "0x" + decrypted.blinding.toString(16),
      commitment: evt.commitment,
      index: evt.leafIndex,
      spent: false,
    });
  }

  return discovered;
}

export async function fetchCommitmentEvents(
  providerOrUrl: string,
  poolAddress: string,
  fromBlock: number = 0
): Promise<NewCommitmentEvent[]> {
  const events: NewCommitmentEvent[] = [];
  let continuationToken: string | undefined;

  do {
    const body = {
      jsonrpc: "2.0",
      method: "starknet_getEvents",
      params: {
        filter: {
          address: poolAddress,
          keys: [[NEW_COMMITMENT_SELECTOR]],
          from_block: { block_number: fromBlock },
          to_block: "latest",
          chunk_size: 100,
          ...(continuationToken ? { continuation_token: continuationToken } : {}),
        },
      },
      id: 1,
    };

    const res = await fetch(providerOrUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    const result = json.result || {};

    for (const evt of result.events || []) {
      try {
        const commitmentLow = BigInt(evt.keys[1] || "0");
        const commitmentHigh = BigInt(evt.keys[2] || "0");
        const commitment = "0x" + ((commitmentHigh << BigInt(128)) + commitmentLow).toString(16);

        const leafIndex = Number(evt.data[0] || "0");

        const encLen = Number(evt.data[1] || "0");

        const encElements = evt.data.slice(2, 2 + encLen) as string[];
        const encryptedOutput = feltsToBytes(encElements);

        const ephIdx = 2 + encLen;
        const ephLow = BigInt(evt.data[ephIdx] || "0");
        const ephHigh = BigInt(evt.data[ephIdx + 1] || "0");
        const ephBigInt = (ephHigh << BigInt(128)) + ephLow;
        const ephemeralPubkey = bigintToBytes32(ephBigInt);

        events.push({ commitment, leafIndex, encryptedOutput, ephemeralPubkey });
      } catch {
      }
    }

    continuationToken = result.continuation_token;
  } while (continuationToken);

  return events;
}

function feltsToBytes(felts: string[]): Uint8Array {
  const chunks: number[][] = [];
  for (const f of felts) {
    const n = BigInt(f);
    const hex = n.toString(16);
    const padded = hex.padStart(62, "0");
    const bytes: number[] = [];
    for (let i = 0; i < padded.length; i += 2) {
      bytes.push(parseInt(padded.slice(i, i + 2), 16));
    }
    chunks.push(bytes);
  }
  const flat = chunks.flat();
  return new Uint8Array(flat);
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
