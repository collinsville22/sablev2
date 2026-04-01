#!/bin/bash
set -e

echo "=== Sable V2 Circuit Compilation ==="

echo "[1/8] Installing dependencies..."
npm install

echo "[2/8] Compiling circuit..."
circom transaction.circom --r1cs --wasm --sym -o build/

echo "[3/8] Circuit info:"
npx snarkjs r1cs info build/transaction.r1cs

PTAU_FILE="powersOfTau28_hez_final_15.ptau"
if [ ! -f "$PTAU_FILE" ]; then
    echo "[4/8] Downloading Powers of Tau (phase 1)..."
    wget -q "https://storage.googleapis.com/zkevm/ptau/$PTAU_FILE"
else
    echo "[4/8] Powers of Tau already downloaded"
fi

echo "[5/8] Running Groth16 setup (phase 2)..."
npx snarkjs groth16 setup build/transaction.r1cs "$PTAU_FILE" circuit_0000.zkey

echo "[6/8] Contributing to phase 2 ceremony..."
npx snarkjs zkey contribute circuit_0000.zkey circuit_final.zkey \
    --name="Sable V2 Contribution" -v -e="sable-v2-utxo-privacy-pool-$(date +%s)"

echo "[7/8] Exporting verification key..."
npx snarkjs zkey export verificationkey circuit_final.zkey verification_key.json

echo "[8/8] Copying artifacts to public/circuits-v5/..."
mkdir -p ../../public/circuits-v5
cp build/transaction_js/transaction.wasm ../../public/circuits-v5/
cp circuit_final.zkey ../../public/circuits-v5/
cp verification_key.json ../../public/circuits-v5/

echo ""
echo "=== Done! ==="
echo "Circuit WASM:       public/circuits-v5/transaction.wasm"
echo "Proving key:        public/circuits-v5/circuit_final.zkey"
echo "Verification key:   public/circuits-v5/verification_key.json"
echo ""
echo "Next steps:"
echo "  1. Generate Garaga verifier: garaga gen --system groth16 --vk public/circuits-v5/verification_key.json"
echo "  2. Build contracts: cd contracts && scarb build"
