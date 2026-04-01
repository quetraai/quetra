# @quetra/core

[![npm version](https://img.shields.io/npm/v/@quetra/core.svg)](https://www.npmjs.com/package/@quetra/core)
[![license](https://img.shields.io/npm/l/@quetra/core.svg)](https://opensource.org/licenses/MIT)

Types, policy evaluation engine, and Ed25519 mandate signing for [QuetraAI](https://quetra.dev) — the programmable mandate layer for AI agent spending.

## Install

```bash
npm install @quetra/core
```

## What's Inside

### Types

All core interfaces for the QuetraAI governance model:

- `Organization`, `Agent`, `Mandate`, `MandateBudget`, `OnChainConfig`
- `MandateRule` — union of 7 rule types (category, vendor allowlist/blocklist, time window, rate limit, approval threshold, custom JSONLogic)
- `MandateToken`, `TransactionRecord`, `EvaluationContext`, `EvaluationResult`, `RuleEvaluation`
- `WebhookEventType`, `WebhookEvent`

### Rule Engine

Evaluate payment requests against mandate policies. All rules use AND logic — every rule must pass for approval.

```typescript
import { evaluateMandate } from '@quetra/core';

const result = evaluateMandate(mandate, {
  amount: 500, // $5.00 in cents
  currency: 'USDC',
  vendor: 'api.datavendor.com',
  category: 'research',
  timestamp: new Date(),
  recentTransactionCount: 3,
});

console.log(result.decision); // 'approved' | 'rejected'
console.log(result.evaluations); // per-rule results
```

**Rule types:** `category`, `vendor_allowlist`, `vendor_blocklist`, `time_window`, `rate_limit`, `approval_threshold`, `custom` (JSONLogic).

### Cryptographic Signing

Ed25519 key generation, mandate signing, and token verification via `@noble/ed25519`.

```typescript
import { generateKeyPair, signMandate, createMandateToken, verifyMandateToken } from '@quetra/core';

// Generate org key pair
const { publicKey, privateKey } = await generateKeyPair();

// Sign a mandate
const signature = await signMandate(mandate, privateKey);

// Create a portable token (agent carries this)
const token = await createMandateToken(mandate, privateKey);

// Verify token authenticity
const verified = await verifyMandateToken(token, publicKey);
```

## Requirements

- Node.js >= 20
- ESM only (`"type": "module"`)

## Related Packages

- [`@quetra/sdk`](https://www.npmjs.com/package/@quetra/sdk) — Client SDK for AI agents
- [`@quetra/mcp`](https://www.npmjs.com/package/@quetra/mcp) — MCP server for Claude and other MCP-compatible agents

## License

MIT
