import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { zkVerifySession, Library, CurveType, VerifyTransactionInfo } from "zkverifyjs";
import type { zkVerifySession as ZkVerifySessionType } from "zkverifyjs";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getNetworkConfig, getSeedPhrase, Network } from "./src/zkNetworkConfig.js";
import { logFailure, categorizeError as categorizeZkError } from "./src/utils/zkFailureLogger.js";
import { TransactionQueue, type TransactionResult, type TransactionSubmitter } from "./src/zkTransactionQueue.js";
import { sanitizeProofData, validateProofAndSignals, categorizeTransactionError } from "./src/zkTransactionUtils.js";

dotenv.config();

const fastify: FastifyInstance = Fastify({ logger: true });

let zkSession: ZkVerifySessionType | null = null;
let isReconnecting = false;
let reconnectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;

let disconnectCleanup: (() => void) | null = null;

const QUEUE_MAX_CONCURRENT = parseInt(process.env.QUEUE_MAX_CONCURRENT || '1', 10);
const QUEUE_RETRY_ATTEMPTS = parseInt(process.env.QUEUE_RETRY_ATTEMPTS || '3', 10);
const QUEUE_RETRY_DELAY = parseInt(process.env.QUEUE_RETRY_DELAY || '5000', 10);
const QUEUE_TIMEOUT = parseInt(process.env.QUEUE_TIMEOUT || '300000', 10);

let transactionQueue: TransactionQueue | null = null;

export type VerificationKeyType = 'registered' | 'inline';

export interface CachedVK {
  type: VerificationKeyType;
  data: string | any;
  hash?: string;
  network?: Network;
}

let cachedVK: CachedVK | null = null;

async function loadVerificationKey(network: Network): Promise<CachedVK> {
  const registeredVkHash = network === 'testnet'
      ? process.env.REGISTERED_VK_HASH_TESTNET
      : process.env.REGISTERED_VK_HASH_MAINNET;

  if (registeredVkHash && registeredVkHash.length > 0) {
    fastify.log.info(`Using registered VK hash for ${network}`);
    return {
      type: 'registered',
      data: registeredVkHash,
      hash: registeredVkHash,
      network,
    };
  }

  fastify.log.info(`No registered VK hash for ${network}, loading verification_key.json as fallback`);
  const vkeyPath = path.join(process.cwd(), 'verification_key.json');
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

  return {
    type: 'inline',
    data: vkey,
    network,
  };
}

async function initializeZkSession(): Promise<ZkVerifySessionType> {
  const networkConfig = getNetworkConfig();
  const network: Network = (process.env.ZKVERIFY_NETWORK as Network) || "testnet";
  const seedPhrase = getSeedPhrase(network);

  fastify.log.info(`Initializing zkVerify session for ${networkConfig.name}...`);

  try {
    const session = await zkVerifySession
      .start()
      .Custom({
        websocket: networkConfig.websocket,
        rpc: networkConfig.rpc,
        network: network === "mainnet" ? "zkVerify" : "Volta",
      })
      .withAccount(seedPhrase);

    fastify.log.info("✅ zkVerify session initialized successfully");
    return session;
  } catch (error) {
    fastify.log.error("Failed to initialize zkVerify session:", error as any);
    throw error;
  }
}

async function attemptReconnection(): Promise<void> {
  if (isReconnecting) {
    fastify.log.debug("Reconnection already in progress, skipping...");
    return;
  }

  if (reconnectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
    fastify.log.error(`Max reconnection attempts (${MAX_RECONNECTION_ATTEMPTS}) reached. Giving up.`);
    return;
  }

  isReconnecting = true;
  reconnectionAttempts++;
  
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectionAttempts - 1),
    30000
  );

  fastify.log.warn(`Reconnection attempt ${reconnectionAttempts}/${MAX_RECONNECTION_ATTEMPTS} in ${delay}ms...`);

  await new Promise(resolve => setTimeout(resolve, delay));

  try {
    fastify.log.info("Attempting to reconnect to zkVerify...");
    zkSession = await initializeZkSession();
    reconnectionAttempts = 0;
    isReconnecting = false;
    fastify.log.info("✅ Reconnected to zkVerify successfully");

    monitorSessionConnection();
  } catch (error) {
    fastify.log.error(`Reconnection attempt ${reconnectionAttempts} failed:`, error as any);
    isReconnecting = false;
    
    setTimeout(() => attemptReconnection(), 0);
  }
}

