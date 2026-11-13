/**
 * The livecode wire contract now lives in `@avtools/livecode-protocol`, the
 * one source both this server and the browser clients compile against. This
 * module stays as the server-side name for it so server imports read as
 * `./protocol.ts` and nothing has to know where the package sits.
 *
 * Add server-only types to the server module that owns them, not here; add
 * wire types to the package.
 */

export type * from "@avtools/livecode-protocol";
