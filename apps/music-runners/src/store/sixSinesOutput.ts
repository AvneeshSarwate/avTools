import { MidiOutput, type MidiOutputTransport, type MidiPortInfo } from "@avtools/midi/browser";
import { ClapNoteExpression, SixSinesEventType, type SixSinesEvent } from "../../../../packages/six-sines/six-sines-node.js";
import { REST_TIMBRE, TIMBRE_CC } from "../model/mpe";

type Voice = { noteId: number; channel: number; key: number };

function unit(value: number) {
  return Math.max(0, Math.min(127, Math.round(value))) / 127;
}

/** Translate MPE member channels to the worklet's native note IDs. */
export class SixSinesOutput extends MidiOutput {
  private nextNoteId = 0;
  private readonly channels = Array.from({ length: 16 }, () => ({
    tuning: 0,
    pressure: 0,
    brightness: unit(REST_TIMBRE),
    voices: new Map<number, Voice>(),
  }));

  constructor(port: MidiPortInfo, transport: MidiOutputTransport, private readonly sendEvents: (events: SixSinesEvent[]) => void) {
    super(port, transport);
  }

  override noteOn(channel: number, key: number, velocity = 100) {
    if (unit(velocity) === 0) {
      this.noteOff(channel, key);
      return;
    }
    if (this.closed) return;
    const state = this.channels[channel];
    this.noteOff(channel, key);
    const voice = { noteId: this.nextNoteId++, channel, key };
    state.voices.set(key, voice);
    this.sendEvents([
      { type: SixSinesEventType.noteOn, ...voice, value: unit(velocity) },
      this.expression(voice, ClapNoteExpression.tuning, state.tuning),
      this.expression(voice, ClapNoteExpression.pressure, state.pressure),
      this.expression(voice, ClapNoteExpression.brightness, state.brightness),
    ]);
  }

  override noteOff(channel: number, key: number, velocity = 0) {
    if (this.closed) return;
    const voices = this.channels[channel].voices;
    const voice = voices.get(key);
    if (!voice) return;
    voices.delete(key);
    this.sendEvents([{ type: SixSinesEventType.noteOff, ...voice, value: unit(velocity) }]);
  }

  setTuning(channel: number, semitones: number) {
    this.setChannelExpression(channel, "tuning", semitones);
  }

  override channelPressure(channel: number, pressure: number) {
    this.setChannelExpression(channel, "pressure", unit(pressure));
  }

  override polyPressure(channel: number, key: number, pressure: number) {
    if (this.closed) return;
    const voice = this.channels[channel].voices.get(key);
    if (voice) this.sendEvents([this.expression(voice, ClapNoteExpression.pressure, unit(pressure))]);
  }

  override cc(channel: number, controller: number, value: number) {
    if (controller === TIMBRE_CC) this.setChannelExpression(channel, "brightness", unit(value));
    else super.cc(channel, controller, value);
  }

  panic() {
    if (this.closed) return;
    for (const state of this.channels) {
      state.voices.clear();
      state.tuning = 0;
      state.pressure = 0;
      state.brightness = unit(REST_TIMBRE);
    }
    this.sendEvents([{ type: SixSinesEventType.allNotesOff }]);
  }

  private setChannelExpression(channel: number, parameter: "tuning" | "pressure" | "brightness", value: number) {
    if (this.closed) return;
    const state = this.channels[channel];
    state[parameter] = value;
    const events = Array.from(state.voices.values(), (voice) => this.expression(voice, ClapNoteExpression[parameter], value));
    if (events.length) this.sendEvents(events);
  }

  private expression(voice: Voice, expressionId: number, value: number): SixSinesEvent {
    return { type: SixSinesEventType.noteExpression, ...voice, expressionId, value };
  }
}
