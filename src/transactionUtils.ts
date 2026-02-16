import type { zkVerifySession as ZkVerifySessionType } from 'zkverifyjs';

export interface AccountNonce {
  nonce: number;
  address: string;
}

export interface TransactionStatus {
  exists: boolean;
  isFinalized: boolean;
  isPending: boolean;
  blockHash?: string;
  finalizedBlockHash?: string;
}

export const TRANSACTION_TIMEOUT_MS = 300000;
export const TRANSACTION_CHECK_INTERVAL_MS = 10000;

export async function getCurrentNonce(
  session: ZkVerifySessionType,
  address?: string
): Promise<number> {
  try {
    const accountInfo = await session.getAccountInfo(address);

    if (!accountInfo || accountInfo.length === 0) {
      throw new Error('No account information available');
    }

    const nonce = accountInfo[0].nonce;
    if (typeof nonce !== 'number' && typeof nonce !== 'string') {
      throw new Error(`Invalid nonce type: ${typeof nonce}`);
    }

    return typeof nonce === 'string' ? parseInt(nonce, 10) : nonce;
  } catch (error) {
    throw new Error(`Failed to get current nonce: ${(error as Error).message}`);
  }
}

export function incrementNonce(currentNonce: number): number {
  return currentNonce + 1;
}

export async function waitForFinalization(
  txHash: string,
  api: any,
  timeout: number = TRANSACTION_TIMEOUT_MS
): Promise<{ blockHash: string; finalized: boolean }> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      api.rpc.chain
        .getBlock()
        .then((block: any) => {
          if (!block) {
            return;
          }

          const finalizedBlockHash = block.hash.toString();
          const isFinalized = true;

          clearInterval(checkInterval);
          resolve({ blockHash: finalizedBlockHash, finalized: isFinalized });
        })
        .catch((error: any) => {
        });

      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error(`Transaction ${txHash} not finalized after ${timeout}ms`));
      }
    }, TRANSACTION_CHECK_INTERVAL_MS);
  });
}

export async function getTransactionStatus(
  txHash: string,
  api: any
): Promise<TransactionStatus> {
  try {
    const tx = await api.rpc.chain.getBlockHash().catch(() => null);

    if (!tx) {
      return {
        exists: false,
        isFinalized: false,
        isPending: false,
      };
    }

    const block = await api.rpc.chain.getBlock(tx).catch(() => null);

    if (!block) {
      return {
        exists: true,
        isFinalized: false,
        isPending: true,
      };
    }

    const txExists = block.extrinsics.some(
      (extrinsic: any) => extrinsic.hash.toString() === txHash
    );

    if (!txExists) {
      return {
        exists: false,
        isFinalized: false,
        isPending: false,
      };
    }

    const finalizedBlock = await api.rpc.chain
      .getFinalizedHead()
      .catch(() => null);

    if (finalizedBlock && finalizedBlock.toString() === tx) {
      return {
        exists: true,
        isFinalized: true,
        isPending: false,
        finalizedBlockHash: tx,
      };
    }

    return {
      exists: true,
      isFinalized: false,
      isPending: true,
      blockHash: tx,
    };
  } catch (error) {
    return {
      exists: false,
      isFinalized: false,
      isPending: false,
    };
  }
}

export function isNonceConflictError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('priority is too low') ||
    message.includes('1014') ||
    message.includes('transaction is already in the pool') ||
    message.includes('invalid transaction') ||
    message.includes('nonce')
  );
}

export function categorizeTransactionError(error: any): 'VALIDATION_ERROR' | 'SUBMISSION_ERROR' | 'VERIFICATION_FAILED' | 'TRANSACTION_ERROR' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR' {
  if (!error) return 'UNKNOWN_ERROR';

  const message = error.message || String(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('priority is too low') || lowerMessage.includes('1014')) {
    return 'TRANSACTION_ERROR';
  }

  if (lowerMessage.includes('invalid transaction')) {
    return 'TRANSACTION_ERROR';
  }

  if (lowerMessage.includes('insufficient balance') || lowerMessage.includes('payment')) {
    return 'TRANSACTION_ERROR';
  }

  if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
    return 'NETWORK_ERROR';
  }

  if (lowerMessage.includes('timeout')) {
    return 'NETWORK_ERROR';
  }

  if (lowerMessage.includes('proof') || lowerMessage.includes('verification')) {
    return 'VERIFICATION_FAILED';
  }

  if (lowerMessage.includes('missing') || lowerMessage.includes('invalid')) {
    return 'VALIDATION_ERROR';
  }

  if (lowerMessage.includes('submission') || lowerMessage.includes('session')) {
    return 'SUBMISSION_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

export function calculateBackoffDelay(
  retryCount: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000
): number {
  const exponentialDelay = baseDelay * Math.pow(2, retryCount);
  const jitter = Math.random() * 1000;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

export function sanitizeProofData(proof: any): any {
  if (typeof proof === 'string') {
    try {
      return JSON.parse(proof);
    } catch {
      return proof;
    }
  }
  return proof;
}

export function validateProofAndSignals(
  proof: any,
  publicSignals: any[]
): { valid: boolean; error?: string } {
  if (!proof) {
    return { valid: false, error: 'Proof is required' };
  }

  if (!publicSignals || !Array.isArray(publicSignals)) {
    return { valid: false, error: 'Public signals must be an array' };
  }

  if (publicSignals.length === 0) {
    return { valid: false, error: 'Public signals array is empty' };
  }

  return { valid: true };
}
