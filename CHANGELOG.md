# Update: Fixed Duplicate Logging Issue

## Problem
Previously, the error logger was creating 3 log entries for a single verification failure:

1. ❌ UNKNOWN_ERROR (empty stack, "Unknown error" message)
2. ❌ VERIFICATION_FAILED (correct message)
3. ❌ VERIFICATION_FAILED (duplicate of #2)

## Root Cause
The server had **duplicate error handling**:
- Event listener: `events.on("error", ...)` - logged error first
- Catch block: Caught the same error and logged it again

This resulted in the same error being logged 2-3 times.

## Solution
**Removed the error event listener logging.** Now only the try-catch block handles and logs errors.

### Before (server.ts):
```typescript
const { events, transactionResult } = await session.verify()...execute({...});

// Event listener - logged error #1
events.on("error", (error: Error) => {
  logFailure({ type: categorizeError(error), ... }); // Log here!
});

const transactionInfo = await transactionResult; // Throws error

// Catch block - logged error #2
catch (error: any) {
  logFailure({ type: categorizeError(error), ... }); // And log again!
}
```

### After (server.ts):
```typescript
const { transactionResult } = await session.verify()...execute({...});

const transactionInfo = await transactionResult; // Throws error

// Catch block - logs error once
catch (error: any) {
  logFailure({ type: categorizeError(error), ... }); // Only log here!
}
```

## Result
Now each verification failure generates **exactly 1 log entry**:

```
❌ FAILED_VERIFICATION: {"timestamp":"...","failureType":"VERIFICATION_FAILED","network":"testnet","proofData":{...},"error":{"message":"Verify proof failed.","stack":"..."},"server":{...}}
```

## Changes Made
1. Removed `events` destructuring from execute() result
2. Removed error event listener that caused duplicate logging
3. Kept try-catch block as single source of error logging
4. All errors now categorized and logged consistently

## Test
```bash
npm run build
npm run dev

# Submit invalid proof
# Should see exactly ONE failure log entry
```

**Fixed!** 🎉
