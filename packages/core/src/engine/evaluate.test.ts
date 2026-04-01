import { describe, expect, it } from 'vitest';
import type { EvaluationContext, Mandate, MandateBudget, MandateRule } from '../types.js';
import { evaluateMandate } from './evaluate.js';

function createMandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    id: 'mdt_test',
    orgId: 'org_test',
    agentId: 'agent_test',
    name: 'Test Mandate',
    status: 'active',
    budget: {
      total: 50000, // $500
      perTransaction: 1000, // $10
      spent: 0,
      currency: 'USDC',
    },
    rules: [],
    policyHash: 'test_hash',
    signature: 'test_sig',
    signerPublicKey: 'test_pub',
    validFrom: new Date('2026-01-01'),
    validUntil: new Date('2026-12-31'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    amount: 500, // $5
    vendor: 'api.openai.com',
    category: 'research',
    timestamp: new Date('2026-03-15T14:30:00Z'), // Saturday — adjust per test
    recentTransactionCount: 0,
    ...overrides,
  };
}

describe('evaluateMandate', () => {
  describe('budget checks', () => {
    it('should approve when amount is within per-transaction limit', () => {
      const mandate = createMandate();
      const context = createContext({ amount: 500 });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
      expect(result.evaluations.find((e) => e.ruleType === 'budget_per_tx')?.passed).toBe(true);
    });

    it('should reject when amount exceeds per-transaction limit', () => {
      const mandate = createMandate();
      const context = createContext({ amount: 1500 }); // $15 > $10 limit
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
      expect(result.evaluations.find((e) => e.ruleType === 'budget_per_tx')?.passed).toBe(false);
    });

    it('should reject when total budget is exhausted', () => {
      const mandate = createMandate({
        budget: { total: 50000, perTransaction: 1000, spent: 49800, currency: 'USDC' },
      });
      const context = createContext({ amount: 500 }); // $5 > $2 remaining
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
      expect(result.evaluations.find((e) => e.ruleType === 'budget_total')?.passed).toBe(false);
    });

    it('should approve when amount exactly equals remaining budget', () => {
      const mandate = createMandate({
        budget: { total: 50000, perTransaction: 1000, spent: 49500, currency: 'USDC' },
      });
      const context = createContext({ amount: 500 }); // Exactly $5 remaining
      const result = evaluateMandate(mandate, context);

      expect(result.evaluations.find((e) => e.ruleType === 'budget_total')?.passed).toBe(true);
    });
  });

  describe('category rule', () => {
    it('should approve when category is in allowed list', () => {
      const rules: MandateRule[] = [{ type: 'category', allowed: ['research', 'advertising'] }];
      const mandate = createMandate({ rules });
      const context = createContext({ category: 'research' });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
    });

    it('should reject when category is not in allowed list', () => {
      const rules: MandateRule[] = [{ type: 'category', allowed: ['research'] }];
      const mandate = createMandate({ rules });
      const context = createContext({ category: 'entertainment' });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
    });

    it('should reject when no category is provided', () => {
      const rules: MandateRule[] = [{ type: 'category', allowed: ['research'] }];
      const mandate = createMandate({ rules });
      const context = createContext({ category: undefined });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
    });
  });

  describe('vendor allowlist rule', () => {
    it('should approve when vendor is in allowlist', () => {
      const rules: MandateRule[] = [
        { type: 'vendor_allowlist', allowed: ['api.openai.com', 'ads.google.com'] },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({ vendor: 'api.openai.com' });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
    });

    it('should reject when vendor is not in allowlist', () => {
      const rules: MandateRule[] = [{ type: 'vendor_allowlist', allowed: ['api.openai.com'] }];
      const mandate = createMandate({ rules });
      const context = createContext({ vendor: 'nft-market.io' });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
    });

    it('should match subdomains', () => {
      const rules: MandateRule[] = [{ type: 'vendor_allowlist', allowed: ['google.com'] }];
      const mandate = createMandate({ rules });
      const context = createContext({ vendor: 'ads.google.com' });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
    });
  });

  describe('vendor blocklist rule', () => {
    it('should approve when vendor is not in blocklist', () => {
      const rules: MandateRule[] = [
        { type: 'vendor_blocklist', blocked: ['casino.com', 'nft-market.io'] },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({ vendor: 'api.openai.com' });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
    });

    it('should reject when vendor is in blocklist', () => {
      const rules: MandateRule[] = [{ type: 'vendor_blocklist', blocked: ['casino.com'] }];
      const mandate = createMandate({ rules });
      const context = createContext({ vendor: 'casino.com' });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
    });
  });

  describe('rate limit rule', () => {
    it('should approve when under rate limit', () => {
      const rules: MandateRule[] = [{ type: 'rate_limit', maxTransactions: 10, windowMinutes: 60 }];
      const mandate = createMandate({ rules });
      const context = createContext({ recentTransactionCount: 5 });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
    });

    it('should reject when rate limit exceeded', () => {
      const rules: MandateRule[] = [{ type: 'rate_limit', maxTransactions: 10, windowMinutes: 60 }];
      const mandate = createMandate({ rules });
      const context = createContext({ recentTransactionCount: 10 });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
    });
  });

  describe('approval rule', () => {
    it('should flag for approval when amount exceeds threshold', () => {
      const rules: MandateRule[] = [
        { type: 'approval', threshold: 500, approverIds: ['user_1'], timeoutMinutes: 30 },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({ amount: 1000 }); // $10 > $5 threshold
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true); // Approval rules don't block
      expect(result.requiresApproval).toBeDefined();
      expect(result.requiresApproval?.threshold).toBe(500);
    });

    it('should not flag for approval when amount is under threshold', () => {
      const rules: MandateRule[] = [
        { type: 'approval', threshold: 5000, approverIds: ['user_1'], timeoutMinutes: 30 },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({ amount: 500 }); // $5 <= $50 threshold
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBeUndefined();
    });
  });

  describe('custom rule (JSONLogic)', () => {
    it('should evaluate JSONLogic expressions', () => {
      const rules: MandateRule[] = [
        {
          type: 'custom',
          engine: 'jsonlogic',
          expression: { '<=': [{ var: 'amount' }, 1000] },
          description: 'Amount must be <= $10',
        },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({ amount: 500 });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
    });

    it('should reject when JSONLogic expression fails', () => {
      const rules: MandateRule[] = [
        {
          type: 'custom',
          engine: 'jsonlogic',
          expression: { '<=': [{ var: 'amount' }, 100] },
          description: 'Amount must be <= $1',
        },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({ amount: 500 });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
    });
  });

  describe('combined rules', () => {
    it('should require ALL rules to pass', () => {
      const rules: MandateRule[] = [
        { type: 'category', allowed: ['research'] },
        { type: 'vendor_allowlist', allowed: ['api.openai.com'] },
        { type: 'rate_limit', maxTransactions: 10, windowMinutes: 60 },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({
        amount: 500,
        vendor: 'api.openai.com',
        category: 'research',
        recentTransactionCount: 3,
      });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(true);
      expect(result.evaluations.length).toBe(5); // 2 budget + 3 rules
      expect(result.evaluations.every((e) => e.passed)).toBe(true);
    });

    it('should reject if ANY rule fails', () => {
      const rules: MandateRule[] = [
        { type: 'category', allowed: ['research'] },
        { type: 'vendor_allowlist', allowed: ['api.openai.com'] },
      ];
      const mandate = createMandate({ rules });
      const context = createContext({
        vendor: 'nft-market.io', // Not in allowlist
        category: 'research', // In category list
      });
      const result = evaluateMandate(mandate, context);

      expect(result.allowed).toBe(false);
      expect(result.evaluations.find((e) => e.ruleType === 'category')?.passed).toBe(true);
      expect(result.evaluations.find((e) => e.ruleType === 'vendor_allowlist')?.passed).toBe(false);
    });
  });
});
