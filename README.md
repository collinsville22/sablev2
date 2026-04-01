<p align="center">
  <img src="public/logo-sable.png" alt="Sable Logo" width="120" />
</p>

<h1 align="center">Sable V2 — UTXO Privacy Pools for Bitcoin on StarkNet</h1>

<p align="center">
  <strong>Private BTC yield with UTXO shielded transfers, association set compliance, and stealth addresses — built on StarkNet L2 with Groth16 ZK proofs.</strong>
</p>

<p align="center">
  <code>Next.js 16</code> · <code>React 19</code> · <code>Cairo 2.13</code> · <code>Circom/Groth16</code> · <code>Garaga</code> · <code>Tailwind v4</code>
</p>

<p align="center">
  <a href="https://btcvault-six.vercel.app"><strong>Live App (V1)</strong></a> · <a href="https://www.youtube.com/watch?v=gZ9OjBd4OVQ"><strong>Demo Video</strong></a>
</p>

---

## What's New in V2 (Progress Since Re{define})

Sable V1 was submitted to the Re{define} hackathon as a BTC yield aggregator with Tornado Cash-style fixed-denomination privacy pools. **Sable V2 is a complete evolution of the privacy layer**, transforming Sable from a mixer into a full **UTXO Privacy Pool** — the first on StarkNet.

### V1 → V2 Comparison

| Feature | V1 (Re{define}) | V2 (PL Genesis) |
|---------|-----------------|-----------------|
| **Privacy model** | Tornado Cash (fixed denomination) | **UTXO** (variable amounts, 2-in-2-out) |
| **Shielded transfers** | Not possible | **Yes** — send BTC privately between users |
| **Anonymity set** | 1,024 per pool, split across 16 pools | **1,048,576** in a single unified pool |
| **Compliance** | None | **Association sets** (Buterin et al. 2023) |
| **Note delivery** | localStorage only | **Encrypted events** + stealth addresses (ECDH) |
| **Circuit** | Withdrawal-only (7 public inputs) | **2-in-2-out transaction** (8 public signals) |
| **Tree depth** | 10 | **20** |
| **Batch system** | Deploy batches of 3/5/7 | **Eliminated** — direct vault integration |
| **Note structure** | `Poseidon(nullifier, secret)` | `Poseidon(Poseidon(amount, pubkey), blinding)` |
| **Nullifier** | `Poseidon(nullifier)` | `Poseidon(Poseidon(commitment, pathIndex), signature)` |

### Three Core Innovations

**1. UTXO Model (Tornado Nova Architecture)**

Every privacy operation is a 2-input, 2-output transaction:
- **Deposit**: 0 real inputs → 1 note with your vault shares + 1 dummy
- **Transfer**: Spend your note → create note for recipient + change note for yourself
- **Withdraw**: Spend note → public withdrawal to any address + change note
- **Split/Merge**: Combine or divide notes freely

Notes carry **vault shares** (not raw sats), so yield accrues automatically while funds remain shielded.

**2. Association Sets (0xbow Privacy Pools)**

Based on Vitalik Buterin's 2023 paper "Blockchain Privacy and Regulatory Compliance." Each withdrawal proves membership in both the main commitment tree AND an ASP-curated "clean" subset tree via **dual Merkle proof**.

- Users prove their deposit is "compliant" without revealing which deposit is theirs
- The ASP (Association Set Provider) publishes approved deposit subsets
- When ASP is disabled, `subsetRoot = root` (no compliance filtering)
- First implementation on StarkNet

**3. Stealth Addresses (ERC-5564 Pattern)**

