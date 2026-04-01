declare module "circomlibjs" {
  export function buildPoseidon(): Promise<{
    (inputs: (bigint | number | string)[]): Uint8Array;
    F: { toObject: (v: Uint8Array) => bigint };
  }>;
}

declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: Record<string, unknown>; publicSignals: string[] }>;
    verify(
      vk: Record<string, unknown>,
      publicSignals: string[],
      proof: Record<string, unknown>
    ): Promise<boolean>;
  };
}

declare module "garaga" {
  export function init(): Promise<void>;
  export function getGroth16CallData(
    proof: Groth16Proof,
    vk: Groth16VK,
    curveId: CurveId
  ): bigint[];

  export interface G1Point {
    x: bigint;
    y: bigint;
    curveId: CurveId;
  }

  export interface G2Point {
    x: [bigint, bigint];
    y: [bigint, bigint];
    curveId: CurveId;
  }

  export interface Groth16Proof {
    a: G1Point;
    b: G2Point;
    c: G1Point;
    publicInputs: bigint[];
  }

  export interface Groth16VK {
    alpha: G1Point;
    beta: G2Point;
    gamma: G2Point;
    delta: G2Point;
    ic: G1Point[];
  }

  export enum CurveId {
    BN254 = 0,
    BLS12_381 = 1,
  }
}

declare module "tweetnacl" {
  export const box: {
    (message: Uint8Array, nonce: Uint8Array, theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array | null;
    open(box: Uint8Array, nonce: Uint8Array, theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array | null;
    keyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  };
  export const scalarMult: {
    (n: Uint8Array, p: Uint8Array): Uint8Array;
    base(n: Uint8Array): Uint8Array;
  };
  export function randomBytes(n: number): Uint8Array;
}
