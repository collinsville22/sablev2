import type { UTXONote } from "./utxo";
import type { Keypair } from "./keypair";
import type { MerkleProof, IncrementalMerkleTree } from "./merkle";

const CIRCUIT_WASM = "/circuits-v5/transaction.wasm";
const CIRCUIT_ZKEY = "/circuits-v5/circuit_final.zkey";

const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

export interface ProofResult {
  proof: Record<string, unknown>;
  publicSignals: string[];
}

export interface TransactionInputs {
  inputs: UTXONote[];
  outputs: UTXONote[];
  keypair: Keypair;
  mainTree: IncrementalMerkleTree;
  subsetTree: IncrementalMerkleTree;
  publicAmount: bigint;
  extDataHash: string;
}

export async function generateTransactionProof(
  txInputs: TransactionInputs
): Promise<ProofResult> {
  const { inputs, outputs, keypair, mainTree, subsetTree, publicAmount, extDataHash } = txInputs;

  if (inputs.length !== 2) throw new Error("Exactly 2 input notes required");
  if (outputs.length !== 2) throw new Error("Exactly 2 output notes required");

  const mainProofs: MerkleProof[] = [];
  const subsetProofs: MerkleProof[] = [];

  for (let i = 0; i < 2; i++) {
    if (inputs[i].amount > BigInt(0) && inputs[i].index >= 0) {
      mainProofs.push(await mainTree.getProof(inputs[i].index));
      subsetProofs.push(await subsetTree.getProof(inputs[i].index));
    } else {
      mainProofs.push(await mainTree.getProof(0).catch(() => dummyProof(mainTree.root)));
      subsetProofs.push(await subsetTree.getProof(0).catch(() => dummyProof(subsetTree.root)));
    }
  }

  const wrappedPublicAmount = publicAmount >= BigInt(0)
    ? publicAmount
    : FIELD_SIZE + publicAmount;

  const toDecimal = (hex: string) => BigInt(hex).toString(10);

  const circuitInput = {
    root: toDecimal(mainTree.root),
    subsetRoot: toDecimal(subsetTree.root),
    publicAmount: wrappedPublicAmount.toString(10),
    extDataHash: toDecimal(extDataHash),

    inAmount: inputs.map((n) => n.amount.toString(10)),
    inPrivateKey: inputs.map(() => BigInt(keypair.spendingPrivkey).toString(10)),
    inBlinding: inputs.map((n) => BigInt(n.blinding).toString(10)),
    inPathIndices: mainProofs.map((p) => p.pathIndices.toString(10)),
    inPathElements: mainProofs.map((p) => p.pathElements.map((e) => BigInt(e).toString(10))),
    inSubsetPathElements: subsetProofs.map((p) => p.pathElements.map((e) => BigInt(e).toString(10))),
    inSubsetPathIndices: subsetProofs.map((p) => p.pathIndices.toString(10)),

    outAmount: outputs.map((n) => n.amount.toString(10)),
    outPubkey: outputs.map((n) => BigInt(n.pubkey).toString(10)),
    outBlinding: outputs.map((n) => BigInt(n.blinding).toString(10)),
  };

  const snarkjs = await import("snarkjs");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    CIRCUIT_WASM,
    CIRCUIT_ZKEY
  );

  return { proof, publicSignals };
}

function dummyProof(root: string): MerkleProof {
  return {
    pathElements: Array(20).fill("0x0"),
    pathIndices: 0,
    root,
  };
}

export async function fetchRelayerFee(
  poolAddress?: string
): Promise<{ feeSats: number; feeBreakdown: Record<string, unknown> }> {
  const url = poolAddress
    ? `/api/relayer/fee-estimate?pool=${poolAddress}`
    : "/api/relayer/fee-estimate";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch fee estimate");
  return res.json();
}