function monitorSessionConnection(): void {
  if (!zkSession) {
    fastify.log.warn("No session to monitor");
    return;
  }

  const provider = zkSession.provider;

  if (disconnectCleanup) {
    disconnectCleanup();
  }

  disconnectCleanup = provider.on('disconnected', () => {
    fastify.log.warn('⚠️ zkVerify WebSocket disconnected');
    zkSession = null;
    attemptReconnection();
  });

  disconnectCleanup = provider.on('error', (error: Error) => {
    fastify.log.error('zkVerify provider error:', error as any);
  });

  disconnectCleanup = provider.on('connected', () => {
    fastify.log.info('✅ zkVerify WebSocket connected');
    reconnectionAttempts = 0;
    isReconnecting = false;
  });

  fastify.log.info('👁️ Session connection monitoring enabled');
}

async function submitProofTransaction(
  proof: any,
  publicSignals: any[],
  vk: CachedVK,
  network: Network
): Promise<TransactionResult> {
  if (!zkSession || !zkSession.provider.isConnected) {
    throw new Error('zkVerify session not available');
  }

  const networkConfig = getNetworkConfig();
  fastify.log.info("Submitting proof to zkVerify...");

  const { transactionResult } = await zkSession
    .verify()
    .groth16({
      library: Library.snarkjs,
      curve: CurveType.bn128,
    })
    .execute({
      proofData: {
        proof: proof,
        publicSignals: publicSignals,
        vk: vk.data,
      },
    });

  const transactionInfo = (await transactionResult) as VerifyTransactionInfo;
  fastify.log.info(`Transaction submitted: ${transactionInfo.txHash}`);

  return {
    success: true,
    txHash: transactionInfo.txHash,
    explorerUrl: `${networkConfig.explorer}/vverify/transaction/${transactionInfo.txHash}`,
  };
}

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  zkVerifyConnected: boolean;
  network: string;
  reconnectionAttempts?: number;
  isReconnecting?: boolean;
  uptime: number;
  queueStatus?: {
    queueLength: number;
    activeTransaction: any;
    totalProcessed: number;
    totalFailed: number;
  };
}

fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
  const uptime = process.uptime();
  const network: Network = (process.env.ZKVERIFY_NETWORK as Network) || "testnet";
  const networkConfig = getNetworkConfig();

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (zkSession && zkSession.provider.isConnected) {
    status = 'healthy';
  } else if (isReconnecting) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  const response: HealthCheckResponse = {
    status,
    zkVerifyConnected: zkSession ? zkSession.provider.isConnected : false,
    network: networkConfig.name,
    uptime,
  };

  if (isReconnecting) {
    response.reconnectionAttempts = reconnectionAttempts;
    response.isReconnecting = true;
  }

  if (transactionQueue) {
    const queueStatus = (transactionQueue as TransactionQueue).getStatus();
    response.queueStatus = {
      queueLength: queueStatus.queueLength,
      activeTransaction: queueStatus.activeTransaction,
      totalProcessed: queueStatus.totalProcessed,
      totalFailed: queueStatus.totalFailed,
    };
  }

  const statusCode = status === 'healthy' ? 200 : 503;

  return reply.status(statusCode).send(response);
});

// Register CORS
fastify.register(cors, {
  origin: "*", // In production, restrict this to your game's domain
});

