import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { zkVerifySession, Library, CurveType, VerifyTransactionInfo } from "zkverifyjs";
import type { zkVerifySession as ZkVerifySessionType } from "zkverifyjs";
import dotenv from "dotenv";
import { getNetworkConfig, getSeedPhrase, Network } from "./src/zkNetworkConfig.js";
import { logFailure, categorizeError } from "./src/utils/zkFailureLogger.js";

dotenv.config();

const fastify: FastifyInstance = Fastify({ logger: true });

let zkSession: ZkVerifySessionType | null = null;
let isReconnecting = false;
let reconnectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;

let disconnectCleanup: (() => void) | null = null;

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

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  zkVerifyConnected: boolean;
  network: string;
  reconnectionAttempts?: number;
  isReconnecting?: boolean;
  uptime: number;
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

  const statusCode = status === 'healthy' ? 200 : 503;

  return reply.status(statusCode).send(response);
});

// Register CORS
fastify.register(cors, {
  origin: "*", // In production, restrict this to your game's domain
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

  proof = typeof proof === "string" ? JSON.parse(proof) : proof;

  console.log("Proof", proof);
  console.log("publicSignals", publicSignals);

  const network: Network = (process.env.ZKVERIFY_NETWORK as Network) || "testnet";

  const registeredVkHash = network === "testnet"
      ? process.env.REGISTERED_VK_HASH_TESTNET
      : process.env.REGISTERED_VK_HASH_MAINNET;

  if (!proof || !publicSignals) {
    logFailure({
      type: "VALIDATION_ERROR",
      proof: null,
      publicSignals: publicSignals || [],
      error: new Error("Missing proof or publicSignals"),
      network
    });
    return reply.status(400).send({ error: "Missing proof or publicSignals" });
  }

  if (!registeredVkHash) {
    logFailure({
      type: "VALIDATION_ERROR",
      proof: null,
      publicSignals: [],
      error: new Error(`REGISTERED_VK_HASH_${network.toUpperCase()} not set in environment`),
      network
    });
    return reply.status(500).send({
      error: `Server misconfigured: REGISTERED_VK_HASH_${network.toUpperCase()} not set. Run 'npm run register:vk:${network}' first.`
    });
  }

  try {
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

    fastify.log.info("Submitting proof to zkVerify...");

    const { transactionResult } = await zkSession
      .verify()
      .groth16({
        library: Library.snarkjs,
        curve: CurveType.bn128,
      })
      .withRegisteredVk()
      .execute({
        proofData: {
          proof: proof,
          publicSignals: publicSignals,
          vk: registeredVkHash,
        },
      });

    const transactionInfo = (await transactionResult) as VerifyTransactionInfo;
    fastify.log.info(`Transaction submitted: ${transactionInfo.txHash}`);

    return {
      success: true,
      message: "Proof submitted to zkVerify",
      transactionHash: transactionInfo.txHash,
      explorerUrl: `${networkConfig.explorer}/vverify/transaction/${transactionInfo.txHash}`,
    };
  } catch (error: any) {
    logFailure({
      type: categorizeError(error),
      proof,
      publicSignals,
      error,
      network
    });

    fastify.log.error(error);
    return reply.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// Run the server
const start = async () => {
  try {
    try {
      zkSession = await initializeZkSession();
      monitorSessionConnection();
    } catch (error) {
      fastify.log.error('Failed to initialize zkVerify session at startup');
      throw error;
    }

    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`Server listening on ${port}`);
    fastify.log.info(`Health check available at http://0.0.0.0:${port}/health`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

async function shutdown() {
  fastify.log.info('Shutting down gracefully...');
  
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
