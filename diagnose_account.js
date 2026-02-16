import { zkVerifySession, Library, CurveType } from 'zkverifyjs';
import dotenv from 'dotenv';

dotenv.config();

async function diagnoseAccount() {
    const network = process.env.ZKVERIFY_NETWORK || 'testnet';
    console.log(`\n🔍 Diagnosing account on ${network}...`);

    const session = await zkVerifySession
        .start()
        .Volta()
        .withAccount(process.env.ZKVERIFY_TESTNET_SEED_PHRASE);

    console.log('\n📊 Account Information:');
    try {
        const accountInfo = await session.getAccountInfo();
        console.log('- Address:', accountInfo[0].address);
        console.log('- Free Balance:', accountInfo[0].freeBalance);
        console.log('- Reserved Balance:', accountInfo[0].reservedBalance);
        console.log('- Nonce:', accountInfo[0].nonce);
    } catch (error) {
        console.error('❌ Failed to get account info:', error);
    }

    console.log('\n📋 VK Information:');
    const fs = await import('fs');
    const vkey = JSON.parse(fs.readFileSync('verification_key.json', 'utf8'));
    console.log('- Protocol:', vkey.protocol);
    console.log('- Curve:', vkey.curve);
    console.log('- nPublic:', vkey.nPublic);
    console.log('- JSON Size:', JSON.stringify(vkey).length, 'bytes');

    console.log('\n🧪 Testing transaction...');
    try {
        const { events, transactionResult } = await session
            .registerVerificationKey()
            .groth16({
                library: Library.snarkjs,
                curve: CurveType.bn128
            })
            .execute(vkey);

        events.on('error', (error) => {
            console.error('\n❌ Transaction error:', error);
            process.exit(1);
        });

        const result = await transactionResult;
        console.log('\n✅ Transaction completed!');
        console.log('- Statement Hash:', result.statementHash);
        console.log('- Tx Hash:', result.txHash);
    } catch (error) {
        console.error('\n❌ Transaction failed:', error.message);

        if (error.message && error.message.includes('FundsUnavailable')) {
            console.log('\n💡 Suggestion: Check existential deposit requirement');
            console.log('   zkVerify may require minimum balance for account creation');
        }
    }

    await session.close();
}

diagnoseAccount().catch(console.error);
