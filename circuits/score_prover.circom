pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Circuit Constants
const BIT_WIDTH = 32;
const MAX_SCORE_VALUE = 1000;
const NUM_SCORES = 5;

template ScoreVerifier(n) {
    // Private inputs
    signal input scores[n];
    signal input secret; // Private player secret
    
    // Public inputs
    signal input claimedTotal;
    signal input sessionId;   // Unique session ID to prevent replay
    signal input playerAddress; // Binding proof to a specific wallet

    // Output
    signal output secretCommitment; // Hash(secret, playerAddress)
    signal output isValid;

    // 1. Calculate Score Sum and ensure constraints
    var sum = 0;
    component lt[n];
    for (var i = 0; i < n; i++) {
        lt[i] = LessThan(BIT_WIDTH);
        lt[i].in[0] <== scores[i];
        lt[i].in[1] <== MAX_SCORE_VALUE + 1;
        lt[i].out === 1;
        sum += scores[i];
    }

    sum === claimedTotal;

    // 2. Identity Binding / Commitment
    // We hash the secret and player address together
    // This proves the player knows the secret for this address
    component hasher = Poseidon(2);
    hasher.inputs[0] <== secret;
    hasher.inputs[1] <== playerAddress;
    
    secretCommitment <== hasher.out;
    isValid <== 1;
}

component main { public [ claimedTotal, sessionId, playerAddress ] } = ScoreVerifier(NUM_SCORES);
