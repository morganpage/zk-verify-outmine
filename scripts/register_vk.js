import { zkVerifySession, Library, CurveType, ZkVerifyEvents } from 'zkverifyjs';
import { getNetworkConfig, getSeedPhrase } from '../dist/src/zkNetworkConfig.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function registerVK() {
    const network = process.env.ZKVERIFY_NETWORK || 'testnet';
    const networkConfig = getNetworkConfig();
    const seedPhrase = getSeedPhrase(network);

    console.log(`📝 Registering verification key on ${networkConfig.name}...`);

    let session;
    if (network === 'testnet') {
        session = await zkVerifySession
            .start()
            .Volta()
            .withAccount(seedPhrase);
    } else if (network === 'mainnet') {
        session = await zkVerifySession
            .start()
            .zkVerify()
            .withAccount(seedPhrase);
    } else {
        throw new Error(`Invalid network: ${network}. Must be 'testnet' or 'mainnet'`);
    }

    const vkeyPath = path.join(__dirname, '../verification_key.json');
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

    console.log('\n🔍 VK structure check:');
    console.log('- protocol:', vkey.protocol);
    console.log('- curve:', vkey.curve);
    console.log('- nPublic:', vkey.nPublic);
    console.log('- vk_alpha_1 length:', vkey.vk_alpha_1?.length);
    console.log('- vk_beta_2 length:', vkey.vk_beta_2?.length);
    console.log('- vk_gamma_2 length:', vkey.vk_gamma_2?.length);
    console.log('- vk_delta_2 length:', vkey.vk_delta_2?.length);
    console.log('- vk_alphabeta_12 length:', vkey.vk_alphabeta_12?.length);
    console.log('- IC length:', vkey.IC?.length);
    console.log('- Full VK string length:', JSON.stringify(vkey).length, 'bytes');

    const { events, transactionResult } = await session
        .registerVerificationKey()
        .groth16({
            library: Library.snarkjs,
            curve: CurveType.bn128
        })
        .execute(vkey);

    events.on(ZkVerifyEvents.VkRegistered, (eventData) => {
        console.log('\n✅ VK registered event received!');
        console.log('📋 Statement Hash:', eventData.statementHash);
    });

    events.on(ZkVerifyEvents.Finalized, (eventData) => {
        console.log('\n✅ Transaction finalized!');
        console.log('📋 Statement Hash:', eventData.statementHash);
        console.log('🔗 Explorer:', `${networkConfig.explorer}/vverify/transaction/${eventData.txHash}`);
        console.log('\n💾 Add this to your .env:');
        console.log(`REGISTERED_VK_HASH_${network.toUpperCase()}="${eventData.statementHash}"`);
    });

    events.on(ZkVerifyEvents.ErrorEvent, (error) => {
        console.error('\n❌ Registration error:', error);
        process.exit(1);
    });

    try {
        const result = await transactionResult;
        console.log('\n🎉 VK registered successfully!');
        return result.statementHash;
    } catch (error) {
        console.error('\n❌ Transaction failed:', error);
        process.exit(1);
    }
}

registerVK().catch(console.error);
