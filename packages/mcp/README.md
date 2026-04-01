# @quetra/mcp

[![npm version](https://img.shields.io/npm/v/@quetra/mcp.svg)](https://www.npmjs.com/package/@quetra/mcp)
[![license](https://img.shields.io/npm/l/@quetra/mcp.svg)](https://opensource.org/licenses/MIT)

MCP server for [QuetraAI](https://quetra.dev) — expose AI agent spending governance as [Model Context Protocol](https://modelcontextprotocol.io) tools. Works with Claude Desktop, Claude Code, and any MCP-compatible client.

## Two Ways to Connect

| Method                   | Transport       | Use Case                                                                 |
| ------------------------ | --------------- | ------------------------------------------------------------------------ |
| **Local (this package)** | stdio           | Claude Desktop config, `npx`, programmatic embedding                     |
| **Remote**               | Streamable HTTP | One URL, multi-agent, no install: `https://mcp.quetra.dev/<api-key>/mcp` |

The remote server supports multiple agents per connection — see [Remote MCP Setup](#remote-mcp-server) below.

## Install

```bash
npm install @quetra/mcp
```

## Claude Desktop Setup (Local)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "quetra": {
      "command": "npx",
      "args": ["@quetra/mcp"],
      "env": {
        "QUETRA_API_KEY": "sk_...",
        "QUETRA_AGENT_ID": "your-agent-uuid",
        "QUETRA_GATEWAY_URL": "https://gateway.quetra.dev"
      }
    }
  }
}
```

## Remote MCP Server

No install required. Add the remote server URL directly in Claude Code or Claude Desktop:

```
https://mcp.quetra.dev/<your-api-key>/mcp
```

The remote server is multi-agent — use `quetra_list_agents` to discover available agents, then pass `agentId` to each tool call. One connection governs all your agents.

## Standalone Usage

Run directly from the command line (stdio transport):

```bash
QUETRA_API_KEY=sk_... QUETRA_AGENT_ID=agent-uuid npx @quetra/mcp
```

## Programmatic Usage

Embed the MCP server in your own application:

```typescript
import { createQuetraMCPServer } from "@quetra/mcp";

const server = createQuetraMCPServer({
  apiKey: "sk_...",
  agentId: "agent-uuid",
  gatewayUrl: "https://gateway.quetra.dev",
});
```

## Available Tools

| Tool                  | Description                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `quetra_evaluate`     | Pre-flight spend check — evaluate a payment against mandate rules and budget. Returns per-rule pass/fail details. |
| `quetra_check_budget` | Budget status: total, spent, remaining, per-transaction limit, reset schedule.                                    |
| `quetra_can_spend`    | Spend check with rejection reasons — shows exactly which rules failed.                                            |
| `quetra_fetch`        | x402-aware fetch — make HTTP requests that auto-handle payment-required responses.                                |
| `quetra_transactions` | List recent transaction history with optional filters.                                                            |
| `quetra_acp_checkout` | Initiate a Stripe ACP merchant checkout flow.                                                                     |

The remote server adds `quetra_list_agents` — discover available agents in your organization.

## Environment Variables

| Variable             | Required | Description                                                         |
| -------------------- | -------- | ------------------------------------------------------------------- |
| `QUETRA_API_KEY`     | Yes      | Your organization's API key (`sk_...`)                              |
| `QUETRA_AGENT_ID`    | Yes      | The agent's UUID (local only — remote uses `agentId` per tool call) |
| `QUETRA_GATEWAY_URL` | No       | Gateway URL (defaults to `https://gateway.quetra.dev`)              |

## Getting Started

1. Sign up at [app.quetra.dev](https://app.quetra.dev)
2. Create an organization and register an agent
3. Create a mandate with spending rules and budget
4. Generate an API key
5. Add the MCP server config to Claude Desktop (local) or paste the remote URL

## Related Packages

- [`@quetra/sdk`](https://www.npmjs.com/package/@quetra/sdk) — Client SDK for programmatic agent integration
- [`@quetra/core`](https://www.npmjs.com/package/@quetra/core) — Types and rule engine

## License

MIT
