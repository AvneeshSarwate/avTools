export type ModuleLookupValues = Readonly<Record<string, string>>;

export interface ModuleLookupView {
  moduleId: string;
  lookups: ModuleLookupValues;
}

/** Lookup values affect editor decorations; transport/object identity does not. */
export function moduleLookupValuesEqual(
  left: ModuleLookupValues,
  right: ModuleLookupValues,
): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((callsiteId) => left[callsiteId] === right[callsiteId]);
}

/** Retain the rendered lookup object when a publication has identical values. */
export function retainModuleLookupValues<T extends ModuleLookupValues>(
  previous: T,
  next: T,
): T {
  return moduleLookupValuesEqual(previous, next) ? previous : next;
}

/** Equality for selectors whose binding can change independently of values. */
export function moduleLookupViewEqual(
  left: ModuleLookupView,
  right: ModuleLookupView,
): boolean {
  return left.moduleId === right.moduleId &&
    moduleLookupValuesEqual(left.lookups, right.lookups);
}
