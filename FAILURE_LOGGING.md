# Failure Logging

Failed proof verifications are automatically logged to the console with structured JSON data for debugging purposes.

## Log Format

All failures are logged as single-line JSON with the prefix `❌ FAILED_VERIFICATION:`:

```
❌ FAILED_VERIFICATION: {"timestamp":"2025-02-16T12:34:56.789Z","failureType":"VERIFICATION_FAILED","network":"testnet","proofData":{"proofHash":"a1b2c3d4e5f6","claimedTotal":"1000","sessionId":"1736543210123456789","playerAddress":"0x1234...5678"},"error":{"message":"Proof verification failed","stack":"Error: ..."},"server":{"nodeVersion":"v20.x.x","processUptime":123.45}}
```

## Failure Types

| Type | When Logged |
|------|-------------|
| `VALIDATION_ERROR` | Missing or invalid inputs |
| `SUBMISSION_ERROR` | Failed to submit to zkVerify |
| `VERIFICATION_FAILED` | Proof rejected by zkVerify |
| `TRANSACTION_ERROR` | Transaction failed or rejected |
| `NETWORK_ERROR` | RPC timeout, connection issues |
| `UNKNOWN_ERROR` | Unclassified errors |

## Log Structure

```typescript
{
  "timestamp": string,           // ISO 8601 timestamp
  "failureType": FailureType,      // One of the types above
  "network": string,              // 'testnet' or 'mainnet'
  "proofData": {
    "proofHash": string,          // SHA256 hash of proof (16 chars)
    "claimedTotal": string,       // Public signal: score claimed
    "sessionId": string,          // Public signal: session ID
    "playerAddress": string       // Public signal: wallet address
  },
  "error": {
    "message": string,          // Error message (fallback: "Unknown error")
    "stack": string             // Stack trace (if available)
  },
  "server": {
    "nodeVersion": string,       // Node.js version
    "processUptime": number     // Server uptime in seconds
  }
}
```

**Note**: The error handling is robust and handles edge cases:
- Errors without messages are logged as "Unknown error"
- Errors with undefined `message` property are handled gracefully
- All errors are categorized using message content analysis
- Stack traces are preserved when available

## Usage

### View in Console

```bash
npm run dev
```

### Redirect to File

```bash
npm run dev > failures.log 2>&1
```

### Filter by Failure Type

```bash
npm run dev 2>&1 | grep "VERIFICATION_FAILED"
```

### Filter Multiple Types

```bash
npm run dev 2>&1 | grep -E "(VERIFICATION_FAILED|TRANSACTION_ERROR)"
```

### Extract JSON with jq (requires jq)

```bash
npm run dev 2>&1 | grep "FAILED_VERIFICATION" | jq -r '.error.message'
```

### Count Failures by Type

```bash
npm run dev 2>&1 | grep "FAILED_VERIFICATION" | grep -oP '"failureType":"\K[^"]+' | sort | uniq -c
```

### Find Failures for Specific Player

```bash
npm run dev 2>&1 | grep "0x1234...5678"
```

### Tail Failures in Real-time

```bash
npm run dev 2>&1 | grep "FAILED_VERIFICATION"
```

## Examples

### Example 1: Validation Error

```json
❌ FAILED_VERIFICATION: {"timestamp":"2025-02-16T12:34:56.789Z","failureType":"VALIDATION_ERROR","network":"testnet","proofData":{"proofHash":"null","claimedTotal":"unknown","sessionId":"unknown","playerAddress":"unknown"},"error":{"message":"Missing proof or publicSignals","stack":"Error: Missing proof or publicSignals\n    at ..."},"server":{"nodeVersion":"v20.11.0","processUptime":123.456}}
```

### Example 2: Verification Failed

```json
❌ FAILED_VERIFICATION: {"timestamp":"2025-02-16T12:35:01.234Z","failureType":"VERIFICATION_FAILED","network":"testnet","proofData":{"proofHash":"a1b2c3d4e5f6","claimedTotal":"1000","sessionId":"1736543210123456789","playerAddress":"0x1234...5678"},"error":{"message":"Proof verification failed on chain","stack":"Error: Proof verification failed\n    at ..."},"server":{"nodeVersion":"v20.11.0","processUptime":124.789}}
```

### Example 3: Network Error

```json
❌ FAILED_VERIFICATION: {"timestamp":"2025-02-16T12:35:15.567Z","failureType":"NETWORK_ERROR","network":"testnet","proofData":{"proofHash":"b2c3d4e5f6g7","claimedTotal":"1000","sessionId":"1736543210123456789","playerAddress":"0x1234...5678"},"error":{"message":"RPC timeout after 30000ms","stack":"Error: RPC timeout\n    at ..."},"server":{"nodeVersion":"v20.11.0","processUptime":129.012}}
```

## Monitoring

### Check Failure Rate

```bash
# Count failures in last hour
npm run dev 2>&1 | grep "FAILED_VERIFICATION" | wc -l
```

### Monitor Specific Error Patterns

```bash
# Watch for timeout errors
npm run dev 2>&1 | grep -i "timeout"
```

### Export Failures for Analysis

```bash
# Export to JSON file
npm run dev 2>&1 | grep "FAILED_VERIFICATION" | sed 's/❌ FAILED_VERIFICATION: //' > failures.json
```

## Integration

The failure logger is automatically integrated into the `/verify-score` endpoint:

- **Validation errors** (missing/invalid inputs) are logged immediately
- **All other errors** (submission, verification, network) are logged in catch block
- **Each failure generates exactly 1 log entry** (no duplicates)
- **Proof hash** is generated from proof data for identification
- **Public signals** are extracted to show claimed score, session ID, and player address

## Future Upgrades

To upgrade from console logging to MongoDB:

1. Replace `console.log()` in `src/utils/failureLogger.ts` with MongoDB insert
2. Add MongoDB connection to `server.ts`
3. Create Mongoose schema matching the log structure
4. No changes needed to the calling code in `server.ts`
