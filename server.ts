import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { zkVerifySession, Library, CurveType, VerifyTransactionInfo } from 'zkverifyjs';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const fastify: FastifyInstance = Fastify({ logger: true });

// Register CORS
fastify.register(cors, {
    origin: '*', // In production, restrict this to your game's domain
});

interface VerifyScoreBody {
    proof: any;
    publicSignals: any[];
}

/**
 * POST /verify-score
 * 
 * Body: {
 *   proof: Object,
 *   publicSignals: Array
 * }
 */
fastify.post('/verify-score', async (request: FastifyRequest<{ Body: VerifyScoreBody }>, reply: FastifyReply) => {
    const { proof, publicSignals } = request.body;

    if (!proof || !publicSignals) {
        return reply.status(400).send({ error: 'Missing proof or publicSignals' });
    }

    try {
        fastify.log.info('Starting zkVerify submission...');

        // 1. Initialize zkVerify Session (Backend context relies on the .env seed phrase)
        const seedPhrase = process.env.ZKVERIFY_SEED_PHRASE;
        if (!seedPhrase) {
            throw new Error('ZKVERIFY_SEED_PHRASE not found in environment');
        }

        const session = await zkVerifySession.start()
            .Volta()
            .withAccount(seedPhrase);

        // 2. Load the Verification Key
        const vkeyPath = path.join(__dirname, 'verification_key.json');
        const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

        // 3. Submit for verification
        const { transactionResult } = await session.verify()
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

        const transactionInfo = await transactionResult as VerifyTransactionInfo;
        fastify.log.info(`Transaction submitted: ${transactionInfo.txHash}`);

        return {
            success: true,
            message: 'Proof submitted to zkVerify',
            transactionHash: transactionInfo.txHash,
            explorerUrl: `https://testnet-explorer.zkverify.io/vverify/transaction/${transactionInfo.txHash}`
        };

    } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
            success: false,
            error: error.message
        });
    }
});

// Run the server
const start = async () => {
    try {
        const port = Number(process.env.PORT) || 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        fastify.log.info(`Server listening on ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
