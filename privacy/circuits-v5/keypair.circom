pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";

template Keypair() {
    signal input privateKey;
    signal output publicKey;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== privateKey;
    publicKey <== hasher.out;
}

template Signature() {
    signal input privateKey;
    signal input commitment;
    signal input merklePath;
    signal output out;

    component inner = Poseidon(2);
    inner.inputs[0] <== privateKey;
    inner.inputs[1] <== commitment;

    component outer = Poseidon(2);
    outer.inputs[0] <== inner.out;
    outer.inputs[1] <== merklePath;
    out <== outer.out;
}
