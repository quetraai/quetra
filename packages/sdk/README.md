# @quetra/sdk

[![npm version](https://img.shields.io/npm/v/@quetra/sdk.svg)](https://www.npmjs.com/package/@quetra/sdk)
[![license](https://img.shields.io/npm/l/@quetra/sdk.svg)](https://opensource.org/licenses/MIT)

Client SDK for [QuetraAI](https://quetra.dev) — mandate-governed spending for AI agents. Define what your agents can spend, on what, and when.

## Install

```bash
npm install @quetra/sdk
```

## Quick Start

```typescript
import { QuetraClient } from '@quetra/sdk';

// Initialize from environment variables
const quetra = QuetraClient.fromEnv();
// Or configure explicitly
const quetra = new QuetraClient({
  apiKey: 'sk_...',
  agentId: 'agent-uuid',
  gatewayUrl: 'https://gateway.quetra.dev',
});

// Check if the agent can spend before making a purchase
const result = await quetra.evaluate({
  vendor: 'api.datavendor.com',
  amount: 500, // $5.00 in cents
  category: 'research',
});

if (result.decision === 'approved') {
  // Proceed with the purchase
}
```

### x402-Aware Fetch

Transparently handle x402 payment-required responses:

```typescript
// Automatically handles 402 → evaluate mandate → retry with payment signature
const response = await quetra.fetch('https://api.datavendor.com/research/trends');
const data = await response.json();
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `QUETRA_API_KEY` | Yes | Your organization's API key (`sk_...`) |
| `QUETRA_AGENT_ID` | Yes | The agent's UUID |
| `QUETRA_GATEWAY_URL` | No | Gateway URL (defaults to `https://gateway.quetra.dev`) |

## API Reference

### Client Methods

| Method | Description |
|--------|-------------|
| `evaluate(req)` | Pre-flight spend check against mandate rules and budget |
| `canSpend(amount, vendor, category?)` | Boolean check — throws `MandateRejectionError` on rejection |
| `fetch(url, init?)` | x402-aware fetch — auto-handles 402 payment flows |
| `getActiveMandate()` | Get the agent's current active mandate |
| `getBudgetStatus()` | Current budget (total, spent, remaining, percentUsed) |
| `getTransactions(filters?)` | Transaction history with optional filters |
| `acpCheckout(req)` | Stripe ACP merchant checkout |
| `stripeCharge(req)` | Stripe credit card payment with mandate governance |

### Configuration

```typescript
interface QuetraClientConfig {
  apiKey: string;       // Organization API key
  agentId: string;      // Agent UUID
  gatewayUrl?: string;  // Default: https://gateway.quetra.dev
  timeout?: number;     // Request timeout in ms
  retries?: number;     // Max retries on 5xx (default: 2)
}
```

## Error Handling

```typescript
import {
  MandateRejectionError,
  BudgetExhaustedError,
  MandateExpiredError,
  QuetraApiError,
} from '@quetra/sdk';

try {
  await quetra.canSpend(10000, 'expensive-vendor.com');
} catch (err) {
  if (err instanceof BudgetExhaustedError) {
    console.log('Budget depleted — cannot spend');
  } else if (err instanceof MandateRejectionError) {
    console.log('Rejected:', err.reasons);
  }
}
```

| Error | When |
|-------|------|
| `MandateRejectionError` | Mandate rules rejected the transaction |
| `BudgetExhaustedError` | Budget is fully spent |
| `MandateExpiredError` | Mandate has expired |
| `QuetraApiError` | Gateway returned an error response |

## Crypto Subpath

For offline mandate token verification:

```typescript
import { verifyMandateToken } from '@quetra/sdk/crypto';
```

## Getting Started

1. Sign up at [app.quetra.dev](https://app.quetra.dev)
2. Create an organization and register an agent
3. Create a mandate with spending rules and budget
4. Generate an API key
5. Install `@quetra/sdk` and start building

## Related Packages

- [`@quetra/core`](https://www.npmjs.com/package/@quetra/core) — Types and rule engine
- [`@quetra/mcp`](https://www.npmjs.com/package/@quetra/mcp) — MCP server for Claude and other MCP-compatible agents

## License

MIT
