pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "./merkle_proof.circom";
include "./keypair.circom";

template Transaction(levels) {
    signal input root;
    signal input subsetRoot;
    signal input publicAmount;
    signal input extDataHash;

    signal output inputNullifier[2];
    signal output outputCommitment[2];

    signal input inAmount[2];
    signal input inPrivateKey[2];
    signal input inBlinding[2];
    signal input inPathIndices[2];
    signal input inPathElements[2][levels];
    signal input inSubsetPathElements[2][levels];
    signal input inSubsetPathIndices[2];

    signal input outAmount[2];
    signal input outPubkey[2];
    signal input outBlinding[2];

    component inKeypair[2];
    component inAmountCheck[2];
    component inCommitInner[2];
    component inCommitOuter[2];
    component inSig[2];
    component inNullInner[2];
    component inNullOuter[2];
    component inTree[2];
    component inSubsetTree[2];
    component inCheckRoot[2];
    component inCheckSubsetRoot[2];

    var sumIns = 0;

    for (var i = 0; i < 2; i++) {
        inAmountCheck[i] = Num2Bits(248);
        inAmountCheck[i].in <== inAmount[i];

        inKeypair[i] = Keypair();
        inKeypair[i].privateKey <== inPrivateKey[i];

        inCommitInner[i] = Poseidon(2);
        inCommitInner[i].inputs[0] <== inAmount[i];
        inCommitInner[i].inputs[1] <== inKeypair[i].publicKey;

        inCommitOuter[i] = Poseidon(2);
        inCommitOuter[i].inputs[0] <== inCommitInner[i].out;
        inCommitOuter[i].inputs[1] <== inBlinding[i];

        inSig[i] = Signature();
        inSig[i].privateKey <== inPrivateKey[i];
        inSig[i].commitment <== inCommitOuter[i].out;
        inSig[i].merklePath <== inPathIndices[i];

        inNullInner[i] = Poseidon(2);
        inNullInner[i].inputs[0] <== inCommitOuter[i].out;
        inNullInner[i].inputs[1] <== inPathIndices[i];

        inNullOuter[i] = Poseidon(2);
        inNullOuter[i].inputs[0] <== inNullInner[i].out;
        inNullOuter[i].inputs[1] <== inSig[i].out;

        inputNullifier[i] <== inNullOuter[i].out;

        inTree[i] = MerkleProof(levels);
        inTree[i].leaf <== inCommitOuter[i].out;
        inTree[i].pathIndices <== inPathIndices[i];
        for (var j = 0; j < levels; j++) {
            inTree[i].pathElements[j] <== inPathElements[i][j];
        }

        inCheckRoot[i] = ForceEqualIfEnabled();
        inCheckRoot[i].in[0] <== root;
        inCheckRoot[i].in[1] <== inTree[i].root;
        inCheckRoot[i].enabled <== inAmount[i];

        inSubsetTree[i] = MerkleProof(levels);
        inSubsetTree[i].leaf <== inCommitOuter[i].out;
        inSubsetTree[i].pathIndices <== inSubsetPathIndices[i];
        for (var j = 0; j < levels; j++) {
            inSubsetTree[i].pathElements[j] <== inSubsetPathElements[i][j];
        }

        inCheckSubsetRoot[i] = ForceEqualIfEnabled();
        inCheckSubsetRoot[i].in[0] <== subsetRoot;
        inCheckSubsetRoot[i].in[1] <== inSubsetTree[i].root;
        inCheckSubsetRoot[i].enabled <== inAmount[i];

        sumIns += inAmount[i];
    }

    component outCommitInner[2];
    component outCommitOuter[2];
    component outAmountCheck[2];

    var sumOuts = 0;

    for (var i = 0; i < 2; i++) {
        outCommitInner[i] = Poseidon(2);
        outCommitInner[i].inputs[0] <== outAmount[i];
        outCommitInner[i].inputs[1] <== outPubkey[i];

        outCommitOuter[i] = Poseidon(2);
        outCommitOuter[i].inputs[0] <== outCommitInner[i].out;
        outCommitOuter[i].inputs[1] <== outBlinding[i];

        outputCommitment[i] <== outCommitOuter[i].out;

        outAmountCheck[i] = Num2Bits(248);
        outAmountCheck[i].in <== outAmount[i];

        sumOuts += outAmount[i];
    }

    component sameNullifiers = IsEqual();
    sameNullifiers.in[0] <== inputNullifier[0];
    sameNullifiers.in[1] <== inputNullifier[1];
    sameNullifiers.out === 0;

    sumIns + publicAmount === sumOuts;

    signal extDataSquare <== extDataHash * extDataHash;
}

component main {public [root, subsetRoot, publicAmount, extDataHash]} = Transaction(20);
