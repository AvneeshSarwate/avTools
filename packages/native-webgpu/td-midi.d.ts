import type {MidiInputEvent, MidiInputEventType, MidiInputListener, MidiOutput, MidiPortInfo} from '../midi/api.ts';
import type {ParameterDefinitions} from './td-parameters.d.ts';
export type {MidiInputEvent, MidiInputEventType, MidiInputListener, MidiOutput, MidiPortInfo};
export interface MidiInputOptions {
  /** Batch delivery rate, integer 1–1000. Default 250 (~4 ms). No idle polling. */
  rateHz?: number;
  /** Default true. False coalesces absolute CC values; do not use for relative encoders. */
  rawCC?: boolean;
}
export interface MidiInputHandle {
  readonly port: MidiPortInfo | null;
  readonly connected: boolean;
  readonly closed: boolean;
  /** Last connection error; empty for None or a successful open. */
  readonly error: string;
  onMessage(callback: (event: MidiInputEvent) => void): () => void;
  on<T extends MidiInputEventType>(type: T, callback: MidiInputListener<T>): () => void;
  /** Called after a selector change/reconnect attempt; inspect port/connected/error. */
  onStatus(callback: () => void): () => void;
  /** Retry the selected device. No automatic hardware reconnection. */
  reconnect(): void;
  close(): void;
}
type InputKey<P> = Extract<{[K in keyof P]: P[K] extends {type: 'midiInput'} ? K : never}[keyof P], string>;
export interface MidiHost<P extends ParameterDefinitions = ParameterDefinitions> {
  listInputs(): MidiPortInfo[];
  listOutputs(): MidiPortInfo[];
  /** Listeners survive selection changes. Requires a declared midiInput parameter. */
  bindInput(parameter: ParameterDefinitions extends P ? string : InputKey<P>, options?: MidiInputOptions): MidiInputHandle;
  openInput(deviceId: string, options?: MidiInputOptions): Promise<MidiInputHandle>;
  openOutput(deviceId: string): Promise<MidiOutput>;
  /** Cumulative since this native runtime was created. Includes native and JS-delivery queue drops. */
  readonly stats: Readonly<{droppedMessages: number; batches: number; queuedBatches: number; inputs: number; outputs: number}>;
}
