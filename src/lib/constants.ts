export const STARKNET_CHAIN_ID = "0x534e5f4d41494e" as const;

export const TOKENS = {
  WBTC: {
    address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
    symbol: "WBTC",
    name: "Wrapped BTC",
    decimals: 8,
    icon: "/tokens/wbtc.svg",
  },
  ETH: {
    address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    icon: "/tokens/eth.svg",
  },
  USDC: {
    address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    icon: "/tokens/usdc.svg",
  },
  STRK: {
    address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    symbol: "STRK",
    name: "Starknet",
    decimals: 18,
    icon: "/tokens/strk.svg",
  },
  USDT: {
    address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    icon: "/tokens/usdt.svg",
  },
} as const;

export const VESU_POOLS = {
  RE7_XBTC: {
    id: "0x03a8416bf20d036df5b1cf3447630a2e1cb04685f6b0c3a70ed7fb1473548ecf",
    name: "Re7 xBTC",
    vTokenAddress: "0x0131cc09160f144ec5880a0bc1a0633999030fa6a546388b5d0667cb171a52a0",
    vTokenSymbol: "vWBTC-Re7xBTC",
  },
  PRIME: {
    id: "0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5",
    name: "Prime",
    vTokenAddress: "0x04ecb0667140b9f45b067d026953ed79f22723f1cfac05a7b26c3ac06c88f56c",
    vTokenSymbol: "vWBTC",
  },
  RE7_USDC_CORE: {
    id: "0x03976cac265a12609934089004df458ea29c776d77da423c96dc761d09d24124",
    name: "Re7 USDC Core",
  },
} as const;

export const NOSTRA = {
  WBTC_SUPPLY_TOKEN: "0x0735d0f09a4e8bf8a17005fa35061b5957dcaa56889fc75df9e94530ff6991ea",
  IWBTC_C: "0x05b7d301fa769274f20e89222169c0fad4d846c366440afc160aafadd6f88f0c",
  DUSDC: "0x063d69ae657bd2f40337c39bf35a870ac27ddf91e6623c2f52529db4c1619a51",
  CDP_MANAGER: "0x073f6addc9339de9822cab4dac8c9431779c09077f02ba7bc36904ea342dd9eb",
} as const;

export const PRAGMA_ORACLE = "0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b" as const;

export const DEFILLAMA_POOL_IDS = {
  EKUBO_WBTC_ETH: "d7fd5fb4-df43-4070-9936-0fd6f4ef838c",
  EKUBO_USDC_WBTC: "cbe54b27-0445-421f-836c-8cfe66417839",
  EKUBO_LBTC_WBTC: "c081f909-9fd1-4070-930d-ac93fc58d49e",
  NOSTRA_WBTC: "5b32abf1-deaf-4c98-9afc-8a1934632ed3",
  TROVES_WBTC_ETH: "756f1ae5-40ac-4d1b-b6f0-f1b05214f5c0",
  TROVES_XWBTC: "162f89ec-cf47-4ec9-81ee-8a68c3607827",
  ENDUR_WBTC: "867e3e6b-4ebb-46fd-92d5-4d4afbf28553",
} as const;

export const PROTOCOLS = {
  VESU: { name: "Vesu", url: "https://vesu.xyz" },
  EKUBO: { name: "Ekubo", url: "https://ekubo.org" },
  NOSTRA: { name: "Nostra", url: "https://nostra.finance" },
  TROVES: { name: "Troves", url: "https://troves.fi" },
  ENDUR: { name: "Endur", url: "https://endur.fi" },
  AVNU: {
    name: "AVNU",
    router: "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f",
    url: "https://avnu.fi",
  },
} as const;

export const VAULT_STRATEGIES = {
  LENDING: "lending",
  DUAL_LENDING: "dual_lending",
  LP_PROVISION: "lp_provision",
  DELTA_NEUTRAL: "delta_neutral",
  LEVERAGE_LOOP: "leverage_loop",
  MULTI_STRATEGY: "multi_strategy",
} as const;

export type VaultStrategy = (typeof VAULT_STRATEGIES)[keyof typeof VAULT_STRATEGIES];

export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export const RISK_LABELS: Record<RiskLevel, { label: string; color: string }> = {
  1: { label: "Low", color: "text-up" },
  2: { label: "Low-Med", color: "text-up" },
  3: { label: "Medium", color: "text-caution" },
  4: { label: "Med-High", color: "text-btc" },
  5: { label: "High", color: "text-down" },
};

export const SABLE_CLASS_HASH = "0x3c755fb30eae32c0f98cb2cd85f65dfa7ff384b356dd5069e3e519afe47ec2a" as const;

