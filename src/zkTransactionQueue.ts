import EventEmitter from 'events';

export interface QueueItem {
  id: string;
  proof: any;
  publicSignals: any[];
  vk: {
    type: "registered" | "inline";
    data: string | any;
    hash?: string;
  };
  network: "testnet" | "mainnet";
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

export interface QueueStatus {
  queueLength: number;
  activeTransaction: ActiveTransactionInfo | null;
  lastCompletedTimestamp: number | null;
  totalProcessed: number;
  totalFailed: number;
}

export interface ActiveTransactionInfo {
  id: string;
  txHash?: string;
  timestamp: number;
  retryCount: number;
  status: 'submitting' | 'in-block' | 'finalizing';
}

export interface QueueConfig {
  maxConcurrent: number;
  retryAttempts: number;
  retryDelay: number;
  timeout: number;
}

export interface TransactionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  explorerUrl?: string;
}

export interface TransactionSubmitter {
  submit: (
    proof: any,
    publicSignals: any[],
    vk: {
      type: "registered" | "inline";
      data: string | any;
      hash?: string;
    },
    network: "testnet" | "mainnet"
  ) => Promise<TransactionResult>;
}

export class TransactionQueue extends EventEmitter {
  private queue: QueueItem[] = [];
  private activeTransaction: ActiveTransactionInfo | null = null;
  private isProcessing: boolean = false;
  private isShuttingDown: boolean = false;

  private lastCompletedTimestamp: number | null = null;
  private totalProcessed: number = 0;
  private totalFailed: number = 0;

  private config: QueueConfig;
  private submitter: TransactionSubmitter;

  constructor(config: QueueConfig, submitter: TransactionSubmitter) {
    super();
    this.config = config;
    this.submitter = submitter;
  }

  getStatus(): QueueStatus {
    return {
      queueLength: this.queue.length,
      activeTransaction: this.activeTransaction,
      lastCompletedTimestamp: this.lastCompletedTimestamp,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
    };
  }

  clearQueue(): { cleared: number; activeInterrupted: boolean } {
    const cleared = this.queue.length;
    const activeInterrupted = this.activeTransaction !== null;
    this.queue = [];
    this.emit('queueCleared', { cleared, activeInterrupted });
    return { cleared, activeInterrupted };
  }

  async submit(
    proof: any,
    publicSignals: any[],
    vk: {
      type: 'registered' | 'inline';
      data: string | any;
      hash?: string;
    },
    network: 'testnet' | 'mainnet',
    timeout?: number
  ): Promise<TransactionResult> {
    if (this.isShuttingDown) {
      throw new Error('Queue is shutting down, cannot accept new submissions');
    }

    const id = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const item: QueueItem = {
      id,
      proof,
      publicSignals,
      vk,
      network,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: this.config.retryAttempts,
    };

    this.queue.push(item);
    this.emit('enqueued', { id, queueLength: this.queue.length });

    this.processQueue();

    return new Promise((resolve, reject) => {
      const itemTimeout = setTimeout(() => {
        const index = this.queue.findIndex(i => i.id === id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error(`Transaction timeout after ${timeout || this.config.timeout}ms`));
        }
      }, timeout || this.config.timeout);

      this.once(`completed_${id}`, (result: TransactionResult) => {
        clearTimeout(itemTimeout);
        this.removeListener(`failed_${id}`, reject as any);
        resolve(result);
      });

      this.once(`failed_${id}`, (error: Error) => {
        clearTimeout(itemTimeout);
        this.removeListener(`completed_${id}`, resolve as any);
        reject(error);
      });
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || this.isShuttingDown) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && !this.isShuttingDown) {
        const item = this.queue.shift()!;

        this.activeTransaction = {
          id: item.id,
          timestamp: item.timestamp,
          retryCount: item.retryCount,
          status: 'submitting',
        };

        this.emit('processing', { id: item.id, queueRemaining: this.queue.length });

        try {
          const result = await this.executeTransaction(item);

          this.lastCompletedTimestamp = Date.now();
          this.totalProcessed++;
          this.activeTransaction = null;
          this.emit(`completed_${item.id}`, result);
          this.emit('completed', { id: item.id, result });
        } catch (error: any) {
          const errorMsg = error.message || String(error);

          if (this.isNonceConflict(errorMsg) && item.retryCount < item.maxRetries) {
            item.retryCount++;
            this.queue.unshift(item);
            this.activeTransaction = null;
            this.emit('retry', { id: item.id, retryCount: item.retryCount, error: errorMsg });

            await this.delay(this.config.retryDelay);
          } else {
            this.activeTransaction = null;
            this.totalFailed++;
            this.emit(`failed_${item.id}`, error);
            this.emit('failed', { id: item.id, error });
          }
        }
      }
    } finally {
      this.isProcessing = false;
      this.activeTransaction = null;
    }
  }

  private async executeTransaction(item: QueueItem): Promise<TransactionResult> {
    return await this.submitter.submit(item.proof, item.publicSignals, item.vk, item.network);
  }

  private isNonceConflict(errorMessage: string): boolean {
    return (
      errorMessage.includes('Priority is too low') ||
      errorMessage.includes('1014') ||
      errorMessage.includes('Transaction is already in the pool') ||
      errorMessage.includes('Invalid Transaction')
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    const status = this.getStatus();

    this.emit('shutdownInitiated', status);

    while (this.isProcessing) {
      await this.delay(100);
    }

    this.removeAllListeners();

    this.emit('shutdownComplete', status);
  }

  pause(): void {
    this.isProcessing = false;
    this.emit('paused');
  }

  resume(): void {
    if (!this.isProcessing && !this.isShuttingDown) {
      this.emit('resumed');
      this.processQueue();
    }
  }
}
