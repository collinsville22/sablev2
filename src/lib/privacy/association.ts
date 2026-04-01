import { IncrementalMerkleTree, TREE_DEPTH } from "./merkle";

export async function buildPermissiveSubsetTree(
  mainTreeCommitments: bigint[]
): Promise<IncrementalMerkleTree> {
  const tree = await IncrementalMerkleTree.create(TREE_DEPTH);
  await tree.buildFromLeaves(mainTreeCommitments);
  return tree;
}

export async function buildFilteredSubsetTree(
  allCommitments: bigint[],
  excludedIndices: Set<number>
): Promise<IncrementalMerkleTree> {
  const tree = await IncrementalMerkleTree.create(TREE_DEPTH);

  const filteredCommitments = allCommitments.map((c, i) =>
    excludedIndices.has(i) ? BigInt(0) : c
  );

  await tree.buildFromLeaves(filteredCommitments);
  return tree;
}

export async function fetchASPCommitments(
  aspEndpoint: string = "/api/asp"
): Promise<bigint[]> {
  const res = await fetch(aspEndpoint);
  if (!res.ok) throw new Error("Failed to fetch ASP data");
  const data = await res.json();
  return (data.commitments as string[]).map((c: string) => BigInt(c));
}

export async function fetchASPRoot(
  aspEndpoint: string = "/api/asp"
): Promise<string> {
  const res = await fetch(`${aspEndpoint}?root=true`);
  if (!res.ok) throw new Error("Failed to fetch ASP root");
  const data = await res.json();
  return data.root;
}
