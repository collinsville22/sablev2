const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const path = require("path");

const TREE_DEPTH = 20;

async function main() {
  console.log("=== Sable V2 Circuit Test ===\n");

  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const hash2 = (a, b) => F.toObject(poseidon([a, b]));
  const hash1 = (a) => F.toObject(poseidon([a]));

  const privkey = BigInt("12345678901234567890");
  const pubkey = hash1(privkey);
  console.log("Test pubkey:", pubkey.toString().slice(0, 20) + "...");

  const dummyBlinding = BigInt("111111111");
  const dummyCommitInner = hash2(BigInt(0), pubkey);
  const dummyCommitment = hash2(dummyCommitInner, dummyBlinding);

  const zeros = [BigInt(0)];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    zeros[i] = hash2(zeros[i - 1], zeros[i - 1]);
  }

  const emptyRoot = zeros[TREE_DEPTH];
  console.log("Empty tree root:", emptyRoot.toString().slice(0, 20) + "...");

  const pathElements = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    pathElements.push(zeros[i].toString());
  }

  const outAmount0 = BigInt(10000);
  const outPubkey0 = pubkey;
  const outBlinding0 = BigInt("222222222");
  const outCommitInner0 = hash2(outAmount0, outPubkey0);
  const outCommitment0 = hash2(outCommitInner0, outBlinding0);

  const outAmount1 = BigInt(0);
  const outPubkey1 = pubkey;
  const outBlinding1 = BigInt("333333333");
  const outCommitInner1 = hash2(outAmount1, outPubkey1);
  const outCommitment1 = hash2(outCommitInner1, outBlinding1);

  const publicAmount = BigInt(10000);

  const extDataHash = hash2(BigInt(999), BigInt(888));

  const input = {
    root: emptyRoot.toString(),
    subsetRoot: emptyRoot.toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: extDataHash.toString(),

    inAmount: ["0", "0"],
    inPrivateKey: [privkey.toString(), privkey.toString()],
    inBlinding: [dummyBlinding.toString(), dummyBlinding.toString()],
    inPathIndices: ["0", "1"],
    inPathElements: [pathElements, pathElements],
    inSubsetPathElements: [pathElements, pathElements],
    inSubsetPathIndices: ["0", "1"],

    outAmount: [outAmount0.toString(), outAmount1.toString()],
    outPubkey: [outPubkey0.toString(), outPubkey1.toString()],
    outBlinding: [outBlinding0.toString(), outBlinding1.toString()],
  };

  console.log("\nGenerating proof...");
  const wasmPath = path.join(__dirname, "build", "transaction_js", "transaction.wasm");
  const zkeyPath = path.join(__dirname, "circuit_final.zkey");

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      wasmPath,
      zkeyPath
    );

    console.log("\nProof generated successfully!");
    console.log("Public signals (" + publicSignals.length + "):");
    console.log("  [0] inputNullifier[0]:", publicSignals[0].slice(0, 20) + "...");
    console.log("  [1] inputNullifier[1]:", publicSignals[1].slice(0, 20) + "...");
    console.log("  [2] outputCommitment[0]:", publicSignals[2].slice(0, 20) + "...");
    console.log("  [3] outputCommitment[1]:", publicSignals[3].slice(0, 20) + "...");
    console.log("  [4] root:", publicSignals[4].slice(0, 20) + "...");
    console.log("  [5] subsetRoot:", publicSignals[5].slice(0, 20) + "...");
    console.log("  [6] publicAmount:", publicSignals[6]);
    console.log("  [7] extDataHash:", publicSignals[7].slice(0, 20) + "...");

    console.log("\nVerifying proof...");
    const vkeyPath = path.join(__dirname, "verification_key.json");
    const vkey = JSON.parse(require("fs").readFileSync(vkeyPath, "utf-8"));
    const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);

    if (isValid) {
      console.log("Proof VALID!");

      const expectedOut0 = outCommitment0.toString();
      const expectedOut1 = outCommitment1.toString();
      console.log("\nCommitment verification:");
      console.log("  Output 0 matches:", publicSignals[2] === expectedOut0 ? "YES" : "NO");
      console.log("  Output 1 matches:", publicSignals[3] === expectedOut1 ? "YES" : "NO");
    } else {
      console.log("Proof INVALID!");
      process.exit(1);
    }

    console.log("\n=== All tests passed! ===");
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main().catch(console.error);
