import type { RuleEvaluation } from '@quetra/core';
import { MandateRejectionError, QuetraApiError } from './errors.js';
import { buildPaymentSignature, parsePaymentRequired, type X402PayResponse } from './x402.js';

export interface QuetraClientConfig {
  apiKey: string;
  agentId: string;
  gatewayUrl?: string;
  timeout?: number;
  retries?: number;
}

export interface MandateInfo {
  id: string;
  name: string;
  status: string;
  budget: {
    /** Total budget in cents. $100.00 = 10000. */
    total: number;
    /** Amount spent so far in cents. */
    spent: number;
    /** Remaining budget in cents. */
    remaining: number;
    /** Max per-transaction spend in cents. */
    perTransaction: number;
    currency: string;
    resetsAt?: string;
  };
  rules: unknown[];
  validUntil: string;
}

export interface EvaluateRequest {
  vendor: string;
  /** Amount in cents. $5.00 = 500. */
  amount: number;
  currency?: string;
  category?: string;
  description?: string;
  mandateId?: string;
}

export interface EvaluateResponse {
  decision: string;
  transactionId?: string;
  evaluations?: RuleEvaluation[];
  /** Remaining budget in cents after this evaluation. */
  budgetRemaining?: number;
  reasons?: Array<{ rule: string; passed: boolean; detail: string }>;
  evaluationDurationMs?: number;
}

export interface BudgetStatus {
  /** Total budget in cents. */
  total: number;
  /** Amount spent in cents. */
  spent: number;
  /** Remaining budget in cents. */
  remaining: number;
  percentUsed: number;
  currency: string;
}

export interface TransactionFilters {
  limit?: number;
  offset?: number;
  decision?: 'approved' | 'rejected';
  agentId?: string;
  mandateId?: string;
}

export interface ACPCheckoutRequest {
  merchant: { name: string; url: string; merchantId?: string };
  cart: {
    items: Array<{
      name: string;
      quantity: number;
      /** Unit price in cents. $9.99 = 999. */
      unitPrice: number;
      category?: string;
    }>;
    /** Total cart amount in cents. */
    totalAmount: number;
    currency?: string;
  };
  checkoutSessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface ACPCheckoutResult {
  approved: boolean;
  transactionId?: string;
  sptToken?: string;
  sptId?: string;
  expiresAt?: string;
  /** Remaining budget in cents after checkout. */
  budgetRemaining?: number;
  evaluations?: Array<{ ruleType: string; passed: boolean; detail: string }>;
  reasons?: Array<{ rule: string; passed: boolean; detail: string }>;
}

export interface StripeCCChargeRequest {
  vendor: string;
  /** Amount in cents. $5.00 = 500. */
  amount: number;
  currency?: string;
  category?: string;
  description?: string;
  stripeCustomerId?: string;
  metadata?: Record<string, string>;
}

export interface StripeCCChargeResult {
  approved: boolean;
  transactionId?: string;
  paymentIntentId?: string;
  clientSecret?: string;
  /** Remaining budget in cents after charge. */
  budgetRemaining?: number;
  evaluations?: Array<{ ruleType: string; passed: boolean; detail: string }>;
  reasons?: Array<{ rule: string; passed: boolean; detail: string }>;
}

const DEFAULT_GATEWAY_URL = 'https://gateway.quetra.dev';
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRIES = 2;

export class QuetraClient {
  private readonly apiKey: string;
  private readonly agentId: string;
  private readonly gatewayUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: QuetraClientConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error('QuetraClient: apiKey must be a non-empty string');
    }
    if (!config.agentId?.trim()) {
      throw new Error('QuetraClient: agentId must be a non-empty string');
    }

    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
    this.gatewayUrl = (config.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.retries ?? DEFAULT_RETRIES;
  }

  /**
   * Create a client from environment variables.
   */
  static fromEnv(): QuetraClient {
    const apiKey = process.env.QUETRA_API_KEY;
    const agentId = process.env.QUETRA_AGENT_ID;
    const gatewayUrl = process.env.QUETRA_GATEWAY_URL;

    if (!apiKey) throw new Error('QUETRA_API_KEY environment variable is required');
    if (!agentId) throw new Error('QUETRA_AGENT_ID environment variable is required');

    return new QuetraClient({ apiKey, agentId, gatewayUrl });
  }

  /**
   * Get the active mandate for this agent.
   */
  async getActiveMandate(): Promise<MandateInfo> {
    const raw = await this.request<Record<string, unknown>>(
      `/api/v1/gateway/mandate-token?agentId=${encodeURIComponent(this.agentId)}`,
      { method: 'GET' },
    );
    // Gateway returns `mandateId`; normalize to `id` for MandateInfo
    return {
      ...raw,
      id: (raw.mandateId ?? raw.id) as string,
    } as unknown as MandateInfo;
  }