export const SABLE_CONTRACTS = {
  SENTINEL: "0x04ec7fdb1679450fb88eae9facc439a46be4ddeba628211e269a7467f6e0971b",
  CITADEL: "0x077ad8d0fe4b946cedc02eb8eb61a64e85bcde802a83e879e8c68fed8b9b130e",
  TRIDENT: "0x058aadc9db62700de03d89a7c8f2952851d94e75f854cc6a340ef92d00cd3fb8",
  DELTA_NEUTRAL: "0x06c8779ee7ed14b35ac5c6eae5dc721cc3e8104a65ffef4b5252babc407a1012",
  TURBO: "0x05f3d02005027296ccfb90574544b941d9ddc55c673e6fe0e92cb6f07e68d1f7",
  APEX: "0x071eb7fc3a912c0ee85b1dc795e29fd77ff4203a33384a1171dd4fcb7c7b3df9",
  DCA: "0x730f5de50171590132ff9238859d7eccbfa8359393f52083b3b88b397955e56",
  STABLECOIN_VAULT: "0x070fc554c4a9714646c5f53aea26611a70c529133a34c00f2b8f95fd2cba742d",
  CDP: "0x042f0f1cbb5ce44cc411f608d3c8295f3816ef7c3b6764cd6e46463efc7ca499",
} as const;

export const SABLE_CONTRACT = {
  address: SABLE_CONTRACTS.TURBO,
  classHash: SABLE_CLASS_HASH,
} as const;

export const VESU_SINGLETON = "0x000d8d6dfec4d33bfb6895de9f3852143a17c6f92fd2a21da3d6924d34870160" as const;

// Shielded Pools V1 (Legacy — Noir + UltraHonk)
export const SHIELDED_POOLS: Record<string, { pool: string; verifier: string }> = {
  [SABLE_CONTRACTS.SENTINEL]: {
    pool: "0x0537ad6730ab2ab564079a4e98f2f9d707a21d7dc0806dfd621bc93f4af6c39f",
    verifier: "0x552f7face7fd100af4fd75f0c1fd8c93d2cb631bc07ac7c7d37d9cd5c0876a3",
  },
} as const;

// Shielded Pools V2 (Groth16 + Fixed Denominations + Relayer) — Legacy
// Each denomination has its own pool with separate Merkle tree
export const SHIELDED_POOLS_V2: Record<string, {
  pool: string;
  verifier: string;
  denomination: bigint;
  label: string;
}> = {
  "0.01": {
    pool: "0x070d99342c0507a124e899352f2c3faf000da97c556ab07d1999d1a1bf9eb77a",
    verifier: "0x07ad0b9a096288194851294b09b3839f506d36a700ff91db7942e5a5e838eb5f",
    denomination: BigInt(1_000_000),   // 0.01 WBTC = 1,000,000 sats
    label: "0.01 WBTC",
  },
};

// Shared V3 Groth16 Verifier (6 public inputs, all pools use same circuit)
export const GROTH16_VERIFIER_V3 = "0x041011d7912b6759f2fe3cc66a1f746b81ec012c2774adabc77eecc299e0878d" as const;

// Shielded Pools V3 (Per-Vault Pools + Batched Deposits + Fair Yield)
// Each vault gets its own pool with denomination matching vault min_deposit
export const SHIELDED_POOLS_V3: Record<string, {
  pool: string;
  verifier: string;
  denomination: bigint;
  batchSize: number;
  label: string;
  vaultId: string;
  vaultAddress: string;
  deployBlock: number;
}> = {
  sentinel: {
    pool: "0x04d2c7aa4f2fe04a228821b7563842651d51691cda0c0ade44d48ce608172706",
    verifier: GROTH16_VERIFIER_V3,
    denomination: BigInt(20_000),
    batchSize: 3,
    label: "Sentinel",
    vaultId: "sentinel",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7284000,
  },
};

// Shared V4 Groth16 Verifier (7 public inputs: root, nullifierHash, recipient, relayer, fee, batchStart, batchSize)
// Deployed after garaga gen with V4 verification key
export const GROTH16_VERIFIER_V4 = "0x03329c4d5c2e37dfd20d46c3c20be9230b2152c71947ead441c342d989d52ffa" as const;

