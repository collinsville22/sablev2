import { poseidonHash2, poseidonHash1 } from "./keypair";

export interface UTXONote {
  amount: bigint;
  pubkey: string;
  blinding: string;
  commitment: string;
  index: number;
  spent: boolean;
}

export function randomFieldElement(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export async function computeCommitment(
  amount: bigint,
  pubkey: string,
  blinding: string
): Promise<string> {
  const inner = await poseidonHash2(amount, BigInt(pubkey));
  const commitment = await poseidonHash2(inner, BigInt(blinding));
  return "0x" + commitment.toString(16);
}

export async function computeNullifier(
  privkey: string,
  commitment: string,
  pathIndices: number
): Promise<string> {
  const commitBig = BigInt(commitment);
  const privBig = BigInt(privkey);
  const pathBig = BigInt(pathIndices);

  const sigInner = await poseidonHash2(privBig, commitBig);
  const signature = await poseidonHash2(sigInner, pathBig);

  const nullInner = await poseidonHash2(commitBig, pathBig);
  const nullifier = await poseidonHash2(nullInner, signature);

  return "0x" + nullifier.toString(16);
}

export async function createNote(
  amount: bigint,
  pubkey: string
): Promise<UTXONote> {
  const blinding = randomFieldElement();
  const commitment = await computeCommitment(amount, pubkey, blinding);

  return {
    amount,
    pubkey,
    blinding,
    commitment,
    index: -1,
    spent: false,
  };
}

export async function createDummyNote(pubkey: string): Promise<UTXONote> {
  return createNote(BigInt(0), pubkey);
}

const NOTES_STORAGE_KEY = "sable_v2_utxo_notes";

export function saveNotes(notes: UTXONote[]): void {
  const serialized = notes.map((n) => ({
    amount: n.amount.toString(),
    pubkey: n.pubkey,
    blinding: n.blinding,
    commitment: n.commitment,
    index: n.index,
    spent: n.spent,
  }));
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(serialized));
}

export function loadNotes(): UTXONote[] {
  const raw = localStorage.getItem(NOTES_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw).map((n: Record<string, unknown>) => ({
      amount: BigInt(n.amount as string),
      pubkey: n.pubkey as string,
      blinding: n.blinding as string,
      commitment: n.commitment as string,
      index: n.index as number,
      spent: n.spent as boolean,
    }));
  } catch {
    return [];
  }
}

export function getUnspentNotes(): UTXONote[] {
  return loadNotes().filter((n) => !n.spent && n.index >= 0);
}

export function getBalance(): bigint {
  return getUnspentNotes().reduce((sum, n) => sum + n.amount, BigInt(0));
}

export function markNoteSpent(commitment: string): void {
  const notes = loadNotes();
  const updated = notes.map((n) =>
    n.commitment === commitment ? { ...n, spent: true } : n
  );
  saveNotes(updated);
}
