import {MidiOutput, type MidiInputEvent, type MidiPortInfo} from '../../midi/api.ts';
import {decodePacket} from '../../../apps/deno-notebooks/midi/decode.ts';
import type {MidiHost, MidiInputHandle, MidiInputOptions} from '../td-midi.d.ts';
import type {SketchLifetime} from './td-timing.ts';
const g = globalThis as any;
let sequence = 0;
let selections: Readonly<Record<string, string>> = {};
const receivers = new Map<number, (bytes: Uint8Array) => void>();
const bindings = new Set<() => void>();
const native = (op: string, id = 0, port = '', rate = 250, raw = true, bytes?: Uint8Array) => g.__avMIDI(op, id, port, rate, raw, bytes);
g.__avMIDIEvent = (id: number, bytes: Uint8Array) => receivers.get(id)?.(bytes);
g.__avMIDISelections = () => {
  selections = Object.freeze(JSON.parse(g.__avMIDISelectionsJSON || '{}'));
  for (const update of [...bindings]) update();
};
function events(bytes: Uint8Array): MidiInputEvent[] {
  return decodePacket(bytes).records.map((r): MidiInputEvent => {
    const common = {channel: r.channel, timeMs: r.tsUs / 1000};
    switch (r.kind) {
      case 1: return {...common, type: 'cc', controller: r.a, value: r.b};
      case 2: return {...common, type: 'pitchBend', bend: r.v16};
      case 3: return {...common, type: 'channelPressure', pressure: r.b};
      case 4: return {...common, type: 'polyPressure', note: r.a, pressure: r.b};
      case 5: return {...common, type: 'programChange', program: r.b};
      case 6: return {...common, type: r.extra ? 'noteOn' : 'noteOff', note: r.a, velocity: r.b};
      default: throw Error('Unsupported native MIDI record');
    }
  });
}
export function createMIDI(life: SketchLifetime): MidiHost {
  const resources = new Set<{close(): void}>();
  life.onDispose(() => { for (const resource of [...resources]) resource.close(); });
  const list = (output: boolean): MidiPortInfo[] => life.run(() => JSON.parse(native(output ? 'outputs' : 'inputs')).map((p: any) => Object.freeze({...p, manufacturer: null})));
  function input(initial: string, options: MidiInputOptions = {}, parameter?: string): MidiInputHandle {
    const rate = options.rateHz ?? 250, raw = options.rawCC ?? true;
    if (!Number.isInteger(rate) || rate < 1 || rate > 1000 || typeof raw !== 'boolean') throw Error('MIDI options require rateHz 1–1000 and boolean rawCC');
    let id = 0, selected = '', port: MidiPortInfo | null = null, error = '', closed = false;
    const messages = new Set<(event: MidiInputEvent) => void>(), statuses = new Set<() => void>();
    function disconnect() {
      if (id) { receivers.delete(id); try { native('close', id); } catch { /* Native generation cancellation may already have closed it. */ } }
      id = 0; port = null;
    }
    function connect(next: string, strict: boolean) {
      disconnect(); selected = next; error = '';
      if (next) {
        try {
          const found = list(false).find(p => p.id === next);
          if (!found) throw Error(`MIDI input unavailable: ${next}`);
          const key = ++sequence;
          native('input', key, next, rate, raw);
          id = key; port = found;
          receivers.set(key, bytes => {
            for (const event of events(bytes)) {
              if (closed || id !== key) break;
              for (const callback of [...messages]) { if (closed || id !== key) break; life.run(() => callback(event)); }
            }
          });
        } catch (cause) { error = String((cause as Error).message ?? cause); if (strict) throw cause; console.warn(error); }
      }
      for (const callback of [...statuses]) life.run(callback);
    }
    const update = () => {
      if (closed) return;
      const next = selections[parameter!] ?? '';
      if (next !== selected) life.run(() => connect(next, false));
    };
    const handle: MidiInputHandle = Object.freeze<MidiInputHandle>({
      get port() { return port; }, get connected() { return !!id; }, get error() { return error; }, get closed() { return closed; },
      onMessage(callback) { return life.run(() => { if (closed) throw Error('MIDI input is closed'); if (typeof callback !== 'function') throw TypeError('Expected MIDI callback'); messages.add(callback); return () => messages.delete(callback); }); },
      on(type, callback) { if (typeof callback !== 'function') throw TypeError('Expected MIDI callback'); return handle.onMessage(event => { if (event.type === type) (callback as any)(event); }); },
      onStatus(callback) { return life.run(() => { if (closed) throw Error('MIDI input is closed'); if (typeof callback !== 'function') throw TypeError('Expected MIDI callback'); statuses.add(callback); return () => statuses.delete(callback); }); },
      reconnect() { life.run(() => { if (closed) throw Error('MIDI input is closed'); connect(parameter === undefined ? selected : selections[parameter] ?? '', false); }); },
      close() { if (closed) return; closed = true; bindings.delete(update); disconnect(); messages.clear(); statuses.clear(); resources.delete(handle); },
    });
    connect(initial, parameter === undefined);
    resources.add(handle); if (parameter !== undefined) bindings.add(update);
    return handle;
  }
  return Object.freeze({
    listInputs: () => list(false), listOutputs: () => list(true),
    bindInput(parameter: string, options?: MidiInputOptions) {
      return life.run(() => {
        if (!Object.hasOwn(selections, parameter)) throw Error(`'${parameter}' is not a declared midiInput parameter`);
        return input(selections[parameter], options, parameter);
      });
    },
    async openInput(port: string, options?: MidiInputOptions) {
      if (typeof port !== 'string' || !port) throw Error('MIDI input requires a device id');
      return life.run(() => input(port, options));
    },
    async openOutput(portId: string) {
      return life.run(() => {
        const port = list(true).find(p => p.id === portId);
        if (!port) throw Error(`MIDI output unavailable: ${portId}`);
        const id = ++sequence;
        native('output', id, portId);
        const output = new MidiOutput(port, {
          send(bytes) { life.run(() => native('send', id, '', 250, true, Uint8Array.from(bytes))); },
          close() { try { native('close', id); } catch { /* Already invalidated. */ } resources.delete(output); },
        });
        resources.add(output); return output;
      });
    },
    get stats() { return life.run(() => Object.freeze(JSON.parse(native('stats')))); },
  });
}
