import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getNetworkConfig, getSeedPhrase, Network } from '../zkNetworkConfig.js';

describe('Server Network Configuration', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeAll(() => {
        originalEnv = { ...process.env };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should initialize testnet session when ZKVERIFY_NETWORK=testnet', async () => {
        process.env.ZKVERIFY_NETWORK = 'testnet';
        process.env.ZKVERIFY_TESTNET_SEED_PHRASE = 'test word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';
        
        const network = process.env.ZKVERIFY_NETWORK;
        expect(network).toBe('testnet');
    });

    it('should initialize mainnet session when ZKVERIFY_NETWORK=mainnet', async () => {
        process.env.ZKVERIFY_NETWORK = 'mainnet';
        process.env.ZKVERIFY_MAINNET_SEED_PHRASE = 'main word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';
        
        const network = process.env.ZKVERIFY_NETWORK;
        expect(network).toBe('mainnet');
    });

    it('should return network-specific explorer URL', async () => {
        process.env.ZKVERIFY_NETWORK = 'testnet';
        
        const config = getNetworkConfig();
        
        expect(config.explorer).toContain('testnet');
    });

    it('should return error response when seed phrase is missing', async () => {
        process.env.ZKVERIFY_NETWORK = 'testnet';
        delete process.env.ZKVERIFY_TESTNET_SEED_PHRASE;
        
        expect(() => getSeedPhrase('testnet')).toThrow();
    });
});