ECDH key exchange on the Stark curve for encrypted note delivery:
- Recipients register `(spending_pubkey, viewing_pubkey)` in an on-chain registry
- Senders encrypt note data with a shared secret derived from ECDH
- Recipients scan `NewCommitment` events, trial-decrypt to discover incoming notes
- Eliminates the need for out-of-band note sharing

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER BROWSER                                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    PRIVACY ENGINE (Client-Side)                 │    │
│  │                                                                 │    │
│  │  keypair.ts ─── Derive keys from wallet signature (Umbra)      │    │
│  │  utxo.ts ────── UTXO note: Poseidon(Poseidon(amt, pk), blind) │    │
│  │  merkle.ts ──── Incremental Merkle tree (depth 20)             │    │
│  │  prover.ts ──── snarkjs Groth16 proof generation (~15s)        │    │
│  │  calldata.ts ── Garaga BN254 calldata for on-chain verify      │    │
│  │  scanner.ts ─── Trial decryption of NewCommitment events       │    │
│  │  stealth.ts ─── ECDH stealth address lookup + encryption       │    │
│  │  assoc.ts ───── ASP subset tree building                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    NEXT.JS FRONTEND (React 19)                  │    │
│  │  /privacy ─── UTXO deposit/transfer/withdraw + key setup       │    │
│  │  /vault/* ─── 6 ERC-4626 yield strategies (from V1)            │    │
│  │  /cdp, /dca, /stake, /bridge, /portfolio (from V1)             │    │
│  └──────────────────────────┬──────────────────────────────────────┘    │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
┌─────────────────────────────┼──────────────────────────────────────────┐
│                   STARKNET MAINNET                                      │
│                              │                                          │
│  ┌───────────────────────────┼───────────────────────────────────────┐  │
│  │              V2 PRIVACY CONTRACTS (NEW)                           │  │
│  │                                                                   │  │
│  │  ShieldedPoolV5 ──── Unified transact() function                 │  │
│  │    • 2-in-2-out UTXO with Groth16 proof verification             │  │
│  │    • Depth-20 incremental Merkle tree (1M deposits)              │  │
│  │    • Vault share integration (yield while shielded)              │  │
│  │    • ASP root check (optional compliance)                        │  │
│  │    • Encrypted note delivery via NewCommitment events            │  │
│  │                                                                   │  │
│  │  Groth16VerifierV5 ── Garaga BN254 on-chain verifier             │  │
│  │    • 8 public signals (4 outputs + 4 inputs)                     │  │
│  │    • ~34M Sierra gas per verification                            │  │
│  │                                                                   │  │
│  │  StealthRegistry ──── Privacy key registration                   │  │
│  │    • Maps address → (spending_pubkey, viewing_pubkey)            │  │
│  │                                                                   │  │
│  │  ASPRegistry ───────── Association set root management           │  │
│  │    • Owner publishes approved deposit subset roots               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │              V1 VAULT CONTRACTS (Unchanged)                       │  │
│  │  Sentinel · Citadel · Trident · DeltaNeutral · Turbo · Apex      │  │
│  │  DCA (Mayer Multiple) · CDP (Nostra) · StablecoinVault           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │              EXTERNAL PROTOCOLS                                   │  │
│  │  Vesu · Ekubo · Endur · Nostra · AVNU · Pragma · Garaga          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Circuit Deep Dive

### `transaction.circom` — 2-in-2-out UTXO with Association Sets

**Circuit stats:**
- **24,632** non-linear constraints
- **4** public inputs: `root`, `subsetRoot`, `publicAmount`, `extDataHash`
- **4** public outputs: `inputNullifier[2]`, `outputCommitment[2]`
- **96** private inputs (amounts, keys, blindings, Merkle proofs × 4)
- Proving system: **Groth16 on BN254**
- Browser proving time: **~10-15 seconds**

**Note commitment** (nested 2-input Poseidon for garaga compatibility):
```
commitment = Poseidon(Poseidon(amount, pubkey), blinding)
```

**Nullifier derivation** (deterministic from owner's private key):
```
signature = Poseidon(Poseidon(privkey, commitment), pathIndices)
nullifier = Poseidon(Poseidon(commitment, pathIndices), signature)
```

**What the circuit proves:**
1. The prover owns the private key for each input note
2. Each input note exists in the state Merkle tree (depth 20)
3. Each input note exists in the ASP subset tree (dual proof)
4. All amounts are range-checked (248-bit, prevents field overflow)
5. Value is conserved: `sum(inputs) + publicAmount = sum(outputs)`
6. Nullifiers are unique (no double-spend within a transaction)
7. The proof is bound to specific external data (anti-frontrunning)

**Dummy input handling:** For deposits (no existing notes to spend), ForceEqualIfEnabled skips the Merkle root check when input amount is zero.

---

## Deployed Contracts (StarkNet Mainnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| **ShieldedPoolV5** | `0x0a8b17a3dab4f3721457c53f0c77a50feffed4c3439d786a9e6931787727343` | UTXO privacy pool |
| **Groth16VerifierV5** | `0x4d9b64950154d0287290c17ecd9b32e145b097f907685a1594692acf2d5e60e` | On-chain ZK verifier |
| **StealthRegistry** | `0x4d92ec179fb61372b5cce17600bb9730d4672138dd89297fa7b55bb570bc01c` | Privacy key registry |
| **ASPRegistry** | `0x28710c0f81594d75e3a4ed46ce13a151a03f1e37618245db2ed7e590e4446a2` | Compliance root store |

All V1 vault contracts (Sentinel, Citadel, Trident, DeltaNeutral, Turbo, Apex) remain deployed and unchanged.

---

## How Privacy Works (Step by Step)

### 1. Key Setup (One-Time)
```
User signs deterministic message → hash(signature) → (spending_privkey, viewing_key)
spending_pubkey = Poseidon(spending_privkey)
Register (spending_pubkey, viewing_pubkey) in StealthRegistry
```

### 2. Deposit (Sats → Shielded Note)
```
1. User approves WBTC to pool contract
2. Client creates output note: commitment = Poseidon(Poseidon(shares, pubkey), blinding)
3. Client generates Groth16 proof (2 dummy inputs, 1 real output + 1 dummy)
4. Relayer submits transact() — pool pulls WBTC, deposits to vault, inserts commitment
5. Note encrypted and emitted in NewCommitment event
```

### 3. Transfer (Shielded → Shielded, Fully Private)
```
1. Sender selects input notes summing ≥ transfer amount
2. Creates output note for recipient (using recipient's pubkey from StealthRegistry)
3. Creates change note for self
4. Groth16 proof: 2 inputs consumed, 2 outputs created, publicAmount = 0
5. Relayer submits — no token movement, only Merkle tree updates
6. Recipient scans events, trial-decrypts, discovers their note
```

### 4. Withdraw (Shielded → Fresh Address)
```
1. Client builds Merkle tree from on-chain events
2. Generates proof with publicAmount = -(withdraw_amount) wrapped in BN254 field
3. Pool redeems vault shares, sends WBTC to recipient
4. Change note created for remaining balance
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Framework** | Next.js (Turbopack) | 16.1.6 |
| **UI** | React | 19.2.3 |
| **Styling** | Tailwind CSS | 4.x |
| **Smart Contracts** | Cairo (Scarb) | 2.13.1 |
| **ZK Circuit** | Circom | 2.1.9 |
| **Proving System** | Groth16 (snarkjs) | 0.7.6 |
| **On-chain Verify** | Garaga BN254 | 1.1.0 |
| **Blockchain** | StarkNet Mainnet | — |
| **StarkNet Client** | starknet.js | 8.9.2 |
| **Wallet** | @starknet-react/core | 5.0.3 |
| **Note Encryption** | tweetnacl (X25519-XSalsa20-Poly1305) | 1.0.3 |

---

## Project Structure

```
SableV2/
├── contracts/                          # Cairo smart contracts
│   └── src/
│       ├── shielded_pool_v5.cairo      # NEW: UTXO privacy pool
│       ├── stealth_registry.cairo      # NEW: Privacy key registry
│       ├── asp_registry.cairo          # NEW: Association set provider
│       ├── sentinel.cairo              # V1: Pure WBTC lending vault
│       ├── btcvault.cairo              # V1: Leverage loop vault
│       └── ...                         # V1: Other vault strategies
│
├── groth16_verifier_v5/                # Garaga-generated Groth16 verifier
│   └── src/
│       ├── groth16_verifier.cairo      # On-chain proof verification
│       └── groth16_verifier_constants.cairo  # VK constants (4,129 lines)
│
├── privacy/circuits-v5/               # ZK circuit
│   ├── transaction.circom             # 2-in-2-out UTXO circuit (24,632 constraints)
│   ├── keypair.circom                 # Poseidon keypair templates
│   ├── merkle_proof.circom            # Depth-20 Merkle proof template
│   ├── compile.sh                     # Full build pipeline
│   └── test_proof.js                  # Proof generation test
│
├── public/circuits-v5/                # Browser proving artifacts
│   ├── transaction.wasm               # Compiled circuit (2.1 MB)
│   ├── circuit_final.zkey             # Proving key (14 MB)
│   └── verification_key.json          # Verification key
│
├── src/
│   ├── lib/privacy/                   # Client-side privacy engine
│   │   ├── keypair.ts                 # Key derivation + NaCl encryption
│   │   ├── utxo.ts                    # UTXO note structure + commitment
│   │   ├── merkle.ts                  # Incremental Merkle tree (depth 20)
│   │   ├── prover.ts                  # Groth16 proof generation
│   │   ├── calldata.ts                # Garaga calldata conversion
│   │   ├── note-scanner.ts            # Trial decryption of events
│   │   ├── stealth.ts                 # ECDH stealth address logic
│   │   └── association.ts             # ASP subset tree building
│   │
│   ├── hooks/
│   │   ├── use-shielded-pool-v5.ts    # Main privacy pool hook
│   │   └── use-keypair.ts             # Privacy key management
│   │
│   ├── app/privacy/page.tsx           # Privacy pool UI
│   └── app/api/relayer/transact/      # Unified relayer endpoint
│
└── scripts/deploy.mjs                 # Mainnet deployment script
```

---

## Development Setup

### Prerequisites
- Node.js 20+ and npm
- Rust + Cargo (for circom)
- Python 3.10+ (for garaga CLI)
- Scarb 2.13+ (for Cairo contracts)

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/SableV2.git
cd SableV2
npm install
```

### Environment Variables

Create `.env.local`:
```
CURATOR_PRIVATE_KEY=0x...
CURATOR_ADDRESS=0x...
NEXT_PUBLIC_STARKNET_RPC=https://rpc.starknet.lava.build
```

### Running

```bash
npm run dev      # Development server (Turbopack)
npm run build    # Production build
npm start        # Production server
```

### Circuit Compilation (if modifying the circuit)

```bash
cd privacy/circuits-v5
npm install
bash compile.sh   # Compiles, runs trusted setup, exports artifacts
```

### Contract Compilation

```bash
cd contracts
scarb build
```

---

## Privacy Guarantees

| Property | How It's Achieved |
|----------|------------------|
| **Deposit-withdrawal unlinkability** | Groth16 ZK proof — verifier learns nothing about which deposit is being spent |
| **Amount hiding** | UTXO model — notes carry encrypted amounts, no fixed denominations |
| **Sender anonymity** | Relayer submits all transactions — user address never appears as tx sender |
| **Recipient privacy** | Stealth addresses — ECDH-encrypted note delivery, recipient scans events |
| **Compliance compatibility** | Association sets — dual Merkle proof shows deposit is in approved subset |
| **Yield while shielded** | Notes carry vault shares — ERC-4626 yield accrues automatically |
| **Large anonymity set** | Depth-20 tree supports 1M+ deposits in a single unified pool |
| **Double-spend prevention** | Nullifier tracking — each note can only be spent once |

---

## Based On

- **Tornado Cash Nova** — UTXO model, 2-in-2-out transactions, value conservation circuit
- **0xbow Privacy Pools** — Association sets, dual Merkle proofs, compliance architecture
- **ERC-5564** — Stealth address standard, ECDH key exchange
- **Garaga** — BN254 Groth16 verification on StarkNet

---

## Team

- **Collins** — Full-stack & smart contracts

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  <strong>Built on StarkNet</strong> · Powered by Garaga, Vesu, Ekubo, Endur, Nostra, AVNU, Pragma
</p>
