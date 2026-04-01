/**
 * Deterministic JSON serialization for mandate policy hashing.
 * Keys are sorted recursively, no whitespace.
 */
export function canonicalize(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (typeof value === 'object' && value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}
