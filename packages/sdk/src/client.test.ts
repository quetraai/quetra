import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuetraClient } from './client.js';
import { MandateRejectionError, QuetraApiError } from './errors.js';
import { buildPaymentSignature, parsePaymentRequired } from './x402.js';

// ─── Helpers ────────────────────────────────────────────

const GATEWAY = 'https://gateway.test';
const API_KEY = 'sk_test_abc123';
const AGENT_ID = 'agent_test_1';

function createClient(overrides?: Partial<ConstructorParameters<typeof QuetraClient>[0]>) {
  return new QuetraClient({
    apiKey: API_KEY,
    agentId: AGENT_ID,
    gatewayUrl: GATEWAY,
    timeout: 5000,
    retries: 0, // no retries by default in tests
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const mandateInfo = {
  id: 'mdt_1',
  name: 'Test Mandate',
  status: 'active',
  budget: {
    total: 50000,
    spent: 10000,
    remaining: 40000,
    perTransaction: 1000,
    currency: 'USDC',
  },
  rules: [],
  validUntil: '2026-12-31T23:59:59Z',
};

// ─── x402 Header Parsing ────────────────────────────────

describe('parsePaymentRequired', () => {
  it('decodes a valid base64 PAYMENT-REQUIRED header', () => {
    const requirements = {
      x402Version: 2,
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '500',
      resource: 'https://api.example.com/data',
      payTo: '0xRecipient',
    };
    const header = btoa(JSON.stringify(requirements));

    const parsed = parsePaymentRequired(header);
    expect(parsed.scheme).toBe('exact');
    expect(parsed.maxAmountRequired).toBe('500');
    expect(parsed.payTo).toBe('0xRecipient');
    expect(parsed.network).toBe('base-sepolia');
  });

  it('throws on invalid base64', () => {
    expect(() => parsePaymentRequired('not-valid-base64!!!')).toThrow();
  });

  it('throws on valid base64 but invalid JSON', () => {
    const header = btoa('not json');
    expect(() => parsePaymentRequired(header)).toThrow();
  });

  it('throws if required fields are missing', () => {
    const header = btoa(JSON.stringify({ scheme: 'exact' }));
    expect(() => parsePaymentRequired(header)).toThrow('missing payTo');
  });
});

describe('buildPaymentSignature', () => {
  it('encodes a payload as base64 JSON', () => {
    const payload = { type: 'test', amount: 500 };
    const result = buildPaymentSignature(payload);
    const decoded = JSON.parse(atob(result));
    expect(decoded).toEqual(payload);
  });
});

// ─── QuetraClient.fromEnv() ─────────────────────────────

describe('QuetraClient.fromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates client from environment variables', () => {
    process.env.QUETRA_API_KEY = 'sk_test_env';
    process.env.QUETRA_AGENT_ID = 'agent_env';
    process.env.QUETRA_GATEWAY_URL = 'https://gw.test';

    const client = QuetraClient.fromEnv();
    expect(client).toBeInstanceOf(QuetraClient);
  });

  it('throws if QUETRA_API_KEY is missing', () => {
    process.env.QUETRA_AGENT_ID = 'agent_env';
    delete process.env.QUETRA_API_KEY;

    expect(() => QuetraClient.fromEnv()).toThrow('QUETRA_API_KEY');
  });

  it('throws if QUETRA_AGENT_ID is missing', () => {
    process.env.QUETRA_API_KEY = 'sk_test_env';
    delete process.env.QUETRA_AGENT_ID;

    expect(() => QuetraClient.fromEnv()).toThrow('QUETRA_AGENT_ID');
  });
});

// ─── getActiveMandate() ─────────────────────────────────

describe('QuetraClient.getActiveMandate', () => {
  it('fetches the active mandate for the agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mandateInfo));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const result = await client.getActiveMandate();

    expect(result.id).toBe('mdt_1');
    expect(result.budget.remaining).toBe(40000);
    expect(fetchMock).toHaveBeenCalledOnce();

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/v1/gateway/mandate-token');
    expect(url).toContain(`agentId=${AGENT_ID}`);

    vi.unstubAllGlobals();
  });

  it('throws QuetraApiError on 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'No active mandate found' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await expect(client.getActiveMandate()).rejects.toThrow(QuetraApiError);

    vi.unstubAllGlobals();
  });
});

// ─── evaluate() ─────────────────────────────────────────

