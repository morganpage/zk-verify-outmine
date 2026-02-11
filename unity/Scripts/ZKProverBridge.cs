using System;
using System.Runtime.InteropServices;
using UnityEngine;

/// <summary>
/// C# wrapper for the ZK Prover JavaScript library.
/// Place this script on a GameObject in your scene.
/// </summary>
public class ZKProverBridge : MonoBehaviour
{
    public static ZKProverBridge Instance { get; private set; }

    // Events for proof generation results
    public event Action<ZKProofResult> OnProofGenerated;
    public event Action<ZKVerifyResult> OnProofVerified;

    // Import the JavaScript functions from ZKProver.jslib
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void InitZKProver();

    [DllImport("__Internal")]
    private static extern void GenerateProof(string inputJson, string wasmPath, string zkeyPath, string callbackObject, string callbackMethod);

    [DllImport("__Internal")]
    private static extern void VerifyProof(string vkeyJson, string publicSignalsJson, string proofJson, string callbackObject, string callbackMethod);
#else
    // Stubs for Editor/non-WebGL builds
    private static void InitZKProver() => Debug.Log("[ZKProver] InitZKProver (Editor stub)");
    private static void GenerateProof(string inputJson, string wasmPath, string zkeyPath, string callbackObject, string callbackMethod) 
        => Debug.Log($"[ZKProver] GenerateProof called with input: {inputJson}");
    private static void VerifyProof(string vkeyJson, string publicSignalsJson, string proofJson, string callbackObject, string callbackMethod) 
        => Debug.Log("[ZKProver] VerifyProof (Editor stub)");
#endif

    private void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    private void Start()
    {
        InitZKProver();
    }

    /// <summary>
    /// Generate a ZK proof for the given game scores.
    /// </summary>
    /// <param name="scores">Array of scores from game levels</param>
    /// <param name="secret">Player's secret for identity binding</param>
    /// <param name="sessionId">Unique session ID to prevent replay</param>
    /// <param name="playerAddress">Player's wallet address</param>
    public void GenerateScoreProof(int[] scores, string secret, string sessionId, string playerAddress)
    {
        int claimedTotal = 0;
        foreach (var score in scores) claimedTotal += score;

        var input = new ZKProofInput
        {
            scores = scores,
            secret = secret,
            claimedTotal = claimedTotal,
            sessionId = sessionId,
            playerAddress = playerAddress
        };

        string inputJson = JsonUtility.ToJson(input);
        
        // Paths to WASM and zkey files (relative to StreamingAssets in WebGL)
        string wasmPath = "StreamingAssets/zk/score_prover.wasm";
        string zkeyPath = "StreamingAssets/zk/score_prover_final.zkey";

        GenerateProof(inputJson, wasmPath, zkeyPath, gameObject.name, "OnProofGeneratedCallback");
    }

    /// <summary>
    /// Callback from JavaScript when proof generation completes.
    /// </summary>
    public void OnProofGeneratedCallback(string resultJson)
    {
        var result = JsonUtility.FromJson<ZKProofResult>(resultJson);
        OnProofGenerated?.Invoke(result);
        
        if (result.success)
        {
            Debug.Log($"[ZKProver] Proof generated successfully!");
            Debug.Log($"[ZKProver] Public Signals: {string.Join(", ", result.publicSignals)}");
        }
        else
        {
            Debug.LogError($"[ZKProver] Proof generation failed: {result.error}");
        }
    }

    /// <summary>
    /// Callback from JavaScript when verification completes.
    /// </summary>
    public void OnProofVerifiedCallback(string resultJson)
    {
        var result = JsonUtility.FromJson<ZKVerifyResult>(resultJson);
        OnProofVerified?.Invoke(result);
    }
}

[Serializable]
public class ZKProofInput
{
    public int[] scores;
    public string secret;
    public int claimedTotal;
    public string sessionId;
    public string playerAddress;
}

[Serializable]
public class ZKProofResult
{
    public bool success;
    public string proof;
    public string[] publicSignals;
    public string error;
}

[Serializable]
public class ZKVerifyResult
{
    public bool success;
    public bool isValid;
    public string error;
}
