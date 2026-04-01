"use client";

import { useState, useCallback, useMemo } from "react";
import { useAccount } from "@starknet-react/core";
import { type Keypair, encryptNote, poseidonHash2 } from "@/lib/privacy/keypair";
import { createNote, createDummyNote, loadNotes, saveNotes, getUnspentNotes, markNoteSpent, type UTXONote } from "@/lib/privacy/utxo";
import { buildTreeFromEvents, IncrementalMerkleTree } from "@/lib/privacy/merkle";
import { generateTransactionProof, fetchRelayerFee } from "@/lib/privacy/prover";
import { generateVerifyCalldata } from "@/lib/privacy/calldata";
import { buildPermissiveSubsetTree } from "@/lib/privacy/association";

const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

interface TransactStatus {
  step: "idle" | "approving" | "proving" | "submitting" | "done" | "error";
  message: string;
}

export function useShieldedPoolV5(poolAddress: string, keypair: Keypair | null) {
  const { address, account } = useAccount();
  const [status, setStatus] = useState<TransactStatus>({ step: "idle", message: "" });

  const notes = useMemo(() => (keypair ? getUnspentNotes() : []), [keypair]);
  const balance = useMemo(
    () => notes.reduce((sum, n) => sum + n.amount, BigInt(0)),
    [notes]
  );

  const deposit = useCallback(
    async (satsAmount: bigint, assetAddress: string) => {
      if (!keypair || !address || !account) throw new Error("Keypair or wallet not ready");

      setStatus({ step: "approving", message: "Approve WBTC transfer..." });

      await account.execute([
        {
          contractAddress: assetAddress,
          entrypoint: "approve",
          calldata: [poolAddress, satsAmount.toString(), "0"],
        },
      ]);

      setStatus({ step: "proving", message: "Generating ZK proof (~15s)..." });

      const outputNote = await createNote(satsAmount, keypair.spendingPubkey);
      const dummyOutput = await createDummyNote(keypair.spendingPubkey);

      const dummyInput0 = await createDummyNote(keypair.spendingPubkey);
      const dummyInput1 = await createDummyNote(keypair.spendingPubkey);
      dummyInput0.index = 0;
      dummyInput1.index = 1;

      const poolStatusRes = await fetch(`/api/relayer/pool-status?pool=${poolAddress}`);
      const poolStatus = await poolStatusRes.json();
      const onChainRoot = poolStatus.root || "0x0";

      const mainTree = await IncrementalMerkleTree.create();
      const subsetTree = await IncrementalMerkleTree.create();
      (mainTree as unknown as { currentRoot: bigint }).currentRoot = BigInt(onChainRoot);
      (subsetTree as unknown as { currentRoot: bigint }).currentRoot = BigInt(onChainRoot);

      const fee = BigInt(0);
      const extDataHash = await poseidonHash2(
        BigInt(address),
        satsAmount + fee
      );

      const { proof, publicSignals } = await generateTransactionProof({
        inputs: [dummyInput0, dummyInput1],
        outputs: [outputNote, dummyOutput],
        keypair,
        mainTree,
        subsetTree,
        publicAmount: satsAmount,
        extDataHash: extDataHash.toString(),
      });

      const calldata = await generateVerifyCalldata(proof, publicSignals);

      setStatus({ step: "submitting", message: "Submitting to relayer..." });

      const enc0 = encryptNote(keypair.viewingPubkey, outputNote.amount, BigInt(outputNote.blinding));
      const enc1 = encryptNote(keypair.viewingPubkey, BigInt(0), BigInt(dummyOutput.blinding));

      const res = await fetch("/api/relayer/transact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolAddress,
          calldata,
          recipient: "0x0",
          relayer: "0x0",
          fee: "0",
          extAmount: satsAmount.toString(),
          extDataHash: extDataHash.toString(),
          encryptedOutput0: Array.from(enc0.encrypted).map((b) => "0x" + b.toString(16)),
          encryptedOutput1: Array.from(enc1.encrypted).map((b) => "0x" + b.toString(16)),
          ephemeralPubkey0: "0x" + Array.from(enc0.ephemeralPubkey).map(b => b.toString(16).padStart(2, "0")).join(""),
          ephemeralPubkey1: "0x" + Array.from(enc1.ephemeralPubkey).map(b => b.toString(16).padStart(2, "0")).join(""),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Relayer submission failed");
      }

      const allNotes = loadNotes();
      allNotes.push(outputNote);
      saveNotes(allNotes);

      setStatus({ step: "done", message: "Deposit complete!" });
    },
    [keypair, address, account, poolAddress]
  );

  const withdraw = useCallback(
    async (satsAmount: bigint, recipientAddress: string) => {
      if (!keypair) throw new Error("Keypair not ready");

      setStatus({ step: "proving", message: "Selecting notes and generating proof..." });

      const unspent = getUnspentNotes();
      const selected = selectNotes(unspent, satsAmount);
      if (!selected) throw new Error("Insufficient shielded balance");

      const [input0, input1] = selected.inputs;
      const changeAmount = selected.totalAmount - satsAmount;

      const changeNote = changeAmount > BigInt(0)
        ? await createNote(changeAmount, keypair.spendingPubkey)
        : await createDummyNote(keypair.spendingPubkey);
      const dummyOutput = await createDummyNote(keypair.spendingPubkey);

      const eventsRes = await fetch(`/api/relayer/pool-status?pool=${poolAddress}&events=true`);
      const eventsData = await eventsRes.json();
      const commitmentEvents = (eventsData.commitments || []).map(
        (c: { commitment: string; leafIndex: number }) => ({
          commitment: c.commitment,
          leafIndex: c.leafIndex,
        })
      );
      const mainTree = await buildTreeFromEvents(commitmentEvents);
      const subsetTree = await buildTreeFromEvents(commitmentEvents);

      const { feeSats } = await fetchRelayerFee(poolAddress);
      const fee = BigInt(feeSats);
      const wrappedAmount = FIELD_SIZE - satsAmount;

      const extDataHash = await poseidonHash2(
        BigInt(recipientAddress),
        satsAmount + fee
      );

      const { proof, publicSignals } = await generateTransactionProof({
        inputs: [input0, input1],
        outputs: [changeNote, dummyOutput],
        keypair,
        mainTree,
        subsetTree,
        publicAmount: -satsAmount - fee,
        extDataHash: extDataHash.toString(),
      });

      const calldata = await generateVerifyCalldata(proof, publicSignals);

      setStatus({ step: "submitting", message: "Submitting withdrawal..." });

      const enc0 = encryptNote(keypair.viewingPubkey, changeNote.amount, BigInt(changeNote.blinding));
      const enc1 = encryptNote(keypair.viewingPubkey, BigInt(0), BigInt(dummyOutput.blinding));

      const res = await fetch("/api/relayer/transact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolAddress,
          calldata,
          recipient: recipientAddress,
          relayer: "0x0",
          fee: fee.toString(),
          extAmount: wrappedAmount.toString(),
          extDataHash: extDataHash.toString(),
          encryptedOutput0: Array.from(enc0.encrypted).map((b) => "0x" + b.toString(16)),
          encryptedOutput1: Array.from(enc1.encrypted).map((b) => "0x" + b.toString(16)),
          ephemeralPubkey0: "0x" + Array.from(enc0.ephemeralPubkey).map(b => b.toString(16).padStart(2, "0")).join(""),
          ephemeralPubkey1: "0x" + Array.from(enc1.ephemeralPubkey).map(b => b.toString(16).padStart(2, "0")).join(""),
        }),
      });

      if (!res.ok) throw new Error("Withdrawal failed");

      markNoteSpent(input0.commitment);
      markNoteSpent(input1.commitment);
      if (changeAmount > BigInt(0)) {
        const allNotes = loadNotes();
        allNotes.push(changeNote);
        saveNotes(allNotes);
      }

      setStatus({ step: "done", message: "Withdrawal complete!" });
    },
    [keypair, poolAddress]
  );

  return {
    notes,
    balance,
    status,
    deposit,
    withdraw,
    resetStatus: () => setStatus({ step: "idle", message: "" }),
  };
}

function selectNotes(
  unspent: UTXONote[],
  target: bigint
): { inputs: [UTXONote, UTXONote]; totalAmount: bigint } | null {
  const sorted = [...unspent].sort((a, b) =>
    b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0
  );

  for (const note of sorted) {
    if (note.amount >= target) {
      const dummy: UTXONote = {
        amount: BigInt(0), pubkey: note.pubkey, blinding: "0x0",
        commitment: "0x0", index: 0, spent: false,
      };
      return { inputs: [note, dummy], totalAmount: note.amount };
    }
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const total = sorted[i].amount + sorted[j].amount;
      if (total >= target) {
        return { inputs: [sorted[i], sorted[j]], totalAmount: total };
      }
    }
  }

  return null;
}
