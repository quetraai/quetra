# QuetraAI

[![npm @quetra/core](https://img.shields.io/npm/v/@quetra/core.svg?label=@quetra/core)](https://www.npmjs.com/package/@quetra/core)
[![npm @quetra/sdk](https://img.shields.io/npm/v/@quetra/sdk.svg?label=@quetra/sdk)](https://www.npmjs.com/package/@quetra/sdk)
[![npm @quetra/mcp](https://img.shields.io/npm/v/@quetra/mcp.svg?label=@quetra/mcp)](https://www.npmjs.com/package/@quetra/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Programmable spending governance for AI agents.** Control what your agents spend, on what, and when — enforced via cryptographically signed mandates with real-time policy evaluation.

- Sub-50ms policy evaluation
- 7 rule types (budget, vendor allowlist/blocklist, category, rate limit, time window, custom JSONLogic)
- Append-only audit trail
- Works with Claude, GPT, LangChain, CrewAI, and any custom agent

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@quetra/core`](./packages/core/) | Types, rule engine, and Ed25519 signing | [![npm](https://img.shields.io/npm/v/@quetra/core.svg)](https://www.npmjs.com/package/@quetra/core) |
| [`@quetra/sdk`](./packages/sdk/) | Client SDK for AI agents | [![npm](https://img.shields.io/npm/v/@quetra/sdk.svg)](https://www.npmjs.com/package/@quetra/sdk) |
| [`@quetra/mcp`](./packages/mcp/) | MCP server for Claude Desktop, Claude Code, and any MCP-compatible agent | [![npm](https://img.shields.io/npm/v/@quetra/mcp.svg)](https://www.npmjs.com/package/@quetra/mcp) |

## Quick Start

### MCP Server (Zero Code)

The fastest way to add spending governance to any MCP-compatible agent. One URL, no packages to install.

1. Create an account at [app.quetra.dev](https://app.quetra.dev/auth/signup)
2. Register an agent, create a mandate with your rules, and generate an API key
3. Connect:

**Claude Code:** Settings → MCP Servers → Add Remote Server

```
https://mcp.quetra.dev/<your-api-key>/mcp
```

**Claude Desktop:** Settings → Connectors → Add → paste the URL above

### SDK

```bash
npm install @quetra/sdk
```

```typescript
import { QuetraClient } from '@quetra/sdk';

const quetra = new QuetraClient({
  apiKey: process.env.QUETRA_API_KEY,
  agentId: process.env.QUETRA_AGENT_ID,
});

// Pre-flight check before spending
const canSpend = await quetra.canSpend({
  amount: 500,       // $5.00 in cents
  vendor: 'api.openai.com',
  category: 'research',
});

// x402-aware fetch with automatic payment handling
const data = await quetra.fetch('https://paid-api.example.com/data', {
  amount: 300,
  category: 'research',
});
```

## Documentation

- [Quickstart Guide](https://quetra.dev/docs/quickstart) — get running in 5 minutes
- [SDK Reference](https://quetra.dev/docs/sdk) — full API documentation
- [MCP Server Guide](https://quetra.dev/docs/mcp) — Claude Desktop, Claude Code, OpenClaw
- [REST API Reference](https://quetra.dev/docs/api) — 59 endpoints
- [Webhook Integration](https://quetra.dev/docs/guides/webhooks) — real-time event notifications

## How It Works

1. **Register agents** and define **mandates** (spending rules) in the [dashboard](https://app.quetra.dev)
2. **Connect** via MCP server, SDK, or REST API
3. Every spending request is **evaluated** against the mandate rules in under 50ms
4. Approved transactions proceed; rejected transactions return the specific rule that failed
5. Everything is logged to an **append-only audit trail**

## Pricing

| Plan | Evaluations | Price |
|------|-------------|-------|
| Free | 500/month | $0 |
| Pro | 10,000/month | $49/mo |
| Enterprise | 100,000/month | $299/mo |

## License

MIT