import { init, getGroth16CallData, CurveId } from "garaga";

const VK_PATH = "/circuits-v5/verification_key.json";

let initialized = false;
let cachedVK: Record<string, unknown> | null = null;

async function ensureInit() {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

async function loadVK(): Promise<Record<string, unknown>> {
  if (cachedVK) return cachedVK;
  const res = await fetch(VK_PATH);
  if (!res.ok) throw new Error(`Failed to load verification key from ${VK_PATH}`);
  cachedVK = await res.json();
  return cachedVK!;
}

function g1(x: string, y: string, curveId: typeof CurveId.BN254) {
  return { x: BigInt(x), y: BigInt(y), curveId };
}

function g2(
  x0: string, x1: string, y0: string, y1: string,
  curveId: typeof CurveId.BN254
) {
  return { x: [BigInt(x0), BigInt(x1)] as [bigint, bigint], y: [BigInt(y0), BigInt(y1)] as [bigint, bigint], curveId };
}

function convertVK(vk: Record<string, unknown>) {
  const alpha1 = vk.vk_alpha_1 as string[];
  const beta2 = vk.vk_beta_2 as string[][];
  const gamma2 = vk.vk_gamma_2 as string[][];
  const delta2 = vk.vk_delta_2 as string[][];
  const IC = vk.IC as string[][];

  return {
    alpha: g1(alpha1[0], alpha1[1], CurveId.BN254),
    beta: g2(beta2[0][0], beta2[0][1], beta2[1][0], beta2[1][1], CurveId.BN254),
    gamma: g2(gamma2[0][0], gamma2[0][1], gamma2[1][0], gamma2[1][1], CurveId.BN254),
    delta: g2(delta2[0][0], delta2[0][1], delta2[1][0], delta2[1][1], CurveId.BN254),
    ic: IC.map((point: string[]) => g1(point[0], point[1], CurveId.BN254)),
  };
}

function convertProof(
  proof: Record<string, unknown>,
  publicSignals: string[]
) {
  const piA = proof.pi_a as string[];
  const piB = proof.pi_b as string[][];
  const piC = proof.pi_c as string[];

  return {
    a: g1(piA[0], piA[1], CurveId.BN254),
    b: g2(piB[0][0], piB[0][1], piB[1][0], piB[1][1], CurveId.BN254),
    c: g1(piC[0], piC[1], CurveId.BN254),
    publicInputs: publicSignals.map((s) => BigInt(s)),
  };
}

export async function generateVerifyCalldata(
  proof: Record<string, unknown>,
  publicSignals: string[]
): Promise<string[]> {
  await ensureInit();
  const vk = await loadVK();

  const garagaVK = convertVK(vk);
  const garagaProof = convertProof(proof, publicSignals);

  const calldata: bigint[] = getGroth16CallData(garagaProof, garagaVK, CurveId.BN254);

  return calldata.map((v) => "0x" + v.toString(16));
}
