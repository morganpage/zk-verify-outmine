// ZKProver.jslib
// Place this file in Assets/Plugins/WebGL/ in your Unity project

mergeInto(LibraryManager.library, {

  // Initialize snarkjs - call this once at game start
  InitZKProver: function () {
    if (typeof window.snarkjs === 'undefined') {
      console.error("snarkjs not loaded! Include snarkjs.min.js in your WebGL template.");
      return;
    }
    console.log("ZK Prover initialized with snarkjs version:", window.snarkjs.version);
  },

  // Generate a ZK proof
  // Returns a promise-like structure via Unity's SendMessage callback
  GenerateProof: function (inputJsonPtr, wasmPathPtr, zkeyPathPtr, callbackObjectPtr, callbackMethodPtr) {
    var inputJson = UTF8ToString(inputJsonPtr);
    var wasmPath = UTF8ToString(wasmPathPtr);
    var zkeyPath = UTF8ToString(zkeyPathPtr);
    var callbackObject = UTF8ToString(callbackObjectPtr);
    var callbackMethod = UTF8ToString(callbackMethodPtr);

    var input = JSON.parse(inputJson);

    // Helper: Normalize values to decimal strings for snarkjs
    function normalize(x) {
      if (typeof x === "string" && x.startsWith("0x")) return BigInt(x).toString(10);
      return x.toString();
    }

    input.secret = normalize(input.secret);
    input.sessionId = normalize(input.sessionId);
    input.playerAddress = normalize(input.playerAddress);

    // Load the WASM and generate the proof
    snarkjs.groth16.fullProve(input, wasmPath, zkeyPath)
      .then(function (result) {
        var response = {
          success: true,
          proof: result.proof,
          publicSignals: result.publicSignals
        };
        // Send result back to Unity
        SendMessage(callbackObject, callbackMethod, JSON.stringify(response));
      })
      .catch(function (error) {
        var response = {
          success: false,
          error: error.message
        };
        SendMessage(callbackObject, callbackMethod, JSON.stringify(response));
      });
  },

  // Verify a proof locally (optional, useful for testing)
  VerifyProof: function (vkeyJsonPtr, publicSignalsJsonPtr, proofJsonPtr, callbackObjectPtr, callbackMethodPtr) {
    var vkeyJson = UTF8ToString(vkeyJsonPtr);
    var publicSignalsJson = UTF8ToString(publicSignalsJsonPtr);
    var proofJson = UTF8ToString(proofJsonPtr);
    var callbackObject = UTF8ToString(callbackObjectPtr);
    var callbackMethod = UTF8ToString(callbackMethodPtr);

    var vkey = JSON.parse(vkeyJson);
    var publicSignals = JSON.parse(publicSignalsJson);
    var proof = JSON.parse(proofJson);

    // Convert string values to BigInt for verification
    publicSignals = publicSignals.map(function (sig) {
      return typeof sig === 'string' ? BigInt(sig) : sig;
    });

    snarkjs.groth16.verify(vkey, publicSignals, proof)
      .then(function (isValid) {
        var response = {
          success: true,
          isValid: isValid
        };
        SendMessage(callbackObject, callbackMethod, JSON.stringify(response));
      })
      .catch(function (error) {
        var response = {
          success: false,
          error: error.message
        };
        SendMessage(callbackObject, callbackMethod, JSON.stringify(response));
      });
  }
});