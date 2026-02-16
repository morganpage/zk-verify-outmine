export type Network = 'testnet' | 'mainnet';

export interface NetworkConfig {
    name: string;
    websocket: string;
    rpc: string;
    explorer: string;
    seedPhraseEnvVar: string;
    faucetUrl?: string;
}

export const NETWORKS: Record<Network, NetworkConfig> = {
    testnet: {
        name: 'Volta Testnet',
        websocket: 'wss://zkverify-volta-rpc.zkverify.io',
        rpc: 'https://zkverify-volta-rpc.zkverify.io',
        explorer: 'https://zkverify-testnet.subscan.io',
        seedPhraseEnvVar: 'ZKVERIFY_TESTNET_SEED_PHRASE',
        faucetUrl: 'https://faucet.zkverify.io/'
    },
    mainnet: {
        name: 'zkVerify Mainnet',
        websocket: 'wss://zkverify-rpc.zkverify.io',
        rpc: 'https://zkverify-rpc.zkverify.io',
        explorer: 'https://zkverify.subscan.io',
        seedPhraseEnvVar: 'ZKVERIFY_MAINNET_SEED_PHRASE'
    }
};

export function getNetworkConfig(): NetworkConfig {
    const network: Network = (process.env.ZKVERIFY_NETWORK as Network) || 'testnet';
    
    if (!NETWORKS[network]) {
        throw new Error(`Invalid network: ${network}. Must be 'testnet' or 'mainnet'`);
    }
    
    const config = NETWORKS[network];
    
    return {
        ...config,
        websocket: process.env.ZKVERIFY_RPC_WSS || config.websocket,
        rpc: process.env.ZKVERIFY_RPC_HTTPS || config.rpc
    };
}

export function getSeedPhrase(network: Network): string {
    const config = NETWORKS[network];
    const seedPhrase = process.env[config.seedPhraseEnvVar];
    
    if (!seedPhrase) {
        throw new Error(`${config.seedPhraseEnvVar} not found in environment`);
    }
    
    return seedPhrase;
}
