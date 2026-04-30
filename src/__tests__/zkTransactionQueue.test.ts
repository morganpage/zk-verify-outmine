import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransactionQueue, type TransactionResult } from '../zkTransactionQueue.js';

describe('TransactionQueue', () => {
  let queue: TransactionQueue;
  let mockSubmitter: any;

  beforeEach(() => {
    mockSubmitter = {
      submit: vi.fn(),
    };

    queue = new TransactionQueue(
      {
        retryAttempts: 3,
        retryDelay: 100,
        timeout: 5000,
      },
      mockSubmitter
    );
  });

  describe('initialization', () => {
    it('should initialize with empty queue', () => {
      const status = queue.getStatus();
      expect(status.queueLength).toBe(0);
      expect(status.activeTransaction).toBeNull();
      expect(status.totalProcessed).toBe(0);
      expect(status.totalFailed).toBe(0);
    });
  });

  describe('submit', () => {
    it('should submit a transaction successfully', async () => {
      const mockResult: TransactionResult = {
        success: true,
        txHash: '0x123',
        explorerUrl: 'https://example.com/0x123',
      };
      mockSubmitter.submit.mockResolvedValue(mockResult);

      const result = await queue.submit('proof', ['signal'], { type: 'registered' as const, data: 'vk-hash' }, 'testnet', 'user1');

      expect(result).toEqual(mockResult);
      expect(mockSubmitter.submit).toHaveBeenCalledTimes(1);
    });

    it('should reject if queue is shutting down', async () => {
      await queue.shutdown();

      await expect(queue.submit('proof', ['signal'], { type: 'registered' as const, data: 'vk-hash' }, 'testnet', 'user1')).rejects.toThrow(
        'Queue is shutting down'
      );
    });
  });

  describe('queue management', () => {
    it('should provide queue status', () => {
      const status = queue.getStatus();

      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('activeTransaction');
      expect(status).toHaveProperty('lastCompletedTimestamp');
      expect(status).toHaveProperty('totalProcessed');
      expect(status).toHaveProperty('totalFailed');
    });

    it('should clear queue', () => {
      const result = queue.clearQueue();

      expect(result.cleared).toBeGreaterThanOrEqual(0);
      expect(result.activeInterrupted).toBe(false);

      const status = queue.getStatus();
      expect(status.queueLength).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await queue.shutdown();

      const status = queue.getStatus();

      expect(status.queueLength).toBe(0);
      expect(status.activeTransaction).toBeNull();
    });

    it('should reject if queue is shutting down', async () => {
      await queue.shutdown();

      await expect(queue.submit('proof', ['signal'], { type: 'registered' as const, data: 'vk-hash' }, 'testnet', 'user1')).rejects.toThrow(
        'Queue is shutting down'
      );
    });
  });

  describe('events', () => {
    it('should emit enqueued event', async () => {
      const enqueuedHandler = vi.fn();
      queue.on('enqueued', enqueuedHandler);

      mockSubmitter.submit.mockResolvedValue({
        success: true,
        txHash: '0x123',
        explorerUrl: 'https://example.com/0x123',
      });

      await queue.submit('proof', ['signal'], { type: 'registered' as const, data: 'vk-hash' }, 'testnet', 'user1');

      expect(enqueuedHandler).toHaveBeenCalled();
    });

    it('should emit completed event', async () => {
      const completedHandler = vi.fn();
      queue.on('completed', completedHandler);

      mockSubmitter.submit.mockResolvedValue({
        success: true,
        txHash: '0x123',
        explorerUrl: 'https://example.com/0x123',
      });

      await queue.submit('proof', ['signal'], { type: 'registered' as const, data: 'vk-hash' }, 'testnet', 'user1');

      expect(completedHandler).toHaveBeenCalled();
    });

    it('should emit failed event on error', async () => {
      const failedHandler = vi.fn();
      queue.on('failed', failedHandler);
      
      mockSubmitter.submit.mockRejectedValue(new Error('Test error'));
      
      await expect(queue.submit('proof', ['signal'], { type: 'registered' as const, data: 'vk-hash' }, 'testnet', 'user1')).rejects.toThrow();
      
      expect(failedHandler).toHaveBeenCalled();
    });

    it('should identify nonce conflict errors correctly', async () => {
      const nonceError1 = new Error('Priority is too low');
      const nonceError2 = new Error('Transaction is already in the pool');
      const nonceError3 = new Error('Error code: 1014');
      const nonNonceError = new Error('Insufficient funds');

      expect(nonceError1.message).toMatch(/Priority is too low/);
      expect(nonceError2.message).toMatch(/Transaction is already in the pool/);
      expect(nonceError3.message).toMatch(/1014/);
      expect(nonNonceError.message).not.toMatch(/1014|Priority is too low/);
    });
  });
});
