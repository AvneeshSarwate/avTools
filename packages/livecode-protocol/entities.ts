/**
 * Generic durable-entity CRUD wire types shared by `/entities/*`.
 */

/** The affected entity of a generic CRUD action. */
export interface DurableEntityRef {
  type: string;
  name: string;
}

export interface EntityPatchRequest {
  type: string;
  name: string;
  patches: import("./patch.ts").EntityPatch[];
  originId?: string;
  expectedRev?: number;
}

export interface EntityCreateRequest {
  type: string;
  name: string;
}

export interface EntityDuplicateRequest {
  type: string;
  name: string;
  targetName: string;
}

export interface EntityDeleteRequest {
  type: string;
  name: string;
}

export interface EntityMutationSuccess {
  ok: true;
  entity: DurableEntityRef;
}

export interface EntityMutationFailure {
  ok: false;
  error: string;
}

export type EntityMutationResponse =
  | EntityMutationSuccess
  | EntityMutationFailure;

export type EntityCreateResponse = EntityMutationResponse;
export type EntityDuplicateResponse = EntityMutationResponse;
export type EntityDeleteResponse = EntityMutationResponse;

/** Small acknowledgement shared by registered sparse patch handlers. */
export type EntityPatchResult = { ok: true; rev: number } | {
  ok: false;
  error: string;
  status: number;
};