fastify.get('/queue-status', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!transactionQueue) {
    return reply.status(503).send({ error: 'Transaction queue not initialized' });
  }

  const status = (transactionQueue as TransactionQueue).getStatus();

  return reply.send({
    queueLength: status.queueLength,
    activeTransaction: status.activeTransaction,
    lastCompletedTimestamp: status.lastCompletedTimestamp,
    totalProcessed: status.totalProcessed,
    totalFailed: status.totalFailed,
    uptime: process.uptime(),
  });
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
fastify.post("/verify-score", async (request: FastifyRequest<{ Body: VerifyScoreBody }>, reply: FastifyReply) => {
  let { proof, publicSignals } = request.body;

  proof = sanitizeProofData(proof);

  console.log("Proof", proof);
  console.log("publicSignals", publicSignals);

  const network: Network = (process.env.ZKVERIFY_NETWORK as Network) || "testnet";

  const validation = validateProofAndSignals(proof, publicSignals);
  if (!validation.valid) {
    logFailure({
      type: "VALIDATION_ERROR",
      proof: null,
      publicSignals: publicSignals || [],
      error: new Error(validation.error || "Invalid proof or publicSignals"),
      network
    });
    return reply.status(400).send({ error: validation.error || "Invalid proof or publicSignals" });
  }

  try {
    if (!transactionQueue) {
      fastify.log.error("Transaction queue not initialized");
      return reply.status(503).send({
        success: false,
        error: "Service unavailable - transaction queue not initialized"
      });
    }

    if (!zkSession || !zkSession.provider.isConnected) {
      if (isReconnecting) {
        fastify.log.warn("zkVerify session is reconnecting, request queued...");
        return reply.status(503).send({
          success: false,
          error: "Service temporarily unavailable - reconnecting to zkVerify",
          retryAfter: Math.min(
            BASE_RECONNECT_DELAY * Math.pow(2, reconnectionAttempts - 1),
            30000
          ) / 1000
        });
      } else {
        fastify.log.error("zkVerify session not available");
        return reply.status(503).send({
          success: false,
          error: "Service unavailable - zkVerify session not initialized"
        });
      }
    }

    const networkConfig = getNetworkConfig();

    fastify.log.info("Submitting proof to transaction queue...");

    const queueStatus = (transactionQueue as TransactionQueue).getStatus();

    const result = await (transactionQueue as TransactionQueue).submit(
      proof,
      publicSignals,
      cachedVK!,
      network
    );

    fastify.log.info(`Proof submission completed: ${result.success ? 'success' : 'failed'}`);

    return {
      success: true,
      message: "Proof submitted to zkVerify",
      transactionHash: result.txHash,
      explorerUrl: result.explorerUrl,
      queuePosition: queueStatus.queueLength + 1,
    };
  } catch (error: any) {
    const errorType = categorizeTransactionError(error);
    logFailure({
      type: categorizeZkError(error),
      proof,
      publicSignals,
      error,
      network
    });

    fastify.log.error(error);

    if (errorType === 'TRANSACTION_ERROR' || errorType === 'NETWORK_ERROR') {
      return reply.status(503).send({
        success: false,
        error: error.message,
        errorType,
        retryable: true,
      });
    }

    return reply.status(500).send({
      success: false,
      error: error.message,
      errorType,
    });
  }
});

// Run the server
const start = async () => {
  try {
    try {
      zkSession = await initializeZkSession();
      monitorSessionConnection();

      const network: Network = (process.env.ZKVERIFY_NETWORK as Network) || "testnet";
      cachedVK = await loadVerificationKey(network);
      fastify.log.info(`Loaded VK type: ${cachedVK.type}, hash: ${cachedVK.hash || 'inline (full VK object)'}`);

      transactionQueue = new TransactionQueue(
        {
          maxConcurrent: QUEUE_MAX_CONCURRENT,
          retryAttempts: QUEUE_RETRY_ATTEMPTS,
          retryDelay: QUEUE_RETRY_DELAY,
          timeout: QUEUE_TIMEOUT,
        },
        {
          submit: async (proof: any, publicSignals: any[], vk: any, network: any) => {
            return submitProofTransaction(proof, publicSignals, vk, network);
          }
        } as TransactionSubmitter
      );

      transactionQueue.on('processing', (data) => {
        fastify.log.info(`Processing transaction ${data.id}, ${data.queueRemaining} in queue`);
      });

      transactionQueue.on('completed', (data) => {
        fastify.log.info(`Transaction ${data.id} completed successfully`);
      });

      transactionQueue.on('failed', (data) => {
        fastify.log.error(`Transaction ${data.id} failed:`, data.error);
      });

      transactionQueue.on('retry', (data) => {
        fastify.log.warn(`Transaction ${data.id} retry ${data.retryCount}/${QUEUE_RETRY_ATTEMPTS}:`, data.error);
      });

      transactionQueue.on('queueCleared', (data) => {
        fastify.log.info(`Queue cleared: ${data.cleared} items, active interrupted: ${data.activeInterrupted}`);
      });

      fastify.log.info('✅ Transaction queue initialized');
    } catch (error) {
      fastify.log.error('Failed to initialize zkVerify session at startup');
      throw error;
    }

    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`Server listening on ${port}`);
    fastify.log.info(`Health check available at http://0.0.0.0:${port}/health`);
    fastify.log.info(`Queue status available at http://0.0.0.0:${port}/queue-status`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

async function shutdown() {
  fastify.log.info('Shutting down gracefully...');

  if (transactionQueue) {
    try {
      fastify.log.info('Shutting down transaction queue...');
      await transactionQueue.shutdown();
      fastify.log.info('✅ Transaction queue shut down');
    } catch (error) {
      fastify.log.error('Error shutting down transaction queue:', error as any);
    }
  }

  if (zkSession) {
    try {
      fastify.log.info('Closing zkVerify session...');
      await zkSession.close();
      fastify.log.info('✅ zkVerify session closed');
    } catch (error) {
      fastify.log.error('Error closing zkVerify session:', error as any);
    }
  }

  if (disconnectCleanup) {
    disconnectCleanup();
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
