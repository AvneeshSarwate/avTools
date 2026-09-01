export interface SixSinesIdentity {
  noteId?: number;
  port?: number;
  channel?: number;
  key?: number;
}

export type SixSinesWhen = { frame: number; time?: never } | { time: number; frame?: never } |
  { frame?: never; time?: never };

export interface SixSinesParameterInfo {
  id: number;
  flags: number;
  minValue: number;
  maxValue: number;
  defaultValue: number;
  name: string;
}

export interface SixSinesEvent extends SixSinesIdentity {
  type: number;
  frame?: number;
  time?: number;
  paramId?: number;
  expressionId?: number;
  value?: number;
}

export interface SixSinesNodeOptions {
  workletUrl?: string | URL;
  wasmUrl?: string | URL;
  wasmBytes?: ArrayBuffer | ArrayBufferView;
  presetUrl?: string | URL;
  presetBytes?: ArrayBuffer | ArrayBufferView | Blob;
  numberOfInputs?: number;
  maxFrames?: number;
  maxEventsPerQuantum?: number;
  queueCapacity?: number;
  readyTimeoutMs?: number;
}

export const SixSinesEventType: Readonly<{
  noteOn: 1;
  noteOff: 2;
  noteExpression: 3;
  paramValue: 4;
  paramMod: 5;
  allNotesOff: 6;
}>;

export const ClapNoteExpression: Readonly<{
  volume: 0;
  pan: 1;
  tuning: 2;
  vibrato: 3;
  expression: 4;
  brightness: 5;
  pressure: 6;
}>;

export class SixSinesNode {
  static create(context: BaseAudioContext, options?: SixSinesNodeOptions): Promise<SixSinesNode>;

  readonly context: BaseAudioContext;
  readonly node: AudioWorkletNode;
  readonly port: MessagePort;
  readonly ready: Promise<{ type: "ready"; frame: number; buildId: string }>;
  readonly readyInfo: { type: "ready"; frame: number; buildId: string };
  readonly lastError?: Error;

  connect(destination: AudioNode, output?: number, input?: number): AudioNode;
  connect(destination: AudioParam, output?: number): void;
  disconnect(): void;
  disconnect(output: number): void;
  disconnect(destination: AudioNode | AudioParam): void;
  /** Deliver an ordered event batch on the next AudioWorklet render quantum. */
  send(events: SixSinesEvent[]): Promise<{ accepted: number; rejected: number }>;
  /** Advanced/test API: every event must have an explicit frame or time. */
  schedule(events: SixSinesEvent[]): Promise<{ accepted: number; rejected: number }>;
  noteOn(event: SixSinesIdentity & SixSinesWhen & { key: number; velocity?: number }): Promise<unknown>;
  noteOff(event: SixSinesIdentity & SixSinesWhen & { key: number; velocity?: number }): Promise<unknown>;
  noteExpression(event: SixSinesIdentity & SixSinesWhen &
    { expressionId: number; value: number }): Promise<unknown>;
  paramValue(event: SixSinesWhen & { paramId: number; value: number }): Promise<unknown>;
  paramMod(event: SixSinesIdentity & SixSinesWhen &
    { noteId: number; paramId: number; amount: number }): Promise<unknown>;
  allNotesOff(when?: SixSinesWhen): Promise<unknown>;
  loadPreset(preset: ArrayBuffer | ArrayBufferView | Blob): Promise<unknown>;
  getParameterInfo(): Promise<SixSinesParameterInfo[]>;
  stats(): Promise<Record<string, number | string>>;
  dispose(): Promise<unknown>;
}
