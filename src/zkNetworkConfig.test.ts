import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getNetworkConfig, getSeedPhrase, NETWORKS, Network } from './zkNetworkConfig.js';

describe('networkConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('getNetworkConfig', () => {
        it('should return testnet config by default', () => {
            delete process.env.ZKVERIFY_NETWORK;
            const config = getNetworkConfig();
            
            expect(config.name).toBe('Volta Testnet');
            expect(config.websocket).toContain('volta');
            expect(config.rpc).toContain('volta');
            expect(config.explorer).toContain('testnet');
        });

        it('should return testnet config when explicitly set', () => {
            process.env.ZKVERIFY_NETWORK = 'testnet';
            const config = getNetworkConfig();
            
            expect(config.name).toBe('Volta Testnet');
            expect(config.faucetUrl).toBe('https://faucet.zkverify.io/');
        });

        it('should return mainnet config when set', () => {
            process.env.ZKVERIFY_NETWORK = 'mainnet';
            const config = getNetworkConfig();
            
            expect(config.name).toBe('zkVerify Mainnet');
            expect(config.faucetUrl).toBeUndefined();
            expect(config.explorer).toBe('https://zkverify.subscan.io');
        });

        it('should throw error for invalid network', () => {
            process.env.ZKVERIFY_NETWORK = 'invalid';
            
            expect(() => getNetworkConfig()).toThrow(
                'Invalid network: invalid. Must be \'testnet\' or \'mainnet\''
            );
        });

        it('should use custom WebSocket when provided', () => {
            process.env.ZKVERIFY_NETWORK = 'testnet';
            process.env.ZKVERIFY_RPC_WSS = 'wss://custom-rpc.example.com';
            
            const config = getNetworkConfig();
            expect(config.websocket).toBe('wss://custom-rpc.example.com');
        });

        it('should use custom HTTPS RPC when provided', () => {
            process.env.ZKVERIFY_NETWORK = 'mainnet';
            process.env.ZKVERIFY_RPC_HTTPS = 'https://custom-rpc.example.com';
            
            const config = getNetworkConfig();
            expect(config.rpc).toBe('https://custom-rpc.example.com');
        });
    });

    describe('getSeedPhrase', () => {
        it('should return testnet seed phrase when network is testnet', () => {
            process.env.ZKVERIFY_TESTNET_SEED_PHRASE = 'one two three four five six seven eight nine ten eleven twelve';
            process.env.ZKVERIFY_NETWORK = 'testnet';
            
            const seedPhrase = getSeedPhrase('testnet');
            expect(seedPhrase).toBe('one two three four five six seven eight nine ten eleven twelve');
        });
        
        it('should return mainnet seed phrase when network is mainnet', () => {
            process.env.ZKVERIFY_MAINNET_SEED_PHRASE = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
            process.env.ZKVERIFY_NETWORK = 'mainnet';
            
            const seedPhrase = getSeedPhrase('mainnet');
            expect(seedPhrase).toBe('alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu');
        });

        it('should throw error when testnet seed phrase is missing', () => {
            delete process.env.ZKVERIFY_TESTNET_SEED_PHRASE;
            
            expect(() => getSeedPhrase('testnet')).toThrow(
                'ZKVERIFY_TESTNET_SEED_PHRASE not found in environment'
            );
        });

        it('should throw error when mainnet seed phrase is missing', () => {
            delete process.env.ZKVERIFY_MAINNET_SEED_PHRASE;
            
            expect(() => getSeedPhrase('mainnet')).toThrow(
                'ZKVERIFY_MAINNET_SEED_PHRASE not found in environment'
            );
        });
        
        it('should throw error when seed phrase has too few words', () => {
            process.env.ZKVERIFY_TESTNET_SEED_PHRASE = 'one two three four five';
            process.env.ZKVERIFY_NETWORK = 'testnet';
            
            expect(() => getSeedPhrase('testnet')).toThrow(
                'ZKVERIFY_TESTNET_SEED_PHRASE must be 12-24 words separated by spaces'
            );
        });
        
        it('should throw error when seed phrase has too many words', () => {
            process.env.ZKVERIFY_TESTNET_SEED_PHRASE = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty twentyone twentytwo twentythree twentyfour twentyfive';
            process.env.ZKVERIFY_NETWORK = 'testnet';
            
            expect(() => getSeedPhrase('testnet')).toThrow(
                'ZKVERIFY_TESTNET_SEED_PHRASE must be 12-24 words separated by spaces'
            );
        });
    });

    describe('NETWORKS constant', () => {
        it('should have testnet configuration', () => {
            expect(NETWORKS.testnet).toBeDefined();
            expect(NETWORKS.testnet.name).toBe('Volta Testnet');
            expect(NETWORKS.testnet.faucetUrl).toBeDefined();
        });

        it('should have mainnet configuration', () => {
            expect(NETWORKS.mainnet).toBeDefined();
            expect(NETWORKS.mainnet.name).toBe('zkVerify Mainnet');
            expect(NETWORKS.mainnet.faucetUrl).toBeUndefined();
        });
    });
});
