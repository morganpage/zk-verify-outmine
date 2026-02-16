import crypto from "crypto";
import { Network } from "../zkNetworkConfig.js";

type FailureType = "VALIDATION_ERROR" | "SUBMISSION_ERROR" | "VERIFICATION_FAILED" | "TRANSACTION_ERROR" | "NETWORK_ERROR" | "UNKNOWN_ERROR";

interface LogFailureParams {
  type: FailureType;
  proof: any;
  publicSignals: any[];
  error: Error;
  network: string;
}

function generateProofHash(proof: any): string {
  if (!proof) return "null";
  return crypto.createHash("sha256").update(JSON.stringify(proof)).digest("hex").substring(0, 16);
}

function extractPublicSignalsData(publicSignals: any[]): { claimedTotal: string; sessionId: string; playerAddress: string } {
  return {
    claimedTotal: publicSignals[2] || "unknown",
    sessionId: publicSignals[3] || "unknown",
    playerAddress: publicSignals[4] || "unknown"
  };
}

function categorizeError(error: Error): FailureType {
  const message = (error.message || "").toLowerCase();

  if (message.includes("missing") || message.includes("invalid")) {
    return "VALIDATION_ERROR";
  }
  if (message.includes("verification") || message.includes("proof")) {
    return "VERIFICATION_FAILED";
  }
  if (message.includes("transaction") || message.includes("balance")) {
    return "TRANSACTION_ERROR";
  }
  if (message.includes("network") || message.includes("timeout") || message.includes("connection")) {
    return "NETWORK_ERROR";
  }
  if (message.includes("submission") || message.includes("session")) {
    return "SUBMISSION_ERROR";
  }

  return "UNKNOWN_ERROR";
}

export function logFailure(params: LogFailureParams): void {
  const { type, proof, publicSignals, error, network } = params;
  const publicSignalsData = extractPublicSignalsData(publicSignals);
  
  const failureRecord = {
    timestamp: new Date().toISOString(),
    failureType: type,
    network,
    proofData: {
      proofHash: generateProofHash(proof),
      claimedTotal: publicSignalsData.claimedTotal,
      sessionId: publicSignalsData.sessionId,
      playerAddress: publicSignalsData.playerAddress
    },
    error: {
      message: error.message || "Unknown error",
      stack: error.stack || ""
    },
    server: {
      nodeVersion: process.version,
      processUptime: process.uptime()
    }
  };
  
  console.log(`❌ FAILED_VERIFICATION: ${JSON.stringify(failureRecord)}`);
}

export { categorizeError };
