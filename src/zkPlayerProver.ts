// Server-Side Player Prover (Noir + UltraHonk)
//
// This module demonstrates server-side ZK proof generation for individual player rewards.
// The server computes each player's reward, generates a proof that the calculation was
// correct, and submits it to zkVerify for on-chain verification.
//
// KEY CONCEPTS:
// 1. Server generates proofs (not the client) — used when the server computes game results
// 2. Uses Noir language + UltraHonk proving system (vs Circom + Groth16 for client-side)
// 3. One proof per player per game tick — simple, fast, parallelizable
// 4. Player IDs are hashed to Noir Fields via SHA-256 truncation for privacy
// 5. Proof submission is async (fire-and-forget to queue) — doesn't block game loop

import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { zkVerifySession, UltrahonkVariant } from "zkverifyjs";
import { getNetworkConfig, getSeedPhrase, type Network } from "./zkNetworkConfig.js";
import { TransactionQueue, type TransactionResult } from "./zkTransactionQueue.js";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";

const CIRCUIT_PATH = path.resolve(
  process.cwd(),
  "circuits/player_prover/target/player_prover.json",
);

export interface PlayerProofInputs {
  run_id: string;
  player_id: string;
  rewards_earned: string;
  timestamp: string;
  base_reward: string;
  team_bonus: string;
  mode_multiplier: string;
  unit_count: string;
  boost_multiplier: string;
  item_multiplier: string;
  game_mode: string;
  random_outcome: string;
  has_bonus_trait: string;
}

export interface PlayerProofResult {
  success: boolean;
  proof?: string;
  publicInputs?: string[];
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  provingTimeMs?: number;
}

let backend: UltraHonkBackend | null = null;
let noirInstance: Noir | null = null;
let cachedVKHex: string | null = null;
let zkSession: zkVerifySession | null = null;
let transactionQueue: TransactionQueue | null = null;
let initialized = false;

function loadCircuit(): any {
  if (!fs.existsSync(CIRCUIT_PATH)) {
    throw new Error(
      `Circuit not found at ${CIRCUIT_PATH}. Run 'nargo compile' in circuits/player_prover/ first.`,
    );
  }
  return JSON.parse(fs.readFileSync(CIRCUIT_PATH, "utf-8"));
}

// Converts a player identifier string to a Noir Field value.
// Uses SHA-256 truncated to 31 hex chars to fit within a Grumpkin field.
// This provides privacy — the raw player ID never appears on-chain.
function playerIdToField(playerId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(playerId, "utf8")
    .digest("hex");
  const truncated = hash.slice(0, 31);
  return BigInt("0x" + truncated).toString();
}

