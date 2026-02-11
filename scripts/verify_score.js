import dotenv from "dotenv";
dotenv.config();

import { zkVerifySession, Library, CurveType } from "zkverifyjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NETWORKS = {
    testnet: {
        name: 'Volta Testnet',
        method: 'Volta',
        seedEnv: 'ZKVERIFY_TESTNET_SEED_PHRASE',
        explorer: 'https://zkverify-testnet.subscan.io'
    },
    mainnet: {
        name: 'zkVerify Mainnet',
        method: 'zkVerify',
        seedEnv: 'ZKVERIFY_MAINNET_SEED_PHRASE',
        explorer: 'https://zkverify.subscan.io'
    }
};

function getNetworkConfig() {
    const network = process.env.ZKVERIFY_NETWORK || 'testnet';

    if (!NETWORKS[network]) {
        console.error(`Error: Invalid network "${network}". Must be 'testnet' or 'mainnet'.`);
        process.exit(1);
    }

    const config = NETWORKS[network];
    const seedPhrase = process.env[config.seedEnv];

    if (!seedPhrase) {
        console.error(`Error: ${config.seedEnv} not found in environment.`);
        console.error(`Please create a .env file and add your seed phrase.`);
        process.exit(1);
    }

    return { network, config, seedPhrase };
}

async function run() {
    const { network, config, seedPhrase } = getNetworkConfig();

    console.log(`Starting zkVerify session (${config.name})...`);

    const session = await zkVerifySession.start()
        [config.method]()
        .withAccount(seedPhrase);

    const proofPath = path.join(__dirname, "../proof.json");
    const publicPath = path.join(__dirname, "../public.json");
    const vkeyPath = path.join(__dirname, "../verification_key.json");

    if (!fs.existsSync(proofPath) || !fs.existsSync(publicPath) || !fs.existsSync(vkeyPath)) {
        console.error("Error: Missing proof files. Ensure proof.json, public.json, and verification_key.json exist in the root directory.");
        process.exit(1);
    }

    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));

    console.log("Submitting proof to zkVerify...");

    try {
        const { events, transactionResult } = await session.verify()
            .groth16({
                library: Library.snarkjs,
                curve: CurveType.bn128
            })
            .execute({
                proofData: {
                    proof: proof,
                    publicSignals: publicSignals,
                    vk: vkey
                }
            });

        const transactionInfo = await transactionResult;
        console.log(`Transaction submitted! Hash: ${transactionInfo.txHash}`);
        console.log("Full Transaction Info:", JSON.stringify(transactionInfo, null, 2));
        console.log("Waiting for finalization...");

        events.on("finalized", (details) => {
            console.log("\n✅ Proof successfully verified and finalized by zkVerify!");
            console.log(`Block Hash: ${details.blockHash}`);
            console.log(`View on Explorer: ${config.explorer}/vverify/transaction/${transactionInfo.txHash}`);
            process.exit(0);
        });

        events.on("error", (error) => {
            console.error("\n❌ Verification failed:", error);
            process.exit(1);
        });

    } catch (error) {
        console.error("Error during execution:", error);
        process.exit(1);
    }
}

run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
