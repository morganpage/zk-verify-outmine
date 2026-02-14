# Unity WebGL Integration for ZK Score Verification

This guide explains how to integrate the ZK prover into a Unity WebGL build.

## Files Overview

| File | Purpose |
|------|---------|
| `Plugins/WebGL/ZKProver.jslib` | JavaScript bridge to snarkjs |
| `Scripts/ZKProverBridge.cs` | C# wrapper for calling the JS functions |

## Setup Instructions

### 1. Copy Files to Unity Project
```
YourUnityProject/
├── Assets/
│   ├── Plugins/
│   │   └── WebGL/
│   │       └── ZKProver.jslib
│   ├── Scripts/
│   │   └── ZKProverBridge.cs
│   └── StreamingAssets/
│       └── zk/
│           ├── score_prover.wasm
│           └── score_prover_final.zkey
```

### 2. Include snarkjs in Your WebGL Template
Create a custom WebGL template or modify the default one to include snarkjs:

```html
<!-- In your index.html template -->
<script src="https://cdn.jsdelivr.net/npm/snarkjs@latest/build/snarkjs.min.js"></script>
```

### 3. Add ZKProverBridge to a GameObject
Create an empty GameObject and attach `ZKProverBridge.cs` to it.

### 4. Generate Proofs from Your Game Code

```csharp
// Example: Submit score after game ends
using System.Numerics;

public class GameManager : MonoBehaviour
{
    private int[] levelScores = new int[5];
    private string playerSecret = "your_player_secret";
    private string sessionId;

    void Start()
    {
        // Generate unique session ID for this game session (128-bit cryptographic uniqueness)
        sessionId = BigInteger.Abs(new BigInteger(Guid.NewGuid().ToByteArray())).ToString();
        
        // Subscribe to proof generation events
        ZKProverBridge.Instance.OnProofGenerated += HandleProofGenerated;
    }

    public void SubmitScore()
    {
        string playerAddress = "0xYourWalletAddress";
        ZKProverBridge.Instance.GenerateScoreProof(levelScores, playerSecret, sessionId, playerAddress);
    }

    private void HandleProofGenerated(ZKProofResult result)
    {
        if (result.success)
        {
            // Send proof to your backend or directly to zkVerify
            Debug.Log("Proof ready for submission!");
            // StartCoroutine(SubmitToZkVerify(result.proof, result.publicSignals));
        }
    }
}
```

## Build Settings
- Platform: **WebGL**
- Compression Format: **Gzip** or **Brotli** (recommended)
- Enable Exceptions: **Explicitly Thrown Exceptions Only** (for performance)

## Notes
- Proof generation can take a few seconds depending on circuit complexity.
- Consider showing a loading indicator while generating proofs.
- The `snarkjs` library is ~2MB, so initial page load will be affected.
