// ── Organization ──────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  publicKey: string;
  encryptedPrivateKey: string;
  defaultCurrency: 'USDC';
  timezone: string;
  webhookUrl?: string;
  plan: 'free' | 'pro' | 'enterprise';
  stripeCustomerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Agent ─────────────────────────────────────────────────

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  agentPublicKey: string;
  framework:
    | 'langchain'
    | 'crewai'
    | 'autogpt'
    | 'openai-agents'
    | 'claude-sdk'
    | 'google-adk'
    | 'semantic-kernel'
    | 'ag2'
    | 'pydantic-ai'
    | 'bedrock'
    | 'custom';
  safeAddress?: string;
  walletAddress?: string;
  status: 'active' | 'suspended' | 'decommissioned';
  lastSeenAt?: Date;
  tags: string[];
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Mandate ───────────────────────────────────────────────

export interface Mandate {
  id: string;
  orgId: string;
  agentId: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused' | 'expired' | 'revoked';
  budget: MandateBudget;
  rules: MandateRule[];
  policyHash: string;
  signature: string;
  signerPublicKey: string;
  validFrom: Date;
  validUntil: Date;
  onChain?: OnChainConfig;
  approvalThreshold?: number;
  approvers?: string[];
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  revocationReason?: string;
}

export interface MandateBudget {
  /** Total budget in cents. $100.00 = 10000. */
  total: number;
  /** Max spend per transaction in cents. $5.00 = 500. */
  perTransaction: number;
  /** Amount spent so far in cents. */
  spent: number;
  currency: 'USDC' | 'USD';
  resetInterval?: {
    period: 'daily' | 'weekly' | 'monthly';
    lastResetAt: Date;
  };
}

export interface OnChainConfig {
  safeAddress: string;
  allowanceModuleNonce: string;
  guardAddress?: string;
  chainId: number;
}

// ── Rules ─────────────────────────────────────────────────

export type MandateRule =
  | CategoryRule
  | VendorAllowlistRule
  | VendorBlocklistRule
  | TimeWindowRule
  | ApprovalRule
  | RateLimitRule
  | CustomRule;

export interface CategoryRule {
  type: 'category';
  allowed: string[];
}

export interface VendorAllowlistRule {
  type: 'vendor_allowlist';
  allowed: string[];
}

export interface VendorBlocklistRule {
  type: 'vendor_blocklist';
  blocked: string[];
}

export interface TimeWindowRule {
  type: 'time_window';
  days: number[];
  startHour: number;
  endHour: number;
  timezone: string;
}

export interface ApprovalRule {
  type: 'approval';
  threshold: number;
  approverIds: string[];
  timeoutMinutes: number;
}

export interface RateLimitRule {
  type: 'rate_limit';
  maxTransactions: number;
  windowMinutes: number;
}

export interface CustomRule {
  type: 'custom';
  engine: 'jsonlogic';
  expression: object;
  description: string;
}

// ── Mandate Token ─────────────────────────────────────────

export interface MandateToken {
  version: '1.0';
  type: 'mandate_token';
  mandateId: string;
  agentId: string;
  orgId: string;
  rules: MandateRule[];
  budget: {
    /** Max spend per transaction in cents. */
    perTransaction: number;
    /** Remaining budget in cents. */
    remaining: number;
    currency: 'USDC' | 'USD';
  };
  policyHash: string;
  signature: string;
  signerPublicKey: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

// ── Transaction Record ────────────────────────────────────

export interface TransactionRecord {
  id: string;
  mandateId: string;
  agentId: string;
  orgId: string;
  vendor: string;
  /** Transaction amount in cents. $5.00 = 500. */
  amount: number;
  currency: 'USDC' | 'USD';
  category?: string;
  description?: string;
  protocol: 'x402' | 'acp' | 'ap2' | 'kyapay' | 'direct' | 'stripe_cc';
  protocolRequestId?: string;
  decision: 'approved' | 'rejected' | 'pending_approval' | 'timeout';
  rejectionReasons?: string[];
  ruleEvaluations: RuleEvaluation[];
  /** Budget spent (cents) before this transaction. */
  budgetBefore: number;
  /** Budget spent (cents) after this transaction. */
  budgetAfter: number;
  txHash?: string;
  blockNumber?: number;
  approval?: ApprovalRecord;
  evaluationDurationMs: number;
  timestamp: Date;
}

export interface RuleEvaluation {
  ruleType: string;
  passed: boolean;
  detail: string;
}

export interface ApprovalRecord {
  requestedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
}

// ── Evaluation ────────────────────────────────────────────

export interface EvaluationContext {
  /** Amount to evaluate in cents. $5.00 = 500. */
  amount: number;
  vendor: string;
  category?: string;
  timestamp: Date;
  recentTransactionCount: number;
}

export interface EvaluationResult {
  allowed: boolean;
  evaluations: RuleEvaluation[];
  requiresApproval?: {
    threshold: number;
    approverIds: string[];
    timeoutMinutes: number;
  };
}

// ── Webhook Events ────────────────────────────────────────

export type WebhookEventType =
  | 'transaction.approved'
  | 'transaction.rejected'
  | 'mandate.budget.warning'
  | 'mandate.budget.exhausted'
  | 'mandate.expired';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: {
    mandateId: string;
    agentId: string;
    transactionId?: string;
    /** Transaction amount in cents. */
    amount?: number;
    /** Total budget spent so far in cents. */
    budgetSpent?: number;
    /** Total budget limit in cents. */
    budgetTotal?: number;
    decision?: string;
    rejectionReasons?: string[];
  };
}
