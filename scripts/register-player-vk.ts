// Register the Player Prover verification key on the zkVerify network.
//
// This script compiles the Noir circuit (if needed), generates the UltraHonk
// verification key, and registers it on-chain. The resulting statement hash
// should be saved in your .env file as REGISTERED_PLAYER_VK_HASH_TESTNET or
// REGISTERED_PLAYER_VK_HASH_MAINNET.
//
// Usage:
//   npx tsx scripts/register-player-vk.ts                          # testnet
//   ZKVERIFY_NETWORK=mainnet npx tsx scripts/register-player-vk.ts # mainnet
//   npx tsx scripts/register-player-vk.ts --skip-register           # generate VK only
//   npx tsx scripts/register-player-vk.ts --skip-compile            # skip nargo compile

import "dotenv/config";
import { UltraHonkBackend } from "@aztec/bb.js";
import { zkVerifySession, UltrahonkVariant } from "zkverifyjs";
import { getNetworkConfig, getSeedPhrase, type Network } from "../src/zkNetworkConfig.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CIRCUIT_DIR = path.resolve(process.cwd(), "circuits/player_prover");
const TARGET_DIR = path.join(CIRCUIT_DIR, "target");

function compileCircuit(): void {
  console.log("Compiling player circuit with nargo...");
  execSync("nargo compile", { cwd: CIRCUIT_DIR, stdio: "inherit" });
}

async function generateVK(): Promise<Buffer> {
  console.log("Generating UltraHonk VK with bb.js (WASM)...");

  const circuitPath = path.join(TARGET_DIR, "player_prover.json");
  if (!fs.existsSync(circuitPath)) {
    throw new Error(
      `Circuit not found at ${circuitPath}. Run with nargo compile first.`,
    );
  }

  const circuit = JSON.parse(fs.readFileSync(circuitPath, "utf-8"));
  const backend = new UltraHonkBackend(circuit.bytecode);
  const vk = await backend.getVerificationKey({ keccak: true });

  console.log(`VK generated (${vk.length} bytes)`);

  if (vk.length !== 1760) {
    console.warn(
      `Warning: VK size is ${vk.length} bytes, expected 1760 for zkVerify`,
    );
  }

  return Buffer.from(vk);
}

async function registerVK(network: Network, vk: Buffer): Promise<string> {
  const networkConfig = getNetworkConfig();
  const seedPhrase = getSeedPhrase(network);

  console.log(`\nConnecting to ${networkConfig.name}...`);
  const session = await zkVerifySession
    .start()
    .Custom({
      websocket: networkConfig.websocket,
      rpc: networkConfig.rpc,
      network: network === "mainnet" ? "zkVerify" : "Volta",
    })
    .withAccount(seedPhrase);

  console.log(`Registering player UltraHonk VK on ${networkConfig.name}...`);

  const vkHex = "0x" + vk.toString("hex");

  const { transactionResult } = await session
    .registerVerificationKey()
    .ultrahonk({ variant: UltrahonkVariant.Plain })
    .execute(vkHex);

  const result: any = await transactionResult;

  console.log(`\nVK registered successfully!`);
  console.log(
    `  Transaction: ${networkConfig.explorer}/transaction/${result.txHash}`,
  );
  console.log(`  VK Hash (statementHash): ${result.statementHash}`);
  console.log(`\nAdd to .env:`);
  console.log(
    `  REGISTERED_PLAYER_VK_HASH_${network.toUpperCase()}=${result.statementHash}`,
  );

  await session.close();
  return result.statementHash!;
}

async function main() {
  const network: Network =
    (process.env.ZKVERIFY_NETWORK as Network) || "testnet";
  const args = process.argv.slice(2);
  const skipCompile = args.includes("--skip-compile");
  const skipRegister = args.includes("--skip-register");

  console.log("=== Player Prover VK Registration ===\n");

  if (!skipCompile) {
    compileCircuit();
  }

  const vk = await generateVK();

  if (skipRegister) {
    console.log("\nSkipping registration (--skip-register).");
    const vkHex = "0x" + vk.toString("hex");
    console.log(`VK hex: ${vkHex.slice(0, 40)}...`);
    return;
  }

  if (
    !process.env.ZKVERIFY_TESTNET_SEED_PHRASE &&
    !process.env.ZKVERIFY_MAINNET_SEED_PHRASE
  ) {
    console.error(
      "\nError: No seed phrase found. Set ZKVERIFY_TESTNET_SEED_PHRASE or ZKVERIFY_MAINNET_SEED_PHRASE in .env",
    );
    process.exit(1);
  }

  const vkHash = await registerVK(network, vk);
  console.log(`\nDone. VK hash: ${vkHash}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
