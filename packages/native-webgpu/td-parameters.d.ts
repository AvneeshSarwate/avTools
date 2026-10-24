/** Export a literal `parameters` object directly from the entrypoint.
 * Names start with an uppercase letter followed by lowercase letters/digits.
 * Stable names/types preserve TD values, expressions, exports and bindings.
 */
type Base = {readonly label?: string; readonly page?: string};
type Numeric = {readonly min?: number; readonly max?: number; readonly clamp?: boolean};
export type ParameterDefinition = Base & (
  | ({readonly type: 'float' | 'int'; readonly default?: number} & Numeric)
  | {readonly type: 'toggle'; readonly default?: boolean}
  | {readonly type: 'string'; readonly default?: string}
  | {readonly type: 'menu'; readonly options: readonly string[]; readonly labels?: readonly string[]; readonly default?: string}
  | ({readonly type: 'xy'; readonly default?: readonly [number, number]} & Numeric)
  | ({readonly type: 'xyz' | 'rgb'; readonly default?: readonly [number, number, number]} & Numeric)
  | ({readonly type: 'rgba'; readonly default?: readonly [number, number, number, number]} & Numeric)
  | {readonly type: 'pulse'}
);
export type ParameterDefinitions = Readonly<Record<string, ParameterDefinition>>;
type ParameterValue<P> = P extends {type: 'toggle'} ? boolean
  : P extends {type: 'menu'; options: readonly (infer S)[]} ? S
  : P extends {type: 'string'} ? string
  : P extends {type: 'xy'} ? readonly [number, number]
  : P extends {type: 'xyz' | 'rgb'} ? readonly [number, number, number]
  : P extends {type: 'rgba'} ? readonly [number, number, number, number]
  : number;
/** Latest accepted cook snapshot. Pulse controls arrive through onPulse instead. */
export type ParameterValues<P extends ParameterDefinitions> = {readonly [K in keyof P as P[K] extends {type: 'pulse'} ? never : K]: ParameterValue<P[K]>};
