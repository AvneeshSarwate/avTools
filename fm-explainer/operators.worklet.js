// A small phase-modulation operator bank. This is the "raw" engine of the
// manual: everything FM-related happens in the 20-odd lines of renderVoice().
//
// The patch format (see src/audio/patch.ts) uses physical units: indices in
// radians, times in seconds. Operators are evaluated in order, and an
// operator may only modulate a later one, which is the same feed-forward
// rule Six Sines uses.

const TWO_PI = 2 * Math.PI;
const MAX_VOICES = 12;

function envelope(env, time, releasedAt, levelAtRelease) {
  // Linear attack, exponential decay towards sustain, exponential release.
  // A decay or release of `d` seconds has fallen 99% of the way after `d`.
  if (releasedAt >= 0) {
    const r = Math.max(env.r, 0.003);
    return levelAtRelease * Math.exp((-5 * (time - releasedAt)) / r);
  }
  if (time < env.a) return time / env.a;
  if (env.d <= 0) return env.s;
  return env.s + (1 - env.s) * Math.exp((-5 * (time - env.a)) / env.d);
}

const FLAT = { a: 0, d: 0, s: 1, r: 0.05 };

class Voice {
  constructor() {
    this.active = false;
    this.key = -1;
    this.phase = new Float64Array(6);
    this.out = new Float64Array(6);
    this.prev = new Float64Array(6);
  }

  start(key, velocity, serial) {
    this.active = true;
    this.key = key;
    this.velocity = velocity;
    this.serial = serial;
    this.time = 0;
    this.releasedAt = -1;
    this.heldLevels = null;
    this.phase.fill(0);
    this.out.fill(0);
    this.prev.fill(0);
  }
}

class Operators extends AudioWorkletProcessor {
  constructor() {
    super();
    this.patch = { ops: [], edges: [], gain: 0.5 };
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice());
    this.serial = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "patch") this.patch = data.patch;
      else if (data.type === "noteOn") this.noteOn(data.key, data.velocity);
      else if (data.type === "noteOff") this.noteOff(data.key);
      else if (data.type === "panic") for (const v of this.voices) v.active = false;
    };
  }

  noteOn(key, velocity) {
    this.noteOff(key);
    let voice = this.voices.find((v) => !v.active);
    if (!voice) voice = this.voices.reduce((a, b) => (a.serial < b.serial ? a : b));
    voice.start(key, velocity, this.serial++);
  }

  noteOff(key) {
    for (const v of this.voices) {
      if (v.active && v.key === key && v.releasedAt < 0) v.releasedAt = v.time;
    }
  }

  // Envelope value for one node of one voice. Levels at the moment of release
  // are captured once so the release starts from wherever the envelope was.
  level(voice, slot, env) {
    if (voice.releasedAt < 0) return envelope(env, voice.time, -1, 0);
    return envelope(env, voice.time, voice.releasedAt, voice.heldLevels[slot]);
  }

  renderVoice(voice, left, right, frames) {
    const { ops, edges } = this.patch;
    const n = ops.length;
    const f0 = 440 * Math.pow(2, (voice.key - 69) / 12);
    const dt = 1 / sampleRate;
    const keyOctaves = (voice.key - 60) / 12;

    if (voice.releasedAt >= 0 && !voice.heldLevels) {
      // slots: n amp envs, n feedback envs, then one per edge
      const held = new Float64Array(2 * n + edges.length);
      for (let i = 0; i < n; i++) {
        held[i] = envelope(ops[i].amp ?? FLAT, voice.time, -1, 0);
        held[n + i] = envelope(ops[i].fbEnv ?? FLAT, voice.time, -1, 0);
      }
      edges.forEach((e, k) => (held[2 * n + k] = envelope(e.env ?? FLAT, voice.time, -1, 0)));
      voice.heldLevels = held;
    }

    // Per-edge scaling that does not change within a block.
    const edgeScale = edges.map((e) => {
      const vel = 1 - (e.velocity ?? 0) * (1 - voice.velocity);
      const keyScale = Math.pow(2, -(e.keyScale ?? 0) * keyOctaves);
      return e.index * vel * keyScale;
    });
    const velocityGain = 0.8 + 0.2 * voice.velocity;

    let loudest = 0;
    for (let s = 0; s < frames; s++) {
      let mixL = 0;
      let mixR = 0;
      for (let i = 0; i < n; i++) {
        const op = ops[i];
        const freq = op.fixed ? op.hz ?? 0 : f0 * op.ratio + (op.hz ?? 0);

        // ---- the whole of FM is in this block ----
        let phaseOffset = 0; // radians added to the phase   (phase modulation)
        let freqOffset = 0; //  hertz added to the frequency (true FM)
        let ring = 1; //         multiplier on the output    (ring modulation)
        for (let k = 0; k < edges.length; k++) {
          const e = edges[k];
          if (e.to !== i) continue;
          const depth = edgeScale[k] * this.level(voice, 2 * n + k, e.env ?? FLAT);
          const mod = voice.out[e.from];
          if (e.mode === "fm") freqOffset += depth * mod; // index is in Hz of deviation here
          else if (e.mode === "rm") ring *= 1 + Math.min(depth, 1) * (mod - 1);
          else phaseOffset += depth * mod;
        }
        if (op.feedback) {
          const fb = op.feedback * this.level(voice, n + i, op.fbEnv ?? FLAT);
          phaseOffset += fb * 0.5 * (voice.out[i] + voice.prev[i]);
        }
        voice.phase[i] += TWO_PI * (freq + freqOffset) * dt;
        if (voice.phase[i] > 1e6) voice.phase[i] -= TWO_PI * Math.floor(voice.phase[i] / TWO_PI);
        const sample = Math.sin(voice.phase[i] + phaseOffset) * ring;
        // ------------------------------------------

        voice.prev[i] = voice.out[i];
        voice.out[i] = sample;
        if (op.level > 0) {
          const amp = op.level * this.level(voice, i, op.amp ?? FLAT);
          if (amp > loudest) loudest = amp;
          const pan = op.pan ?? 0;
          mixL += sample * amp * (1 - Math.max(0, pan));
          mixR += sample * amp * (1 + Math.min(0, pan));
        }
      }
      left[s] += mixL * velocityGain;
      right[s] += mixR * velocityGain;
      voice.time += dt;
    }
    if (voice.releasedAt >= 0 && loudest < 1e-4) voice.active = false;
    if (voice.releasedAt < 0 && voice.time > 30) voice.releasedAt = voice.time;
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (const voice of this.voices) {
      if (voice.active) this.renderVoice(voice, left, right ?? left, left.length);
    }
    const gain = this.patch.gain ?? 0.5;
    for (let s = 0; s < left.length; s++) {
      left[s] *= gain;
      if (right) right[s] *= gain;
    }
    return true;
  }
}

registerProcessor("operators", Operators);
