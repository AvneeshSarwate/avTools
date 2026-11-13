/** Host-owned snapshots never expose mutable arrays or prototype setters. */
export function parameterSnapshot(value: Record<string, unknown> = {}): Readonly<Record<string, any>> {
  const result: Record<string, unknown> = Object.create(null);
  for (const [name, item] of Object.entries(value)) result[name] = Array.isArray(item) ? Object.freeze(item) : item;
  return Object.freeze(result);
}
