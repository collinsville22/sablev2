import nacl from "tweetnacl";

let poseidonInstance: ((inputs: bigint[]) => Uint8Array) | null = null;
let F: { toObject: (v: Uint8Array) => bigint } | null = null;

async function ensurePoseidon() {
  if (!poseidonInstance) {
    const { buildPoseidon } = await import("circomlibjs");
    const p = await buildPoseidon();
    poseidonInstance = p;
    F = p.F;
  }
  return { poseidon: poseidonInstance, F: F! };
}

export function poseidonHash2(a: bigint, b: bigint): Promise<bigint> {
  return ensurePoseidon().then(({ poseidon, F }) => F.toObject(poseidon([a, b])));
}

export function poseidonHash1(a: bigint): Promise<bigint> {
  return ensurePoseidon().then(({ poseidon, F }) => F.toObject(poseidon([a])));
}

export interface Keypair {
  spendingPrivkey: string;
  spendingPubkey: string;
  viewingPrivkey: Uint8Array;
  viewingPubkey: Uint8Array;
}

export async function deriveKeypair(
  signatureR: string,
  signatureS: string
): Promise<Keypair> {
  const rBig = BigInt(signatureR);
  const sBig = BigInt(signatureS);

  const spendingPrivkeyBig = await poseidonHash2(rBig, sBig);
  const spendingPrivkey = "0x" + spendingPrivkeyBig.toString(16);

  const spendingPubkeyBig = await poseidonHash1(spendingPrivkeyBig);
  const spendingPubkey = "0x" + spendingPubkeyBig.toString(16);

  const viewingSeedBig = await poseidonHash2(sBig, rBig);
  const viewingSeedHex = viewingSeedBig.toString(16).padStart(64, "0");
  const viewingPrivkey = hexToBytes(viewingSeedHex.slice(0, 64));

  const viewingPubkey = nacl.scalarMult.base(viewingPrivkey);

  return { spendingPrivkey, spendingPubkey, viewingPrivkey, viewingPubkey };
}

export function encryptNote(
  recipientViewingPubkey: Uint8Array,
  amount: bigint,
  blinding: bigint
): { encrypted: Uint8Array; ephemeralPubkey: Uint8Array } {
  const ephemeralKeypair = nacl.box.keyPair();

  const plaintext = new Uint8Array(64);
  const amountBytes = bigintToBytes32(amount);
  const blindingBytes = bigintToBytes32(blinding);
  plaintext.set(amountBytes, 0);
  plaintext.set(blindingBytes, 32);

  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box(
    plaintext,
    nonce,
    recipientViewingPubkey,
    ephemeralKeypair.secretKey
  );

  const packed = new Uint8Array(24 + encrypted!.length);
  packed.set(nonce, 0);
  packed.set(encrypted!, 24);

  return { encrypted: packed, ephemeralPubkey: ephemeralKeypair.publicKey };
}

export function decryptNote(
  viewingPrivkey: Uint8Array,
  senderEphemeralPubkey: Uint8Array,
  encryptedData: Uint8Array
): { amount: bigint; blinding: bigint } | null {
  if (encryptedData.length < 25) return null;

  const nonce = encryptedData.slice(0, 24);
  const ciphertext = encryptedData.slice(24);

  const plaintext = nacl.box.open(ciphertext, nonce, senderEphemeralPubkey, viewingPrivkey);
  if (!plaintext || plaintext.length < 64) return null;

  const amount = bytes32ToBigint(plaintext.slice(0, 32));
  const blinding = bytes32ToBigint(plaintext.slice(32, 64));

  return { amount, blinding };
}

export function computeViewTag(
  viewingPrivkey: Uint8Array,
  ephemeralPubkey: Uint8Array
): number {
  const sharedSecret = nacl.scalarMult(viewingPrivkey, ephemeralPubkey);
  return sharedSecret[0];
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = clean.padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

const KEYPAIR_STORAGE_KEY = "sable_v2_keypair";

export function saveKeypair(keypair: Keypair): void {
  const data = {
    spendingPrivkey: keypair.spendingPrivkey,
    spendingPubkey: keypair.spendingPubkey,
    viewingPrivkey: bytesToHex(keypair.viewingPrivkey),
    viewingPubkey: bytesToHex(keypair.viewingPubkey),
  };
  localStorage.setItem(KEYPAIR_STORAGE_KEY, JSON.stringify(data));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function loadKeypair(): Keypair | null {
  const raw = localStorage.getItem(KEYPAIR_STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      spendingPrivkey: data.spendingPrivkey,
      spendingPubkey: data.spendingPubkey,
      viewingPrivkey: hexToBytes(data.viewingPrivkey),
      viewingPubkey: hexToBytes(data.viewingPubkey),
    };
  } catch {
    return null;
  }
}