  /**
   * Evaluate a payment request against the active mandate (dry-run).
   *
   * If `mandateId` is not provided, auto-resolves by fetching the active mandate.
   */
  async evaluate(request: EvaluateRequest): Promise<EvaluateResponse> {
    let { mandateId } = request;
    if (!mandateId) {
      const mandate = await this.getActiveMandate();
      mandateId = mandate.id;
    }

    return this.request<EvaluateResponse>('/api/v1/gateway/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        mandateId,
        paymentRequest: {
          vendor: request.vendor,
          amount: request.amount,
          currency: request.currency ?? 'USDC',
          category: request.category,
          description: request.description,
        },
      }),
    });
  }

  /**
   * x402-aware fetch. Automatically handles 402 responses within mandate constraints.
   *
   * 1. Sends the request normally
   * 2. If 402 → parses PAYMENT-REQUIRED header
   * 3. Calls gateway to evaluate mandate + get payment authorization
   * 4. If approved → retries with PAYMENT-SIGNATURE header
   * 5. If rejected → throws MandateRejectionError
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    // 1. Send initial request
    const response = await globalThis.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (response.status !== 402) {
      return response;
    }

    // 2. Parse x402 payment requirements from response header
    const paymentRequiredHeader = response.headers.get('PAYMENT-REQUIRED');
    if (!paymentRequiredHeader) {
      throw new QuetraApiError('Received 402 but no PAYMENT-REQUIRED header', 402);
    }

    const paymentRequirements = parsePaymentRequired(paymentRequiredHeader);

    // 3. Call gateway x402/pay endpoint for mandate evaluation + authorization
    const gatewayResponse = await this.request<X402PayResponse>('/api/v1/gateway/x402/pay', {
      method: 'POST',
      body: JSON.stringify({
        paymentRequirements,
        resourceUrl: url,
      }),
    });

    // 4. If gateway rejected, throw with reasons
    if (!gatewayResponse.approved) {
      const reasons = (gatewayResponse.reasons ?? []).map((r) => `${r.rule}: ${r.detail}`);
      throw new MandateRejectionError(reasons);
    }

    // 5. Retry original request with PAYMENT-SIGNATURE header
    if (!gatewayResponse.paymentPayload) {
      throw new QuetraApiError(
        'Gateway approved payment but did not return paymentPayload',
        500,
        gatewayResponse,
      );
    }
    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set('PAYMENT-SIGNATURE', gatewayResponse.paymentPayload);

    const retryResponse = await globalThis.fetch(url, {
      ...init,
      headers: retryHeaders,
      signal: AbortSignal.timeout(this.timeout),
    });

    return retryResponse;
  }

  /**
   * Get transaction history for this agent.
   */
  async getTransactions(
    filters?: TransactionFilters,
  ): Promise<{ transactions: unknown[]; total: number }> {
    const params = new URLSearchParams();
    params.set('agentId', this.agentId);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    if (filters?.decision) params.set('decision', filters.decision);
    if (filters?.mandateId) params.set('mandateId', filters.mandateId);

    return this.request(`/api/v1/transactions?${params.toString()}`, {
      method: 'GET',
    });
  }

  /**
   * Get budget summary from the active mandate.
   */
  async getBudgetStatus(): Promise<BudgetStatus> {
    const mandate = await this.getActiveMandate();
    return {
      total: mandate.budget.total,
      spent: mandate.budget.spent,
      remaining: mandate.budget.remaining,
      percentUsed:
        mandate.budget.total > 0
          ? Math.round((mandate.budget.spent / mandate.budget.total) * 100)
          : 0,
      currency: mandate.budget.currency,
    };
  }

  /**
   * Check if a payment would be approved (convenience wrapper around evaluate).
   */
  async canSpend(amount: number, vendor: string, category?: string): Promise<boolean> {
    try {
      const result = await this.evaluate({ amount, vendor, category });
      return result.decision === 'approved';
    } catch (error) {
      if (error instanceof MandateRejectionError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * ACP checkout — evaluate a cart against the mandate and provision an SPT.
   *
   * Call this after creating a checkout session with the merchant.
   * If approved, returns an SPT to pass to the merchant's complete endpoint.
   */
  async acpCheckout(request: ACPCheckoutRequest): Promise<ACPCheckoutResult> {
    return this.request<ACPCheckoutResult>('/api/v1/gateway/acp/authorize', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Stripe CC charge — evaluate a payment against the mandate and create a PaymentIntent.
   *
   * If approved, returns a PaymentIntent client secret that can be used client-side
   * to complete the charge via Stripe.js. Budget is decremented at authorization time.
   */
  async stripeCharge(request: StripeCCChargeRequest): Promise<StripeCCChargeResult> {
    return this.request<StripeCCChargeResult>('/api/v1/gateway/stripe/charge', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Internal: Make an authenticated request to the gateway.
   */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.gatewayUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Quetra-Agent-Id', this.agentId);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await globalThis.fetch(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);

          if (
            response.status === 403 &&
            body &&
            Array.isArray((body as { reasons?: unknown }).reasons)
          ) {
            throw new MandateRejectionError((body as { reasons: string[] }).reasons);
          }

          throw new QuetraApiError(
            `Gateway responded with ${response.status}`,
            response.status,
            body,
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx errors (client errors)
        if (error instanceof QuetraApiError && error.statusCode < 500) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }
}