export async function initPlayerProver(): Promise<void> {
  if (initialized) return;

  console.log("[Player Prover] Initializing...");

  const circuit = loadCircuit();

  backend = new UltraHonkBackend(circuit.bytecode);
  noirInstance = new Noir(circuit);

  const vk = await backend.getVerificationKey({ keccak: true });
  cachedVKHex = "0x" + Buffer.from(vk).toString("hex");
  console.log(`[Player Prover] VK loaded (${vk.length} bytes)`);

  const network: Network =
    (process.env.ZKVERIFY_NETWORK as Network) || "testnet";
  const networkConfig = getNetworkConfig();
  const seedPhrase = getSeedPhrase(network);

  zkSession = await zkVerifySession
    .start()
    .Custom({
      websocket: networkConfig.websocket,
      rpc: networkConfig.rpc,
      network: network === "mainnet" ? "zkVerify" : "Volta",
    })
    .withAccount(seedPhrase);

  console.log(`[Player Prover] Connected to ${networkConfig.name}`);

  transactionQueue = new TransactionQueue(
    { retryAttempts: 3, retryDelay: 5000, timeout: 300000 },
    {
      submit: async (
        proof: any,
        publicSignals: any[],
        vk: any,
      ): Promise<TransactionResult> => {
        if (!zkSession || !zkSession.provider.isConnected) {
          throw new Error("zkVerify session not available");
        }

        const nc = getNetworkConfig();
        const proofHex =
          typeof proof === "string" && proof.startsWith("0x")
            ? proof
            : "0x" + Buffer.from(proof).toString("hex");

        let verifyBuilder = zkSession
          .verify()
          .ultrahonk({ variant: UltrahonkVariant.Plain });

        if (vk.type === "registered" && vk.hash) {
          verifyBuilder = verifyBuilder.withRegisteredVk();
        }

        const { events, transactionResult } = await verifyBuilder.execute({
          proofData: {
            proof: proofHex,
            publicSignals,
            vk: vk.hash || cachedVKHex,
          },
        });

        const txHash = await new Promise<string>((resolve, reject) => {
          events.once("includedInBlock", (data: any) => {
            resolve(data.txHash);
          });
          events.once("error", (err: any) => {
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        });

        transactionResult.catch(() => {});

        return {
          success: true,
          txHash,
          explorerUrl: `${nc.explorer}/extrinsic/${txHash}`,
          finalizationPromise: transactionResult,
        };
      },
    },
  );

  initialized = true;
  console.log("[Player Prover] Initialized and ready");
}

export async function generatePlayerProof(
  inputs: PlayerProofInputs,
): Promise<PlayerProofResult> {
  if (!backend || !noirInstance) {
    return { success: false, error: "Player prover not initialized" };
  }

  try {
    const noirInputs = {
      run_id: inputs.run_id,
      player_id: playerIdToField(inputs.player_id),
      rewards_earned: inputs.rewards_earned,
      timestamp: inputs.timestamp,
      base_reward: inputs.base_reward,
      team_bonus: inputs.team_bonus,
      mode_multiplier: inputs.mode_multiplier,
      unit_count: inputs.unit_count,
      boost_multiplier: inputs.boost_multiplier,
      item_multiplier: inputs.item_multiplier,
      game_mode: inputs.game_mode,
      random_outcome: inputs.random_outcome,
      has_bonus_trait: inputs.has_bonus_trait,
    };

    console.log(
      `[Player Prover] Generating witness for player ${inputs.player_id}...`,
    );
    const { witness } = await noirInstance.execute(noirInputs);

    console.log(
      `[Player Prover] Generating proof for player ${inputs.player_id}...`,
    );
    const start = Date.now();
    const { proof, publicInputs } = await backend.generateProof(witness, {
      keccak: true,
    });
    const provingTimeMs = Date.now() - start;

    console.log(
      `[Player Prover] Proof generated for ${inputs.player_id} in ${provingTimeMs}ms (${proof.length} bytes)`,
    );

    const proofHex = "0x" + Buffer.from(proof).toString("hex");

    // Async submission to zkVerify — fire-and-forget via the transaction queue.
    // The proof is generated synchronously (caller gets the result immediately),
    // but on-chain submission happens asynchronously in the background.
    if (transactionQueue) {
      const network: Network =
        (process.env.ZKVERIFY_NETWORK as Network) || "testnet";
      const registeredVkHash =
        network === "testnet"
          ? process.env.REGISTERED_PLAYER_VK_HASH_TESTNET
          : process.env.REGISTERED_PLAYER_VK_HASH_MAINNET;

      transactionQueue
        .submit(proof, publicInputs, {
          type: "registered",
          data: "",
          hash: registeredVkHash || cachedVKHex!,
        }, network, inputs.player_id)
        .then((result) => {
          console.log(
            `[Player Prover] TX included in block for ${inputs.player_id}: ${result.txHash}`,
          );
        })
        .catch((err: any) => {
          console.error(
            `[Player Prover] TX failed for ${inputs.player_id}: ${err.message}`,
          );
        });
    }

    return {
      success: true,
      proof: proofHex,
      publicInputs,
      provingTimeMs,
    };
  } catch (error: any) {
    console.error(
      `[Player Prover] Proof generation failed for ${inputs.player_id}: ${error.message}`,
    );
    return { success: false, error: error.message };
  }
}

export function isPlayerProverInitialized(): boolean {
  return initialized;
}

export function getPlayerProverStatus(): {
  initialized: boolean;
  queueStatus: any;
} {
  return {
    initialized,
    queueStatus: transactionQueue?.getStatus() ?? null,
  };
}

export async function shutdownPlayerProver(): Promise<void> {
  if (transactionQueue) await transactionQueue.shutdown();
  if (zkSession) await zkSession.close();
  initialized = false;
  console.log("[Player Prover] Shut down");
}