describe('QuetraClient.evaluate', () => {
  it('auto-resolves mandate and evaluates payment', async () => {
    const evaluateResponse = {
      decision: 'approved',
      transactionId: 'tx_1',
      evaluations: [],
      budgetRemaining: 39500,
    };

    const fetchMock = vi
      .fn()
      // First call: getActiveMandate
      .mockResolvedValueOnce(jsonResponse(mandateInfo))
      // Second call: evaluate
      .mockResolvedValueOnce(jsonResponse(evaluateResponse));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const result = await client.evaluate({
      vendor: 'api.example.com',
      amount: 500,
      category: 'research',
    });

    expect(result.decision).toBe('approved');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second call should include mandateId from the mandate
    const evalBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(evalBody.mandateId).toBe('mdt_1');
    expect(evalBody.paymentRequest.vendor).toBe('api.example.com');

    vi.unstubAllGlobals();
  });

  it('uses explicit mandateId when provided', async () => {
    const evaluateResponse = {
      decision: 'approved',
      transactionId: 'tx_1',
      evaluations: [],
    };

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(evaluateResponse));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await client.evaluate({
      vendor: 'api.example.com',
      amount: 500,
      mandateId: 'mdt_explicit',
    });

    // Should only make one call (no getActiveMandate)
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.mandateId).toBe('mdt_explicit');

    vi.unstubAllGlobals();
  });
});

// ─── canSpend() ─────────────────────────────────────────

describe('QuetraClient.canSpend', () => {
  it('returns true when payment is approved', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(mandateInfo))
      .mockResolvedValueOnce(jsonResponse({ decision: 'approved' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const result = await client.canSpend(500, 'api.example.com');
    expect(result).toBe(true);

    vi.unstubAllGlobals();
  });

  it('returns false when payment is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(mandateInfo))
      .mockResolvedValueOnce(jsonResponse({ decision: 'rejected', reasons: [] }, 403));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    // canSpend catches MandateRejectionError and returns false
    const result = await client.canSpend(500, 'api.example.com');
    expect(result).toBe(false);

    vi.unstubAllGlobals();
  });
});

// ─── getBudgetStatus() ──────────────────────────────────

describe('QuetraClient.getBudgetStatus', () => {
  it('returns budget summary from active mandate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mandateInfo));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const budget = await client.getBudgetStatus();

    expect(budget.total).toBe(50000);
    expect(budget.spent).toBe(10000);
    expect(budget.remaining).toBe(40000);
    expect(budget.percentUsed).toBe(20);
    expect(budget.currency).toBe('USDC');

    vi.unstubAllGlobals();
  });
});

// ─── fetch() — x402 flow ───────────────────────────────

describe('QuetraClient.fetch', () => {
  it('returns response directly when status is not 402', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"data": "hello"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const response = await client.fetch('https://api.example.com/data');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('throws if 402 has no PAYMENT-REQUIRED header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Payment Required', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await expect(client.fetch('https://api.example.com/data')).rejects.toThrow(
      'no PAYMENT-REQUIRED header',
    );

    vi.unstubAllGlobals();
  });

  it('handles full x402 payment flow when approved', async () => {
    const paymentRequirements = {
      x402Version: 2,
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '500',
      resource: 'https://api.example.com/data',
      payTo: '0xRecipient',
    };

    const gatewayApproval = {
      approved: true,
      paymentPayload: btoa(JSON.stringify({ type: 'quetra_authorization' })),
      transactionId: 'tx_x402_1',
      budgetRemaining: 39500,
    };

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        // Initial request → 402 with payment requirements
        return Promise.resolve(
          new Response('Payment Required', {
            status: 402,
            headers: {
              'PAYMENT-REQUIRED': btoa(JSON.stringify(paymentRequirements)),
            },
          }),
        );
      }
      if (callCount === 2) {
        // Gateway x402/pay call → approved
        return Promise.resolve(jsonResponse(gatewayApproval));
      }
      // Retry with PAYMENT-SIGNATURE → success
      return Promise.resolve(new Response('{"data": "paid content"}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const response = await client.fetch('https://api.example.com/data');

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: 'paid content' });

    // Verify 3 fetch calls: initial → gateway → retry
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify the retry includes PAYMENT-SIGNATURE header
    const retryCall = fetchMock.mock.calls[2]!;
    const retryHeaders = retryCall[1]?.headers as Headers;
    expect(retryHeaders.get('PAYMENT-SIGNATURE')).toBe(gatewayApproval.paymentPayload);

    vi.unstubAllGlobals();
  });

  it('throws MandateRejectionError when gateway rejects', async () => {
    const paymentRequirements = {
      x402Version: 2,
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '500',
      resource: 'https://api.example.com/data',
      payTo: '0xRecipient',
    };

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response('Payment Required', {
            status: 402,
            headers: {
              'PAYMENT-REQUIRED': btoa(JSON.stringify(paymentRequirements)),
            },
          }),
        );
      }
      // Gateway rejects with 403
      return Promise.resolve(
        jsonResponse(
          {
            approved: false,
            reasons: [
              { rule: 'vendor_allowlist', passed: false, detail: 'Vendor not in allowlist' },
            ],
          },
          403,
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await expect(client.fetch('https://api.example.com/data')).rejects.toThrow(
      MandateRejectionError,
    );

    vi.unstubAllGlobals();
  });
});

