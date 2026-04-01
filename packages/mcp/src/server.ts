import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// We need to define a config type since we can't import from sdk without circular issues
export interface QuetraMCPConfig {
  apiKey: string;
  agentId: string;
  gatewayUrl?: string;
}

/** Convert dollars to cents for the gateway API. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Convert cents to a formatted dollar string. */
function fmtDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Response formatting (shared patterns with apps/mcp-remote/src/handlers.ts)
// ---------------------------------------------------------------------------

/**
 * Format a single reason from the gateway's reasons array.
 *
 * The gateway returns objects like `{ ruleType: "budget_per_tx", passed: false, detail: "..." }`.
 * The SDK's MandateRejectionError types these as `string[]` but they're actually objects at runtime.
 */
function formatReason(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object') {
    const r = reason as { ruleType?: string; rule?: string; detail?: string };
    const type = r.ruleType ?? r.rule;
    const detail = r.detail ?? JSON.stringify(reason);
    return type ? `${type}: ${detail}` : detail;
  }
  return String(reason);
}

/**
 * Format a rule evaluation into a readable line with pass/fail indicator.
 */
function formatEvaluation(ev: Record<string, unknown>): string {
  const passed = ev.passed === true;
  const icon = passed ? 'PASS' : 'FAIL';
  const type = (ev.ruleType as string) ?? (ev.rule as string) ?? 'unknown';
  const detail = (ev.detail as string) ?? '';
  return `  [${icon}] ${type}: ${detail}`;
}

/**
 * Extract human-readable reasons from an SDK error.
 */
function extractReasons(error: unknown): string[] {
  if (error && typeof error === 'object' && 'reasons' in error) {
    const reasons = (error as { reasons: unknown[] }).reasons;
    if (Array.isArray(reasons)) {
      return reasons.map(formatReason);
    }
  }
  return [];
}

/**
 * Format errors from the SDK into actionable, human-readable messages.
 */
