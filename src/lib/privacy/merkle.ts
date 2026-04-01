import { poseidonHash2 } from "./keypair";

export const TREE_DEPTH = 20;

export interface MerkleProof {
  pathElements: string[];
  pathIndices: number;
  root: string;
}

let zeroValues: bigint[] | null = null;

async function getZeroValues(): Promise<bigint[]> {
  if (zeroValues) return zeroValues;
  zeroValues = [BigInt(0)];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    zeroValues[i] = await poseidonHash2(zeroValues[i - 1], zeroValues[i - 1]);
  }
  return zeroValues;
}

export class IncrementalMerkleTree {
  private depth: number;
  private leaves: bigint[] = [];
  private filledSubtrees: bigint[] = [];
  private currentRoot: bigint = BigInt(0);
  private zeros: bigint[] = [];

  private constructor(depth: number, zeros: bigint[]) {
    this.depth = depth;
    this.zeros = zeros;
    this.filledSubtrees = zeros.slice(0, depth);
    this.currentRoot = zeros[depth];
  }

  static async create(depth: number = TREE_DEPTH): Promise<IncrementalMerkleTree> {
    const zeros = await getZeroValues();
    return new IncrementalMerkleTree(depth, zeros);
  }

  get root(): string {
    return "0x" + this.currentRoot.toString(16);
  }

  get size(): number {
    return this.leaves.length;
  }

  async insert(leaf: bigint): Promise<number> {
    const index = this.leaves.length;
    this.leaves.push(leaf);

    let currentHash = leaf;
    let currentIndex = index;

    for (let level = 0; level < this.depth; level++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[level] = currentHash;
        currentHash = await poseidonHash2(currentHash, this.zeros[level]);
      } else {
        currentHash = await poseidonHash2(this.filledSubtrees[level], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }

    this.currentRoot = currentHash;
    return index;
  }

  async buildFromLeaves(commitments: bigint[]): Promise<void> {
    this.leaves = [];
    const zeros = await getZeroValues();
    this.filledSubtrees = zeros.slice(0, this.depth);

    for (const c of commitments) {
      await this.insert(c);
    }
  }

  async getProof(leafIndex: number): Promise<MerkleProof> {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range (0..${this.leaves.length - 1})`);
    }

    const layers = await this.buildLayers();
    const pathElements: string[] = [];

    let idx = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      const sibling = siblingIdx < layers[level].length
        ? layers[level][siblingIdx]
        : this.zeros[level];
      pathElements.push("0x" + sibling.toString(16));
      idx = Math.floor(idx / 2);
    }

    return {
      pathElements,
      pathIndices: leafIndex,
      root: this.root,
    };
  }

  private async buildLayers(): Promise<bigint[][]> {
    const layers: bigint[][] = [];

    const paddedLeaves = [...this.leaves];
    layers.push(paddedLeaves);

    for (let level = 0; level < this.depth; level++) {
      const currentLayer = layers[level];
      const nextLayer: bigint[] = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : this.zeros[level];
        nextLayer.push(await poseidonHash2(left, right));
      }

      if (nextLayer.length === 0) {
        nextLayer.push(this.zeros[level + 1]);
      }

      layers.push(nextLayer);
    }

    return layers;
  }
}

export async function buildTreeFromEvents(
  events: Array<{ commitment: string; leafIndex: number }>
): Promise<IncrementalMerkleTree> {
  const tree = await IncrementalMerkleTree.create(TREE_DEPTH);

  const sorted = [...events].sort((a, b) => a.leafIndex - b.leafIndex);

  let nextExpected = 0;
  for (const evt of sorted) {
    while (nextExpected < evt.leafIndex) {
      await tree.insert(BigInt(0));
      nextExpected++;
    }
    await tree.insert(BigInt(evt.commitment));
    nextExpected++;
  }

  return tree;
}
