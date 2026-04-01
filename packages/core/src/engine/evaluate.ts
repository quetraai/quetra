import jsonLogic from 'json-logic-js';
import type {
  EvaluationContext,
  EvaluationResult,
  Mandate,
  MandateRule,
  RuleEvaluation,
} from '../types.js';

/**
 * Evaluate a payment request against a mandate's rules.
 * All rules must pass for the mandate to allow the transaction.
 */
export function evaluateMandate(mandate: Mandate, context: EvaluationContext): EvaluationResult {
  const evaluations: RuleEvaluation[] = [];
  let requiresApproval: EvaluationResult['requiresApproval'];

  // Budget checks (always run first)
  evaluations.push(evaluatePerTransactionBudget(mandate, context));
  evaluations.push(evaluateTotalBudget(mandate, context));

  // Rule-specific checks
  for (const rule of mandate.rules) {
    const evaluation = evaluateRule(rule, context);

    if (rule.type === 'approval' && context.amount > rule.threshold) {
      requiresApproval = {
        threshold: rule.threshold,
        approverIds: rule.approverIds,
        timeoutMinutes: rule.timeoutMinutes,
      };
    }

    evaluations.push(evaluation);
  }

  const allowed = evaluations.every((e) => e.passed);

  return {
    allowed,
    evaluations,
    requiresApproval: allowed ? requiresApproval : undefined,
  };
}

function evaluatePerTransactionBudget(
  mandate: Mandate,
  context: EvaluationContext,
): RuleEvaluation {
  const limit = mandate.budget.perTransaction;
  const passed = context.amount <= limit;

  return {
    ruleType: 'budget_per_tx',
    passed,
    detail: passed
      ? `$${fmt(context.amount)} <= $${fmt(limit)} per-tx limit`
      : `$${fmt(context.amount)} exceeds $${fmt(limit)} per-tx limit`,
  };
}

function evaluateTotalBudget(mandate: Mandate, context: EvaluationContext): RuleEvaluation {
  const remaining = mandate.budget.total - mandate.budget.spent;
  const passed = context.amount <= remaining;

  return {
    ruleType: 'budget_total',
    passed,
    detail: passed
      ? `$${fmt(context.amount)} <= $${fmt(remaining)} remaining of $${fmt(mandate.budget.total)} budget`
      : `$${fmt(context.amount)} exceeds $${fmt(remaining)} remaining budget`,
  };
}

function evaluateRule(rule: MandateRule, context: EvaluationContext): RuleEvaluation {
  switch (rule.type) {
    case 'category':
      return evaluateCategory(rule.allowed, context);
    case 'vendor_allowlist':
      return evaluateVendorAllowlist(rule.allowed, context);
    case 'vendor_blocklist':
      return evaluateVendorBlocklist(rule.blocked, context);
    case 'time_window':
      return evaluateTimeWindow(rule, context);
    case 'rate_limit':
      return evaluateRateLimit(rule, context);
    case 'approval':
      return evaluateApproval(rule, context);
    case 'custom':
      return evaluateCustom(rule, context);
  }
}

function evaluateCategory(allowed: string[], context: EvaluationContext): RuleEvaluation {
  if (!context.category) {
    return {
      ruleType: 'category',
      passed: false,
      detail: `No category provided; allowed: [${allowed.join(', ')}]`,
    };
  }

  const passed = allowed.includes(context.category);
  return {
    ruleType: 'category',
    passed,
    detail: passed
      ? `${context.category} in [${allowed.join(', ')}]`
      : `${context.category} not in [${allowed.join(', ')}]`,
  };
}

function evaluateVendorAllowlist(allowed: string[], context: EvaluationContext): RuleEvaluation {
  const passed = allowed.some((v) => context.vendor === v || context.vendor.endsWith(`.${v}`));

  return {
    ruleType: 'vendor_allowlist',
    passed,
    detail: passed
      ? `${context.vendor} in allowlist`
      : `${context.vendor} not in [${allowed.join(', ')}]`,
  };
}

