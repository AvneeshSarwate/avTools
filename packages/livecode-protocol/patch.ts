export type EntityPatchValue =
  | null
  | boolean
  | number
  | string
  | EntityPatchValue[]
  | { [key: string]: EntityPatchValue };
export type EntityPatch =
  | { op: "set"; path: readonly string[]; value: EntityPatchValue }
  | { op: "delete"; path: readonly string[] };
/** Full reset/deletion or a sparse patch against the whole entity. */
export type EntityDelta<E> =
  | { name: string; entity: E | null; patches?: never }
  | { name: string; patches: EntityPatch[]; entity?: never };
