export class QuetraApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'QuetraApiError';
  }
}

export class MandateRejectionError extends QuetraApiError {
  constructor(public readonly reasons: string[]) {
    super(`Mandate rejected: ${reasons.join('; ')}`, 403);
    this.name = 'MandateRejectionError';
  }
}

export class BudgetExhaustedError extends QuetraApiError {
  constructor(
    public readonly budgetRemaining: number,
    public readonly requestedAmount: number,
  ) {
    super(
      `Budget exhausted: $${(budgetRemaining / 100).toFixed(2)} remaining, $${(requestedAmount / 100).toFixed(2)} requested`,
      403,
    );
    this.name = 'BudgetExhaustedError';
  }
}

export class MandateExpiredError extends QuetraApiError {
  constructor(public readonly expiredAt: Date) {
    super(`Mandate expired at ${expiredAt.toISOString()}`, 403);
    this.name = 'MandateExpiredError';
  }
}
