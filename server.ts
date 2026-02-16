import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { zkVerifySession, Library, CurveType, VerifyTransactionInfo } from "zkverifyjs";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { getNetworkConfig, getSeedPhrase, Network } from "./src/networkConfig.js";
import { logFailure, categorizeError } from "./src/utils/failureLogger.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify: FastifyInstance = Fastify({ logger: true });

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

  try {
    fastify.log.info("Starting zkVerify submission...");

    const networkConfig = getNetworkConfig();

    fastify.log.info(`Starting zkVerify submission to ${networkConfig.name}...`);

    const seedPhrase = getSeedPhrase(network);

    const session = await zkVerifySession
      .start()
      .Custom({
        websocket: networkConfig.websocket,
        rpc: networkConfig.rpc,
        network: network === "mainnet" ? "zkVerify" : "Volta",
      })
      .withAccount(seedPhrase);

    // 2. Load the Verification Key
    const vkeyPath = path.join(__dirname, "..", "verification_key.json");
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));

    // 3. Submit for verification
    const { transactionResult } = await session
      .verify()
      .groth16({
        library: Library.snarkjs,
        curve: CurveType.bn128,
      })
      .execute({
        proofData: {
          proof: proof,
          publicSignals: publicSignals,
          vk: vkey,
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
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`Server listening on ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