// Shielded Pools V4 (Auto-Deploy + Multiple Denominations)
// Each denomination gets its own pool. Batches of 3 auto-deployed on deposit.
export const SHIELDED_POOLS_V4: Record<string, {
  pool: string;
  verifier: string;
  denomination: bigint;
  label: string;
  vaultId: string;
  vaultAddress: string;
  deployBlock: number;
}> = {
  sentinel_1x: {
    pool: "0x002bdb9769851d0307e812351cc1eb31b617951fba786cfd5d58baff36589a33",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(20_000),   // 0.0002 BTC
    label: "0.0002 BTC",
    vaultId: "sentinel",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7298400,
  },
  sentinel_2x: {
    pool: "0x02a94630f46bcf7362c12ed5b0163b4dd7644eb923aaada61ffb858d7912e03d",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(40_000),   // 0.0004 BTC
    label: "0.0004 BTC",
    vaultId: "sentinel",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7298400,
  },
  sentinel_3x: {
    pool: "0x038224d3966b850913cfc4dd610032d8082e14c90fce91819a0fb994b1cc63f3",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(60_000),   // 0.0006 BTC
    label: "0.0006 BTC",
    vaultId: "sentinel",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7298400,
  },
  sentinel_4x: {
    pool: "0x06de0d6c46431628f0cd257aa4384125b2380a7c5362aab2b146283181c2dff3",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(80_000),   // 0.0008 BTC
    label: "0.0008 BTC",
    vaultId: "sentinel",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7298400,
  },
};

// Shielded Pools V4 — Delta Neutral (Private Yield on Stables)
// Base = min_deposit(30,081) × 1.2 = 36,000 sats, then ×1, ×2, ×3, ×4
// Pools TBD — will be deployed with same V4 verifier + class hash
export const SHIELDED_POOLS_V4_DN: Record<string, {
  pool: string;
  verifier: string;
  denomination: bigint;
  label: string;
  vaultId: string;
  vaultAddress: string;
  deployBlock: number;
}> = {
  dn_1x: {
    pool: "0x07298d2765e1dc61dae0f5d8c70b86e1857b038ab7a1f7c473111321aaac51aa",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(36_000),   // 0.00036 BTC
    label: "0.00036 BTC",
    vaultId: "delta-neutral",
    vaultAddress: SABLE_CONTRACTS.DELTA_NEUTRAL,
    deployBlock: 7300786,
  },
  dn_2x: {
    pool: "0x059511116f7e1877fc9e3d26a2b9165d02cc367414c009c94b7b76f6d1e4c929",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(72_000),   // 0.00072 BTC
    label: "0.00072 BTC",
    vaultId: "delta-neutral",
    vaultAddress: SABLE_CONTRACTS.DELTA_NEUTRAL,
    deployBlock: 7300786,
  },
  dn_3x: {
    pool: "0x01191727f6135bb878e9771066b0c6bcc18faed9146eb0a04eabb83190b90ce3",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(108_000),  // 0.00108 BTC
    label: "0.00108 BTC",
    vaultId: "delta-neutral",
    vaultAddress: SABLE_CONTRACTS.DELTA_NEUTRAL,
    deployBlock: 7300786,
  },
  dn_4x: {
    pool: "0x040babfa49b967c7873e3b275b7f8d6bea88028854f5b5923c2de5af76d78c56",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(144_000),  // 0.00144 BTC
    label: "0.00144 BTC",
    vaultId: "delta-neutral",
    vaultAddress: SABLE_CONTRACTS.DELTA_NEUTRAL,
    deployBlock: 7300786,
  },
};

// Shielded Pools V4 — Swap Input (Dedicated pools for Private Swap deposits)
// Same denominations as Sentinel, same V4 class hash, but vaultId="swap" to segregate
export const SHIELDED_POOLS_V4_SWAP: Record<string, {
  pool: string;
  verifier: string;
  denomination: bigint;
  label: string;
  vaultId: string;
  vaultAddress: string;
  deployBlock: number;
}> = {
  swap_1x: {
    pool: "0x0a9ca1d554d7ef360e47de70f89fefcb571b568c8dd049de96fa181e1c69c60",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(20_000),   // 0.0002 BTC
    label: "0.0002 BTC",
    vaultId: "swap",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7338400,
  },
  swap_2x: {
    pool: "0x06729a96665ddffa05443774414e550d95d473e87874b273f2ed7ae03bda5dca",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(40_000),   // 0.0004 BTC
    label: "0.0004 BTC",
    vaultId: "swap",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7338400,
  },
  swap_3x: {
    pool: "0x07f6e657c2cbe03a233890a7cda6d65f8d7dec65b7973ea9f3ef1f7307ffe1d8",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(60_000),   // 0.0006 BTC
    label: "0.0006 BTC",
    vaultId: "swap",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7338400,
  },
  swap_4x: {
    pool: "0x01046244f84287eaa49b06263739ac21a26b9e144db4e6799f571e0ce4141c46",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(80_000),   // 0.0008 BTC
    label: "0.0008 BTC",
    vaultId: "swap",
    vaultAddress: SABLE_CONTRACTS.SENTINEL,
    deployBlock: 7338400,
  },
};

