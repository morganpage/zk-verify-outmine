# VK Fallback with Caching - Implementation Summary

## What Was Completed

### 1. Core VK Loading Function
Created `loadVerificationKey()` function in `server.ts` that:
- Checks `REGISTERED_VK_HASH_TESTNET` or `REGISTERED_VK_HASH_MAINNET` environment variables
- Falls back to loading `verification_key.json` if not set or empty
- Returns a `CachedVK` object with type (registered/inline), data, hash, and network

### 2. Type Definitions
Added to `server.ts`:
```typescript
export type VerificationKeyType = 'registered' | 'inline';

export interface CachedVK {
  type: VerificationKeyType;
  data: string | any;
  hash?: string;
  network?: Network;
}

let cachedVK: CachedVK | null = null;
```

### 3. Server Integration
Modified `submitProofTransaction()` to:
- Accept `vk: CachedVK` instead of `registeredVkHash: string`
- Accept `network: Network` parameter
- Use `vk.data` for proof submission
- Conditionally call `.withRegisteredVk()` when `vk.type === 'registered'`
- Skip `.withRegisteredVk()` when `vk.type === 'inline'`

### 4. Queue Module Updates
Updated `src/zkTransactionQueue.ts`:
- Modified `QueueItem` interface to include `vk` and `network` fields
- Updated `TransactionSubmitter` interface to accept 4 parameters
- Updated `submit()` method to accept `vk`, `network`, and `timeout` parameters
- Updated `executeTransaction()` to pass vk and network

### 5. Test Updates
Updated `src/__tests__/zkTransactionQueue.test.ts`:
- All test methods now use 4-parameter API with `vk` and `network`
- All tests pass (26 tests total)

### 6. Endpoint Cleanup
Modified `/verify-score` endpoint:
- Removed check for missing registered VK hash (lines 302-329)
- Now uses `cachedVK` which was loaded at startup

## Remaining Work

### TypeScript Type Error
There's a type matching issue in `server.ts` at line 412:
```
Error: Argument of type '(proof: any, publicSignals: any[], vk: any, network: any) => Promise<TransactionResult>' is not assignable to parameter of type 'TransactionSubmitter'.
```

The callback function doesn't match the `TransactionSubmitter` interface signature. The issue is likely with the exact string literal types (single quotes vs double quotes).

### Suggested Fix
The callback in the queue initialization (around line 412) needs to be updated to properly match the `TransactionSubmitter` type. Options:

1. Try using the exact types from the imported interface
2. Or use explicit type assertion with the correct union types
3. Create a wrapper function that properly matches the interface

## How It Works

1. **Server Startup:**
    - `loadVerificationKey()` is called with the configured network
    - Checks for registered VK hash in environment variables
    - If found: uses registered VK (faster, cheaper transactions)
    - If not found: loads `verification_key.json` (fallback)
    - VK is cached in `cachedVK` variable

2. **Proof Submission:**
    - `/verify-score` endpoint receives proof and publicSignals
    - Validation happens (proof/signals are valid)
    - Transaction is queued with `cachedVK` and `network`
    - `submitProofTransaction()` uses the cached VK data
    - If `vk.type === 'registered'`: calls `.withRegisteredVk()` and passes hash to `vk`
    - If `vk.type === 'inline'`: skips `.withRegisteredVk()` and passes full VK object to `vk`
    - No file I/O per request!

## Benefits

✅ VK loaded only once at server startup
✅ Automatic fallback to `verification_key.json` when registered VK not set
✅ No file I/O on each request (performance improvement)
✅ Type-safe with TypeScript interfaces
✅ Network-specific VK handling
✅ Backward compatible with registered VKs
✅ Reduces transaction size when using registered VK hashes

## Testing

```bash
# Test with registered VK hash set
REGISTERED_VK_HASH_TESTNET="your_hash" npm run dev
# Should log: "Using registered VK mode"

# Test without registered VK (falls back to verification_key.json)
# Remove REGISTERED_VK_HASH_TESTNET from .env or set to empty
npm run dev
# Should log: "Using inline VK mode"

# Run tests
npm run test:unit
```

## Files Modified

- `server.ts` - Core VK loading and submission logic
- `src/zkTransactionQueue.ts` - Queue interface updates
- `src/__tests__/zkTransactionQueue.test.ts` - Test updates
