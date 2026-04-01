import { describe, expect, it } from 'vitest';
import type { Mandate, MandateRule } from '../types.js';
import {
  computePolicyHash,
  createMandateToken,
  generateKeyPair,
  signMandate,
  verifyMandateSignature,
  verifyMandateToken,
} from './signing.js';

describe('generateKeyPair', () => {
  it('should generate a valid key pair', async () => {
    const { privateKey, publicKey } = await generateKeyPair();

    expect(privateKey).toBeTypeOf('string');
    expect(publicKey).toBeTypeOf('string');
    expect(privateKey.length).toBe(64); // 32 bytes hex
    expect(publicKey.length).toBe(64); // 32 bytes hex
  });

  it('should generate unique key pairs', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    expect(kp1.privateKey).not.toBe(kp2.privateKey);
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });
});

describe('signMandate / verifyMandateSignature', () => {
  it('should sign and verify a mandate', async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const rules: MandateRule[] = [
      { type: 'category', allowed: ['research'] },
      { type: 'vendor_allowlist', allowed: ['api.openai.com'] },
    ];
    const budget = {
      total: 50000,
      perTransaction: 1000,
      spent: 0,
      currency: 'USDC' as const,
    };

    const { policyHash, signature } = await signMandate(rules, budget, privateKey);

    expect(policyHash).toBeTypeOf('string');
    expect(signature).toBeTypeOf('string');

    const isValid = await verifyMandateSignature(policyHash, signature, publicKey);
    expect(isValid).toBe(true);
  });

  it('should fail verification with wrong public key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const rules: MandateRule[] = [{ type: 'category', allowed: ['research'] }];
    const budget = { total: 50000, perTransaction: 1000, spent: 0, currency: 'USDC' as const };

    const { policyHash, signature } = await signMandate(rules, budget, kp1.privateKey);

    const isValid = await verifyMandateSignature(policyHash, signature, kp2.publicKey);
    expect(isValid).toBe(false);
  });

  it('should produce deterministic hashes', () => {
    const rules: MandateRule[] = [{ type: 'category', allowed: ['research'] }];
    const budget = { total: 50000, perTransaction: 1000, spent: 0, currency: 'USDC' as const };

    const hash1 = computePolicyHash(rules, budget);
    const hash2 = computePolicyHash(rules, budget);

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different policies', () => {
    const budget = { total: 50000, perTransaction: 1000, spent: 0, currency: 'USDC' as const };

    const hash1 = computePolicyHash([{ type: 'category', allowed: ['research'] }], budget);
    const hash2 = computePolicyHash([{ type: 'category', allowed: ['advertising'] }], budget);

    expect(hash1).not.toBe(hash2);
  });
});

describe('MandateToken', () => {
  const createTestMandate = async (): Promise<{
    mandate: Mandate;
    publicKey: string;
    privateKey: string;
  }> => {
    const { privateKey, publicKey } = await generateKeyPair();
    const rules: MandateRule[] = [{ type: 'category', allowed: ['research'] }];
    const budget = { total: 50000, perTransaction: 1000, spent: 10000, currency: 'USDC' as const };
    const { policyHash, signature } = await signMandate(rules, budget, privateKey);

    const mandate: Mandate = {
      id: 'mdt_test',
      orgId: 'org_test',
      agentId: 'agent_test',
      name: 'Test',
      status: 'active',
      budget,
      rules,
      policyHash,
      signature,
      signerPublicKey: publicKey,
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2026-12-31'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return { mandate, publicKey, privateKey };
  };

  it('should create and verify a mandate token', async () => {
    const { mandate, publicKey, privateKey } = await createTestMandate();

    const token = await createMandateToken(mandate, privateKey);

    expect(token.version).toBe('1.0');
    expect(token.mandateId).toBe('mdt_test');
    expect(token.budget.remaining).toBe(40000); // 50000 - 10000

    const result = await verifyMandateToken(token, publicKey);
    expect(result.valid).toBe(true);
  });

  it('should reject expired tokens', async () => {
    const { mandate, publicKey, privateKey } = await createTestMandate();

    const token = await createMandateToken(mandate, privateKey, 0); // 0 TTL = immediately expired

    // Wait a tick for the token to expire
    await new Promise((r) => setTimeout(r, 10));

    const result = await verifyMandateToken(token, publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('should reject tokens with wrong public key', async () => {
    const { mandate, privateKey } = await createTestMandate();
    const wrongKp = await generateKeyPair();

    const token = await createMandateToken(mandate, privateKey);

    const result = await verifyMandateToken(token, wrongKp.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid signature');
  });
});