// Shielded Pools V4 — Stablecoin (Private Yield on USDC via Vesu RE7 USDC Core)
// USDC denominations: 10, 25, 50, 100 USDC. Same V4 circuit + verifier, vaultId="stables"
export const SHIELDED_POOLS_V4_STABLE: Record<string, {
  pool: string;
  verifier: string;
  denomination: bigint;
  label: string;
  vaultId: string;
  vaultAddress: string;
  deployBlock: number;
}> = {
  stable_10: {
    pool: "0x04f4af2cf01a1cf28f424ce2ce3d7fed7f11792c88e5ce7a3eedd21cea24a5eb",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(10_000_000),   // 10 USDC
    label: "10 USDC",
    vaultId: "stables",
    vaultAddress: SABLE_CONTRACTS.STABLECOIN_VAULT,
    deployBlock: 7342460,
  },
  stable_25: {
    pool: "0x05aa66a4541caf4d43a526edd89c0285a671e0be0024ae5f8ca9f6734f4b7c89",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(25_000_000),   // 25 USDC
    label: "25 USDC",
    vaultId: "stables",
    vaultAddress: SABLE_CONTRACTS.STABLECOIN_VAULT,
    deployBlock: 7342460,
  },
  stable_50: {
    pool: "0x03226cbb8976f41eddf88c2871cf4d04653a1b6415dee7037a1ceaf641e977a9",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(50_000_000),   // 50 USDC
    label: "50 USDC",
    vaultId: "stables",
    vaultAddress: SABLE_CONTRACTS.STABLECOIN_VAULT,
    deployBlock: 7342460,
  },
  stable_100: {
    pool: "0x06348e9e2db703841bed848146ef895c8aed4f3c143e76bd145d9b3c544cea68",
    verifier: GROTH16_VERIFIER_V4,
    denomination: BigInt(100_000_000),  // 100 USDC
    label: "100 USDC",
    vaultId: "stables",
    vaultAddress: SABLE_CONTRACTS.STABLECOIN_VAULT,
    deployBlock: 7342460,
  },
};

// Shielded Swap Pool — Private token swaps (pool-to-pool)
// Reuses V4 Groth16 verifier, each deposit is a "batch of 1"
export const SHIELDED_SWAP_POOL = {
  address: "0x059abf82e0bc584a3b4e94fcc5aa4b5f7e9ea946b5fbe236cdecf491ad0b2c72",
  verifier: GROTH16_VERIFIER_V4,
  deployBlock: 7432000,
} as const;

export const SWAP_OUTPUT_TOKENS = [TOKENS.ETH, TOKENS.USDC, TOKENS.STRK] as const;

export const VOYAGER_BASE = "https://voyager.online";
export const STARKSCAN_BASE = "https://starkscan.co";

// ═══════════════════════════════════════════════════════
// SABLE V2 — UTXO Privacy Pool Configuration
// ═══════════════════════════════════════════════════════

// Groth16 verifier for V5 UTXO circuit (8 public signals, depth 20)
export const GROTH16_VERIFIER_V5 = "0x4d9b64950154d0287290c17ecd9b32e145b097f907685a1594692acf2d5e60e" as const;

// V5 UTXO Privacy Pool (unified transact function)
export const SHIELDED_POOL_V5 = {
  address: "0x0a8b17a3dab4f3721457c53f0c77a50feffed4c3439d786a9e6931787727343",
  verifier: GROTH16_VERIFIER_V5,
  vaultAddress: SABLE_CONTRACTS.SENTINEL,
  asset: TOKENS.WBTC.address,
  deployBlock: 8332300,
  maxDeposit: 1_000_000, // 0.01 BTC in sats
  minDeposit: 1_000,     // 0.00001 BTC in sats
} as const;

// Stealth Address Registry
export const STEALTH_REGISTRY = "0x4d92ec179fb61372b5cce17600bb9730d4672138dd89297fa7b55bb570bc01c" as const;

// Association Set Provider Registry
export const ASP_REGISTRY = "0x28710c0f81594d75e3a4ed46ce13a151a03f1e37618245db2ed7e590e4446a2" as const;

// Curator / Relayer address (pays gas for privacy transactions)
export const CURATOR_ADDRESS = "0x0007842590942b769a203cfcb07540299b86e22ba05b6708b516ec04ca044ef7" as const;