function formatError(error: unknown): string {
  // Zod validation errors (bad input from the LLM)
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    return `Invalid tool input:\n${issues}`;
  }

  // SDK typed errors — check by name since we lazy-import @quetra/sdk
  if (error && typeof error === 'object' && 'name' in error) {
    const err = error as {
      name: string;
      message: string;
      statusCode?: number;
      body?: unknown;
      reasons?: unknown[];
      budgetRemaining?: number;
      requestedAmount?: number;
      expiredAt?: Date;
    };

    if (err.name === 'MandateRejectionError' && Array.isArray(err.reasons)) {
      const reasons = err.reasons.map(formatReason);
      return `Spending rejected:\n${reasons.map((r) => `  - ${r}`).join('\n')}`;
    }

    if (err.name === 'BudgetExhaustedError') {
      const remaining = err.budgetRemaining != null ? fmtDollars(err.budgetRemaining) : 'unknown';
      const requested = err.requestedAmount != null ? fmtDollars(err.requestedAmount) : 'unknown';
      return `Budget exhausted: ${remaining} remaining, ${requested} requested. Increase the mandate budget or wait for the next reset period.`;
    }

    if (err.name === 'MandateExpiredError') {
      return `Mandate expired${err.expiredAt ? ` at ${err.expiredAt}` : ''}. Create and activate a new mandate in the dashboard.`;
    }

    if (err.name === 'QuetraApiError' && err.statusCode) {
      const bodyError =
        err.body && typeof err.body === 'object' && 'error' in err.body
          ? String((err.body as { error: string }).error)
          : undefined;

      switch (err.statusCode) {
        case 400:
          return `Bad request: ${bodyError ?? err.message}. Check that the agent has an active mandate.`;
        case 401:
          return 'Authentication failed. Your API key may be invalid or revoked. Generate a new key in the QuetraAI dashboard.';
        case 404:
          return `Not found: ${bodyError ?? err.message}. Check that your agent ID is correct and has an active mandate.`;
        case 429:
          return `Rate limit exceeded. Upgrade your plan or wait for the next billing period.`;
        default:
          return `Gateway error (${err.statusCode}): ${bodyError ?? err.message}`;
      }
    }
  }

  // Network/timeout/unknown errors
  if (error instanceof Error) {
    if (error.message.includes('timeout') || error.message.includes('AbortError')) {
      return 'Request timed out. The gateway may be temporarily unavailable.';
    }
    if (
      error.message.includes('fetch') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('network')
    ) {
      return `Network error: ${error.message}. Check that QUETRA_GATEWAY_URL is correct and reachable.`;
    }
    return error.message;
  }

  return String(error);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export function createQuetraMCPServer(config: QuetraMCPConfig): McpServer {
  const server = new McpServer({ name: 'quetra', version: '0.1.0' });

  // Lazy-load QuetraClient to avoid circular import issues at startup.
  // biome-ignore lint/suspicious/noExplicitAny: QuetraClient is dynamically imported
  let clientPromise: Promise<any> | null = null;
  async function getClient() {
    if (!clientPromise) {
      clientPromise = import('@quetra/sdk').then(
        ({ QuetraClient }) =>
          new QuetraClient({
            apiKey: config.apiKey,
            agentId: config.agentId,
            gatewayUrl: config.gatewayUrl,
          }),
      );
    }
    return clientPromise;
  }

  // ── quetra_evaluate ──────────────────────────────────────────────────────

  server.registerTool(
    'quetra_evaluate',
    {
      description:
        'Evaluate whether a payment/spend is allowed under your current mandate. Call this BEFORE making any purchase or API call that costs money.',
      inputSchema: {
        vendor: z.string().describe('Vendor/merchant name or domain'),
        amount: z.number().describe('Amount in dollars (e.g., 5.00 for $5)'),
        currency: z.string().default('USDC').describe('Currency code'),
        category: z.string().optional().describe('Spending category'),
        description: z.string().optional().describe('Transaction description'),
        mandateId: z.string().optional().describe('Specific mandate ID (auto-resolved if omitted)'),
      },
    },
    async (args) => {
      const client = await getClient();
      try {
        const result = await client.evaluate({
          ...args,
          amount: toCents(args.amount),
        });
        const lines: string[] = [];
        lines.push(`APPROVED: $${args.amount.toFixed(2)} to ${args.vendor}`);
        if (result.transactionId) lines.push(`Transaction: ${result.transactionId}`);
        if (result.budgetRemaining != null)
          lines.push(`Budget remaining: ${fmtDollars(result.budgetRemaining)}`);
        const evals = result.evaluations as Array<Record<string, unknown>> | undefined;
        if (evals?.length) {
          lines.push('');
          lines.push('Rule evaluations:');
          for (const ev of evals) {
            lines.push(formatEvaluation(ev));
          }
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error) {
        const reasons = extractReasons(error);
        const lines: string[] = [];
        lines.push(`REJECTED: $${args.amount.toFixed(2)} to ${args.vendor}`);
        if (reasons.length > 0) {
          lines.push('');
          lines.push('Reasons:');
          for (const r of reasons) {
            lines.push(`  - ${r}`);
          }
        } else {
          lines.push(formatError(error));
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }], isError: true };
      }
    },
  );

  // ── quetra_check_budget ──────────────────────────────────────────────────

  server.registerTool(
    'quetra_check_budget',
    {
      description:
        'Check your current budget status — total budget, amount spent, remaining, per-transaction limit, and reset schedule.',
    },
    async () => {
      const client = await getClient();
      try {
        const mandate = await client.getActiveMandate();
        const lines: string[] = [];
        lines.push(`Budget for mandate "${mandate.name}":`);
        lines.push(`  Total:           ${fmtDollars(mandate.budget.total)}`);
        lines.push(`  Spent:           ${fmtDollars(mandate.budget.spent)}`);
        lines.push(`  Remaining:       ${fmtDollars(mandate.budget.remaining)}`);
        lines.push(`  Per-transaction: ${fmtDollars(mandate.budget.perTransaction)}`);
        const pct =
          mandate.budget.total > 0
            ? Math.round((mandate.budget.spent / mandate.budget.total) * 100)
            : 0;
        lines.push(`  Used:            ${pct}%`);
        lines.push(`  Currency:        ${mandate.budget.currency}`);
        if (mandate.budget.resetsAt) {
          lines.push(`  Resets at:       ${mandate.budget.resetsAt}`);
        }
        lines.push(`  Valid until:     ${mandate.validUntil}`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    },
  );

  // ── quetra_can_spend ─────────────────────────────────────────────────────

  server.registerTool(
    'quetra_can_spend',
    {
      description:
        'Quick check: am I allowed to spend this amount with this vendor? Returns approval or rejection with specific reasons.',
      inputSchema: {
        amount: z.number().describe('Amount in dollars (e.g., 5.00 for $5)'),
        vendor: z.string().describe('Vendor name'),
        category: z.string().optional().describe('Spending category'),
      },
    },
    async (args) => {
      const client = await getClient();
      // Call evaluate directly instead of canSpend() to preserve rejection details
      try {
        await client.evaluate({
          vendor: args.vendor,
          amount: toCents(args.amount),
          category: args.category,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `APPROVED: $${args.amount.toFixed(2)} to ${args.vendor} is allowed.`,
            },
          ],
        };
      } catch (error) {
        const reasons = extractReasons(error);
        if (reasons.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `REJECTED: $${args.amount.toFixed(2)} to ${args.vendor} is not allowed.\n\nReasons:\n${reasons.map((r) => `  - ${r}`).join('\n')}`,
              },
            ],
          };
        }
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    },
  );

  // ── quetra_fetch ─────────────────────────────────────────────────────────

  server.registerTool(
    'quetra_fetch',
    {
      description:
        'Fetch a URL with automatic x402 payment handling. If the server returns 402 Payment Required, QuetraAI will evaluate and pay automatically under your mandate.',
      inputSchema: {
        url: z.string().url().describe('URL to fetch (handles x402 payment automatically)'),
        method: z.string().default('GET').describe('HTTP method'),
        body: z.string().optional().describe('Request body (for POST/PUT)'),
      },
    },
    async (args) => {
      const client = await getClient();
      try {
        const init: RequestInit = { method: args.method };
        if (args.body) init.body = args.body;
        const response = await client.fetch(args.url, init);
        const text = await response.text();
        return {
          content: [{ type: 'text' as const, text: `Status: ${response.status}\n\n${text}` }],
        };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    },
  );

  // ── quetra_transactions ──────────────────────────────────────────────────

  server.registerTool(
    'quetra_transactions',
    {
      description:
        'List your recent transactions — what you have spent, when, and whether each was approved or rejected.',
      inputSchema: {
        limit: z.number().default(10).describe('Max transactions to return'),
        decision: z.enum(['approved', 'rejected']).optional().describe('Filter by decision'),
      },
    },
    async (args) => {
      const client = await getClient();
      try {
        const result = await client.getTransactions(args);
        const raw = result as Record<string, unknown>;
        const txList = Array.isArray(raw.transactions)
          ? raw.transactions
          : Array.isArray(result)
            ? result
            : [];

        if (txList.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No transactions found.' }] };
        }

        const lines = txList.map((tx: Record<string, unknown>) => {
          const amt = typeof tx.amount === 'number' ? fmtDollars(tx.amount) : String(tx.amount);
          const decision = (tx.decision as string) ?? 'unknown';
          const vendor = (tx.vendor as string) ?? 'unknown';
          const date = tx.createdAt
            ? new Date(tx.createdAt as string).toISOString().slice(0, 16)
            : '';
          return `  ${decision === 'approved' ? 'APPROVED' : 'REJECTED'} ${amt} to ${vendor}${date ? ` (${date})` : ''}`;
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `${txList.length} transaction(s):\n\n${lines.join('\n')}`,
            },
          ],
        };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: formatError(error) }], isError: true };
      }
    },
  );

  // ── quetra_acp_checkout ──────────────────────────────────────────────────

  server.registerTool(
    'quetra_acp_checkout',
    {
      description:
        'Initiate an ACP (Agent Commerce Protocol) checkout with a merchant. Creates a payment session governed by your mandate.',
      inputSchema: {
        merchantName: z.string().describe('Merchant display name'),
        merchantUrl: z.string().describe('Merchant URL'),
        merchantId: z.string().describe('Merchant identifier'),
        items: z
          .array(
            z.object({
              name: z.string(),
              quantity: z.number(),
              unitPrice: z.number().describe('Price in dollars (e.g., 9.99)'),
            }),
          )
          .describe('Cart items'),
        totalAmount: z.number().describe('Total in dollars (e.g., 29.97)'),
      },
    },
    async (args) => {
      const client = await getClient();
      try {
        const result = await client.acpCheckout({
          merchant: {
            name: args.merchantName,
            url: args.merchantUrl,
            merchantId: args.merchantId,
          },
          cart: {
            items: args.items.map((item) => ({
              ...item,
              unitPrice: toCents(item.unitPrice),
            })),
            totalAmount: toCents(args.totalAmount),
          },
        });

        if (result.approved) {
          const lines: string[] = [];
          lines.push(
            `APPROVED: ACP checkout for $${args.totalAmount.toFixed(2)} with ${args.merchantName}`,
          );
          if (result.transactionId) lines.push(`Transaction: ${result.transactionId}`);
          if (result.sptToken) lines.push(`SPT token: ${result.sptToken}`);
          if (result.budgetRemaining != null)
            lines.push(`Budget remaining: ${fmtDollars(result.budgetRemaining)}`);
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }

        const reasons: string[] = (result.reasons ?? []).map(formatReason);
        return {
          content: [
            {
              type: 'text' as const,
              text: `REJECTED: ACP checkout for $${args.totalAmount.toFixed(2)} denied.\n\nReasons:\n${reasons.map((r: string) => `  - ${r}`).join('\n')}`,
            },
          ],
          isError: true,
        };
      } catch (error) {
        const reasons = extractReasons(error);
        const lines: string[] = [];
        lines.push(
          `REJECTED: ACP checkout for $${args.totalAmount.toFixed(2)} with ${args.merchantName}`,
        );
        if (reasons.length > 0) {
          lines.push('');
          lines.push('Reasons:');
          for (const r of reasons) lines.push(`  - ${r}`);
        } else {
          lines.push(formatError(error));
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }], isError: true };
      }
    },
  );

  return server;
}

export async function startStdioServer(config: QuetraMCPConfig): Promise<void> {
  const server = createQuetraMCPServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