// ─── getTransactions() ──────────────────────────────────

describe('QuetraClient.getTransactions', () => {
  it('fetches transactions with filters', async () => {
    const txResponse = {
      transactions: [{ id: 'tx_1' }],
      total: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(txResponse));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const result = await client.getTransactions({ limit: 10, decision: 'approved' });

    expect(result.transactions).toHaveLength(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/v1/transactions');
    expect(url).toContain('limit=10');
    expect(url).toContain('decision=approved');
    expect(url).toContain(`agentId=${AGENT_ID}`);

    vi.unstubAllGlobals();
  });
});

// ─── Retry logic ────────────────────────────────────────

describe('QuetraClient retry logic', () => {
  it('retries on 5xx errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Internal' }, 500))
      .mockResolvedValueOnce(jsonResponse(mandateInfo));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ retries: 1 });
    const result = await client.getActiveMandate();

    expect(result.id).toBe('mdt_1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('does not retry on 4xx errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ retries: 2 });
    await expect(client.getActiveMandate()).rejects.toThrow(QuetraApiError);
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});

// ─── acpCheckout() ──────────────────────────────────────

describe('QuetraClient.acpCheckout', () => {
  it('returns SPT when approved', async () => {
    const approvedResponse = {
      approved: true,
      transactionId: 'tx_acp_1',
      sptToken: 'mock_token_abc',
      sptId: 'mock_spt_123',
      expiresAt: '2026-03-03T15:30:00.000Z',
      budgetRemaining: 46000,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(approvedResponse));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    const result = await client.acpCheckout({
      merchant: { name: 'Shop', url: 'https://shop.example.com' },
      cart: {
        items: [{ name: 'Widget', quantity: 1, unitPrice: 500 }],
        totalAmount: 500,
      },
    });

    expect(result.approved).toBe(true);
    expect(result.sptToken).toBe('mock_token_abc');
    expect(result.transactionId).toBe('tx_acp_1');
    expect(result.budgetRemaining).toBe(46000);

    // Verify request was sent to correct endpoint
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('/api/v1/gateway/acp/authorize');

    vi.unstubAllGlobals();
  });

  it('returns rejection reasons when denied', async () => {
    const rejectedResponse = {
      approved: false,
      reasons: [{ rule: 'category', passed: false, detail: 'entertainment not allowed' }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rejectedResponse, 403));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await expect(
      client.acpCheckout({
        merchant: { name: 'Games', url: 'https://games.example.com' },
        cart: {
          items: [{ name: 'Game', quantity: 1, unitPrice: 2000, category: 'entertainment' }],
          totalAmount: 2000,
        },
      }),
    ).rejects.toThrow(MandateRejectionError);

    vi.unstubAllGlobals();
  });

  it('handles network errors with retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(
        jsonResponse({
          approved: true,
          transactionId: 'tx_retry',
          sptToken: 'tok',
          sptId: 'spt',
          expiresAt: '2026-12-31T00:00:00.000Z',
          budgetRemaining: 40000,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ retries: 1 });
    const result = await client.acpCheckout({
      merchant: { name: 'Shop', url: 'https://shop.example.com' },
      cart: {
        items: [{ name: 'Item', quantity: 1, unitPrice: 500 }],
        totalAmount: 500,
      },
    });

    expect(result.approved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });
});

// ─── Authentication headers ─────────────────────────────

describe('QuetraClient authentication', () => {
  it('sends correct auth headers on every request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mandateInfo));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient();
    await client.getActiveMandate();

    const headers = fetchMock.mock.calls[0]![1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${API_KEY}`);
    expect(headers.get('X-Quetra-Agent-Id')).toBe(AGENT_ID);
    expect(headers.get('Content-Type')).toBe('application/json');

    vi.unstubAllGlobals();
  });
});
