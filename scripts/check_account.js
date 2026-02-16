import dotenv from "dotenv";
dotenv.config();

import { zkVerifySession, Library, CurveType } from "zkverifyjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getCurrentNonce, isNonceConflictError } from "../dist/src/transactionUtils.js";

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

    try {
        const accountInfo = await session.getAccountInfo();
        if (accountInfo && accountInfo.length > 0) {
            const nonce = accountInfo[0].nonce;
            console.log(`\n📊 Account Information:`);
            console.log(`  Address: ${accountInfo[0].address}`);
            console.log(`  Nonce: ${nonce}`);
            console.log(`  Free Balance: ${accountInfo[0].freeBalance}`);
        }

        const nextNonce = await getCurrentNonce(session);
        console.log(`  Next Nonce: ${nextNonce}\n`);
    } catch (error) {
        console.error('Failed to get account information:', error);
    }

    await session.close();
}

run().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
