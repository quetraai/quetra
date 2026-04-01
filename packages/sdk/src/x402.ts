/**
 * x402 protocol header parsing and building utilities.
 *
 * The x402 protocol uses HTTP 402 responses with structured headers:
 * - PAYMENT-REQUIRED: base64-encoded payment requirements
 * - PAYMENT-SIGNATURE: base64-encoded signed payment authorization
 */

/** Parsed from the base64 PAYMENT-REQUIRED response header. */
export interface PaymentRequirements {
  x402Version: number;
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset?: string;
  extra?: Record<string, unknown>;
}

/** Response from the gateway's x402/pay endpoint. */
export interface X402PayResponse {
  approved: boolean;
  paymentPayload?: string;
  transactionId?: string;
  budgetRemaining?: number;
  reasons?: Array<{ rule: string; passed: boolean; detail: string }>;
}

/**
 * Decode the base64 PAYMENT-REQUIRED header into structured payment requirements.
 *
 * @throws {Error} If the header is not valid base64 or JSON
 */
export function parsePaymentRequired(header: string): PaymentRequirements {
  let json: string;
  try {
    json = atob(header);
  } catch {
    throw new Error('Invalid PAYMENT-REQUIRED header: not valid base64');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid PAYMENT-REQUIRED header: not valid JSON');
  }

  if (typeof parsed !== 'object' || !parsed) {
    throw new Error('Invalid PAYMENT-REQUIRED header: expected JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj.payTo) {
    throw new Error('Invalid PAYMENT-REQUIRED header: missing payTo');
  }
  if (!obj.maxAmountRequired) {
    throw new Error('Invalid PAYMENT-REQUIRED header: missing maxAmountRequired');
  }

  return parsed as PaymentRequirements;
}

/**
 * Encode a payment payload as base64 for the PAYMENT-SIGNATURE header.
 */
export function buildPaymentSignature(payload: unknown): string {
  return btoa(JSON.stringify(payload));
}
