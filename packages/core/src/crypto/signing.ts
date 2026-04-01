import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { Mandate, MandateBudget, MandateRule, MandateToken } from '../types.js';
import { canonicalize } from './canonicalize.js';

/**
 * Generate a new Ed25519 key pair for an organization.
 */
export async function generateKeyPair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
  };
}

/**
 * Compute the policy hash for a mandate's rules and budget.
 */
export function computePolicyHash(rules: MandateRule[], budget: MandateBudget): string {
  const canonical = canonicalize({ rules, budget });
  const hash = sha256(new TextEncoder().encode(canonical));
  return bytesToHex(hash);
}

/**
 * Sign a mandate's policy hash with an organization's private key.
 */
export async function signMandate(
  rules: MandateRule[],
  budget: MandateBudget,
  privateKeyHex: string,
): Promise<{ policyHash: string; signature: string }> {
  const policyHash = computePolicyHash(rules, budget);
  const message = new TextEncoder().encode(policyHash);
  const privateKey = hexToBytes(privateKeyHex);
  const signature = await ed.signAsync(message, privateKey);

  return {
    policyHash,
    signature: bytesToHex(signature),
  };
}

/**
 * Verify a mandate's signature against a public key.
 */
export async function verifyMandateSignature(
  policyHash: string,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  const message = new TextEncoder().encode(policyHash);
  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(publicKeyHex);

  return ed.verifyAsync(signature, message, publicKey);
}

/**
 * Create a portable MandateToken from a mandate.
 */
export async function createMandateToken(
  mandate: Mandate,
  privateKeyHex: string,
  ttlSeconds = 3600,
): Promise<MandateToken> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = bytesToHex(ed.utils.randomPrivateKey()).slice(0, 32);

  const token: MandateToken = {
    version: '1.0',
    type: 'mandate_token',
    mandateId: mandate.id,
    agentId: mandate.agentId,
    orgId: mandate.orgId,
    rules: mandate.rules,
    budget: {
      perTransaction: mandate.budget.perTransaction,
      remaining: mandate.budget.total - mandate.budget.spent,
      currency: mandate.budget.currency,
    },
    policyHash: mandate.policyHash,
    signature: mandate.signature,
    signerPublicKey: mandate.signerPublicKey,
    issuedAt: now,
    expiresAt: now + ttlSeconds,
    nonce,
  };

  return token;
}

/**
 * Verify a MandateToken's signature and expiry.
 */
export async function verifyMandateToken(
  token: MandateToken,
  orgPublicKey: string,
): Promise<{ valid: boolean; reason?: string }> {
  // Check version
  if (token.version !== '1.0') {
    return {
      valid: false,
      reason: `Unsupported token version: ${token.version}`,
    };
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (now >= token.expiresAt) {
    return { valid: false, reason: 'Token has expired' };
  }

  // Check issuance time (not from the future)
  if (token.issuedAt > now + 60) {
    return { valid: false, reason: 'Token issuedAt is in the future' };
  }

  // Verify the policy signature
  const isValid = await verifyMandateSignature(token.policyHash, token.signature, orgPublicKey);

  if (!isValid) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}