function evaluateVendorBlocklist(blocked: string[], context: EvaluationContext): RuleEvaluation {
  const isBlocked = blocked.some((v) => context.vendor === v || context.vendor.endsWith(`.${v}`));

  return {
    ruleType: 'vendor_blocklist',
    passed: !isBlocked,
    detail: isBlocked
      ? `${context.vendor} is in blocklist [${blocked.join(', ')}]`
      : `${context.vendor} not in blocklist`,
  };
}

function evaluateTimeWindow(
  rule: { days: number[]; startHour: number; endHour: number; timezone: string },
  context: EvaluationContext,
): RuleEvaluation {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let parts: Intl.DateTimeFormatPart[];
  try {
    // Get the time in the mandate's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: rule.timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    parts = formatter.formatToParts(context.timestamp);
  } catch {
    return {
      ruleType: 'time_window',
      passed: false,
      detail: `Invalid timezone: ${rule.timezone}`,
    };
  }

  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minutePart = parts.find((p) => p.type === 'minute')?.value ?? '0';

  const currentDay = dayNames.indexOf(weekdayPart.slice(0, 3));
  const currentHour = parseInt(hourPart, 10) + parseInt(minutePart, 10) / 60;

  const dayAllowed = rule.days.includes(currentDay);
  const hourAllowed = currentHour >= rule.startHour && currentHour < rule.endHour;
  const passed = dayAllowed && hourAllowed;

  const allowedDayNames = rule.days.map((d) => dayNames[d]).join(', ');

  return {
    ruleType: 'time_window',
    passed,
    detail: passed
      ? `${weekdayPart} ${hourPart}:${minutePart} ${rule.timezone} within ${allowedDayNames} ${rule.startHour}:00-${rule.endHour}:00`
      : `${weekdayPart} ${hourPart}:${minutePart} ${rule.timezone} outside ${allowedDayNames} ${rule.startHour}:00-${rule.endHour}:00`,
  };
}

function evaluateRateLimit(
  rule: { maxTransactions: number; windowMinutes: number },
  context: EvaluationContext,
): RuleEvaluation {
  const passed = context.recentTransactionCount < rule.maxTransactions;

  return {
    ruleType: 'rate_limit',
    passed,
    detail: passed
      ? `${context.recentTransactionCount} tx in last ${rule.windowMinutes}min < ${rule.maxTransactions} limit`
      : `${context.recentTransactionCount} tx in last ${rule.windowMinutes}min >= ${rule.maxTransactions} limit`,
  };
}

function evaluateApproval(
  rule: { threshold: number; approverIds: string[]; timeoutMinutes: number },
  context: EvaluationContext,
): RuleEvaluation {
  // The approval rule always "passes" the evaluation — but if the amount exceeds
  // the threshold, the caller should trigger an approval workflow.
  const needsApproval = context.amount > rule.threshold;

  return {
    ruleType: 'approval',
    passed: true, // Rule itself doesn't block; it flags for approval
    detail: needsApproval
      ? `$${fmt(context.amount)} > $${fmt(rule.threshold)} threshold — requires human approval`
      : `$${fmt(context.amount)} <= $${fmt(rule.threshold)} threshold — auto-approved`,
  };
}

function evaluateCustom(
  rule: { engine: 'jsonlogic'; expression: object; description: string },
  context: EvaluationContext,
): RuleEvaluation {
  try {
    const result = jsonLogic.apply(rule.expression, context);
    const passed = Boolean(result);

    return {
      ruleType: 'custom',
      passed,
      detail: passed
        ? `Custom rule "${rule.description}" passed`
        : `Custom rule "${rule.description}" failed`,
    };
  } catch (error) {
    return {
      ruleType: 'custom',
      passed: false,
      detail: `Custom rule "${rule.description}" error: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
}

/** Format cents as dollars */
function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}
