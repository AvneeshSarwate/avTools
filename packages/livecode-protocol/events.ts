/** Global, transient engine input. Bodies must be JSON-serializable on every host. */
// A project may supply its own body type; the default keeps ad-hoc livecoding terse.
// deno-lint-ignore no-explicit-any
export interface LivecodeEvent<Body = any> {
  type: string;
  body: Body;
}

export interface EmitEventResult {
  delivered: number;
}
