import type { NativeFmParams } from "../audio/engine";
import { edge, env, op, type Patch } from "../audio/patch";
import { simplePair } from "../viz/bessel";
import { chords, held, octaves, phrase, velocityRamp } from "./clips";
import type { Lesson } from "./types";

const PART = "A · Foundations";
const M = ({ children }: { children: React.ReactNode }) => <span className="m">{children}</span>;

const native = (over: Partial<NativeFmParams>): NativeFmParams => ({
  ratio: 1, index: 1, indexDecay: 0, indexSustain: 1, attack: 0.01, release: 0.2, ...over,
});

const NATIVE_CODE = `const carrier   = new OscillatorNode(ctx, { frequency: f0 });
const modulator = new OscillatorNode(ctx, { frequency: f0 * ratio });
const deviation = new GainNode(ctx, { gain: index * f0 * ratio });   // hertz

modulator.connect(deviation).connect(carrier.frequency);   // this line is FM
carrier.connect(amp).connect(ctx.destination);`;

const pairPrediction = (state: unknown) => {
  const p = state as NativeFmParams;
  return simplePair(1, p.ratio, p.index);
};

const pmPair = (ratio: number, index: number, extra: Partial<Patch["edges"][0]> = {}): Patch => ({
  ops: [op(ratio, 0, { label: "modulator" }), op(1, 0.8, { label: "carrier", amp: env(0.005, 0, 1, 0.25) })],
  edges: [edge(0, 1, index, extra)],
});

export const partA: Lesson[] = [
  {
    id: "vibrato",
    number: "0",
    part: PART,
    title: "Vibrato that got too fast",
    refs: ["chowning", "sos12"],
    steps: [
      {
        title: "From wobble to timbre",
        body: (
          <>
            <p>
              Frequency modulation is vibrato. One oscillator, the <em>modulator</em>, pushes the pitch of another, the{" "}
              <em>carrier</em>, up and down. At 5 Hz you hear a singer’s wobble. Nothing about the circuit changes as you
              speed it up, but somewhere around 20 to 30 Hz your ear stops following the pitch movement and starts
              hearing a single steady tone with a new colour.
            </p>
            <p>
              Hold the note and drag the rate from left to right. Watch the spectrum while you do it: the single peak
              grows neighbours, and the neighbours spread apart as the rate rises. Those neighbours are{" "}
              <em>sidebands</em>, and the rest of this manual is about placing them where you want them.
            </p>
          </>
        ),
        source: { kind: "native", params: native({ modHz: 5, deviationHz: 40 }) },
        controls: [
          { label: "Modulator rate", path: "modHz", min: 1, max: 1000, log: true, unit: "Hz", marks: [5, 30, 110, 261.63] },
          { label: "Depth (pitch swing)", path: "deviationHz", min: 0, max: 400, unit: "Hz" },
        ],
        clip: held(60, 8),
        maxRatio: 8,
        code: NATIVE_CODE,
        tryThis: [
          <>Set the rate to exactly 261.63 Hz, the frequency of the held C. The neighbours land on whole-number ticks: the tone becomes harmonic.</>,
          <>At a rate of 110 Hz, raise the depth. More depth does not move the sidebands. It adds more of them.</>,
        ],
      },
    ],
  },
  {
    id: "sidebands",
    number: "1",
    part: PART,
    title: "Sidebands and the index",
    refs: ["chowning", "schottstaedt", "sos12"],
    steps: [
      {
        title: "Where the partials sit",
        body: (
          <>
            <p>
              With a carrier at frequency <M>c</M> and a modulator at <M>m</M>, the output contains partials at{" "}
              <M>c</M>, <M>c ± m</M>, <M>c ± 2m</M>, <M>c ± 3m</M> and so on. The modulator’s frequency sets the{" "}
              <em>spacing</em>. From here on the modulator follows the keyboard, so we describe it as a ratio to the
              played note.
            </p>
            <p>
              How many of those partials are audible is set by the <em>modulation index</em>, written <M>I</M>: the peak
              frequency swing divided by the modulator frequency. The orange bars are the theoretical heights. Each
              pair of sidebands follows a Bessel function of the index, and the practical summary is Schottstaedt’s:
              a sideband of order <M>n</M> stays close to zero until the index reaches <M>n</M>.
            </p>
          </>
        ),
        source: { kind: "native", params: native({ ratio: 1, index: 1 }) },
        controls: [
          { label: "Index", path: "index", min: 0, max: 10, step: 0.05 },
          { label: "Modulator ratio", path: "ratio", min: 0.25, max: 8, step: 0.01, marks: [0.5, 1, 2, 3, 4] },
        ],
        clip: held(55, 8),
        maxRatio: 16,
        predicted: pairPrediction,
        code: NATIVE_CODE,
        tryThis: [
          <>Sweep the index slowly from 0 to 10 at ratio 1. The carrier (tick 1) fades, vanishes near 2.4, and comes back. Energy is conserved: it only moves between partials.</>,
          <>Re-strike a key after moving the ratio. The two oscillators restart in step, and the measured trace settles onto the orange prediction.</>,
        ],
      },
      {
        title: "Reflection",
        body: (
          <>
            <p>
              The lower sidebands march downward: <M>c − m</M>, <M>c − 2m</M>… and soon go below zero. A negative
              frequency is not silent. It is the same sine wave running backwards, which is the same sine with its
              sign flipped, so it folds back into the positive range. If it lands on a partial that is already there
              the two add or cancel. Chowning puts the whole value of the technique here: “the special richness of this FM
              technique lies in the fact that there are ratios of the carrier and modulating frequencies and values of
              the index which will produce sideband components that fall in the negative frequency domain.” It is why
              a ratio of 1 gives every harmonic and a ratio of 2 gives only the odd ones.
            </p>
          </>
        ),
        source: { kind: "native", params: native({ ratio: 3, index: 2.5 }) },
        controls: [
          { label: "Index", path: "index", min: 0, max: 10, step: 0.05 },
          { label: "Modulator ratio", path: "ratio", min: 0.25, max: 8, step: 0.01, marks: [1, 2, 3, 4] },
        ],
        clip: held(55, 8),
        predicted: pairPrediction,
        predict: {
          question: "The carrier is at 1 and the modulator at 3 times the note. Which ticks get a partial?",
          options: [
            "1, 4, 7, 10 … only",
            "1, 2, 4, 5, 7, 8, 10 … (every tick except multiples of 3)",
            "3, 6, 9, 12 … (multiples of the modulator)",
            "Every tick",
          ],
          answer: 1,
          explain: (
            <p>
              Upper sidebands: 1 + 3 = 4, then 7, 10. Lower sidebands: 1 − 3 = −2, which reflects to 2; then −5 → 5,
              −8 → 8. So every harmonic is present except the multiples of 3. That missing-every-third pattern is the
              hollow sound of a narrow pulse wave.
            </p>
          ),
        },
      },
      {
        title: "A rule for bandwidth",
        body: (
          <>
            <p>
              You rarely need the Bessel values. One rule covers most decisions: there are about <M>I + 1</M>{" "}
              significant sidebands on each side of the carrier, so the sound occupies roughly{" "}
              <M>2 · m · (I + 1)</M> hertz. Chowning writes the same thing as <M>2(d + m)</M>, with <M>d</M> the peak
              frequency swing.
            </p>
            <p>
              Two consequences follow, and both will come back in the topology lessons. Doubling the modulator ratio
              doubles the bandwidth at the same index. And brightness is the product of ratio and index, so a high
              ratio with a low index and a low ratio with a high index can be equally bright while sounding nothing
              alike: one is a few widely spaced partials, the other is many close ones.
            </p>
          </>
        ),
        source: { kind: "native", params: native({ ratio: 1, index: 6 }) },
        controls: [
          { label: "Index", path: "index", min: 0, max: 10, step: 0.05, marks: [1.5, 6] },
          { label: "Modulator ratio", path: "ratio", min: 0.25, max: 8, step: 0.01, marks: [1, 4] },
        ],
        clip: held(48, 8),
        maxRatio: 24,
        predicted: pairPrediction,
        tryThis: [
          <>Compare ratio 1 at index 6 with ratio 4 at index 1.5. Both reach about tick 8. The first is buzzy and saw-like; the second is hollow and glassy.</>,
        ],
      },
    ],
  },
  {
    id: "ratio",
    number: "2",
    part: PART,
    title: "Ratio: harmonic or not",
    refs: ["chowning", "sos13"],
    steps: [
      {
        title: "Whole-number ratios",
        body: (
          <>
            <p>
              When carrier and modulator are in a whole-number ratio, every sideband lands on a multiple of some common
              fundamental and the tone has a clear pitch. The ratio decides <em>which</em> harmonics you get:
            </p>
            <table>
              <thead>
                <tr><th>Carrier : modulator</th><th>Partials</th><th>Reads as</th></tr>
              </thead>
              <tbody>
                <tr><td className="m">1 : 1</td><td>every harmonic</td><td>saw, brass</td></tr>
                <tr><td className="m">1 : 2</td><td>odd harmonics only</td><td>square, clarinet</td></tr>
                <tr><td className="m">1 : 3</td><td>all but every third</td><td>narrow pulse</td></tr>
                <tr><td className="m">2 : 1</td><td>every harmonic, strongest at the 2nd</td><td>nasal, reedy</td></tr>
                <tr><td className="m">3 : 1</td><td>every harmonic, strongest at the 3rd</td><td>woodwind</td></tr>
              </tbody>
            </table>
            <p>
              The last two rows put the carrier <em>above</em> the modulator. The spacing is still the modulator
              frequency, which is now the fundamental, and the carrier marks where the energy is centred. That is a
              first glimpse of a formant: a fixed bump in the spectrum.
            </p>
          </>
        ),
        source: { kind: "operators", patch: pmPair(2, 2) },
        controls: [
          { label: "Carrier ratio", path: "ops.1.ratio", min: 1, max: 6, step: 1, marks: [1, 2, 3, 5] },
          { label: "Modulator ratio", path: "ops.0.ratio", min: 0.5, max: 6, step: 0.5, marks: [1, 2, 3] },
          { label: "Index", path: "edges.0.index", min: 0, max: 8, step: 0.05, unit: "rad" },
        ],
        clip: phrase,
        predicted: (state) => {
          const p = state as Patch;
          return simplePair(p.ops[1].ratio, p.ops[0].ratio, p.edges[0].index);
        },
        predict: {
          question: "Carrier at 1, modulator at 2. Which harmonics will be present?",
          options: ["All of them", "Only the odd ones: 1, 3, 5, 7 …", "Only the even ones: 2, 4, 6 …", "1, 2, 4, 8 … (octaves)"],
          answer: 1,
          explain: (
            <p>
              1 + 2k is always odd, and the reflected ones (1 − 2 = −1 → 1, −3 → 3) are odd too. Odd harmonics only is
              the signature of a square wave and of a closed pipe such as a clarinet.
            </p>
          ),
        },
      },
      {
        title: "Ratios that are not whole numbers",
        body: (
          <>
            <p>
              Move the modulator off a whole number and the sidebands no longer share a fundamental. The ear stops
              fusing them into one pitch and hears the cluster of separate tones that we associate with struck metal:
              bells, gongs, chimes. Chowning’s bell uses a carrier-to-modulator ratio of 1 : 1.4.
            </p>
            <p>
              The loop here is a chord progression on purpose. Harmonic ratios keep the chords clean. Inharmonic ones
              smear them, because every note brings partials that belong to no key.
            </p>
            <p className="note">
              In this step the index also decays over time. Lesson 4 is about that; for now notice that the clangour is
              in the attack and the note settles toward a pure tone.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1.4, 0, { label: "modulator" }), op(1, 0.8, { label: "carrier", amp: env(0.002, 3, 0, 1.5) })],
            edges: [edge(0, 1, 5, { env: env(0, 2.5, 0, 1.5) })],
          },
        },
        controls: [
          { label: "Modulator ratio", path: "ops.0.ratio", min: 0.5, max: 8, step: 0.01, marks: [1, 1.4, 2, 2.76, 3.5, 7.07] },
          { label: "Peak index", path: "edges.0.index", min: 0, max: 12, step: 0.1, unit: "rad" },
        ],
        clip: chords,
        maxRatio: 20,
        tryThis: [
          <>Step through the marks. 1 and 2 are instruments; 1.4, 2.76 and 3.5 are metal.</>,
          <>Try 1.01. A ratio a hair off a whole number is still heard as harmonic, but it beats. Lesson 8 uses that on purpose.</>,
        ],
      },
    ],
  },
  {
    id: "fm-vs-pm",
    number: "3",
    part: PART,
    title: "FM, PM, and what Six Sines really does",
    refs: ["sos12", "schottstaedt", "sixsines"],
    steps: [
      {
        title: "The problem with literal FM",
        body: (
          <>
            <p>
              So far the depth control has been an <em>index</em>, and the code has quietly multiplied it by the
              modulator frequency to get a swing in hertz. Here that compensation is removed: the modulator swings the
              carrier by a fixed number of hertz, whatever the pitch. This is what you get if you patch two analogue
              oscillators together.
            </p>
            <p>
              Play the four octaves. The low note is harsh and the top note is nearly a sine. The index is the swing
              divided by the modulator frequency, so each octave up halves it. Reid’s summary is that the index is proportional to the modulator’s amplitude and inversely proportional to its frequency.
            </p>
          </>
        ),
        source: { kind: "native", params: native({ ratio: 1, deviationHz: 500 }) },
        controls: [{ label: "Frequency swing", path: "deviationHz", min: 0, max: 2000, unit: "Hz" }],
        clip: octaves,
        maxRatio: 20,
      },
      {
        title: "Modulate the phase instead",
        body: (
          <>
            <p>
              Yamaha’s instruments, and Six Sines, do not touch the frequency at all. The modulator is added to the
              carrier’s <em>phase</em>. An index of <M>I</M> then means “swing the phase by <M>I</M> radians”, and that
              is the same amount of bending at every pitch. The spectrum of a note no longer depends on the key you
              play.
            </p>
            <p>
              The two are the same family: Schottstaedt’s one-line summary is “To go from FM to PM, integrate the FM modulating signal”, and for sine waves you cannot tell from the output which one was used. Phase
              modulation wins on practical grounds. The index is pitch-independent, and a modulator with any DC offset
              shifts the phase by a constant, which is inaudible, where in FM it would detune the note.
            </p>
            <p>
              This is the worklet the rest of the manual runs on. The excerpt below is the whole of it: three ways an
              operator can be bent by another, then one <M>sin()</M>.
            </p>
          </>
        ),
        source: { kind: "operators", patch: pmPair(1, 3) },
        controls: [
          { label: "Index", path: "edges.0.index", min: 0, max: 10, step: 0.05, unit: "rad" },
          { label: "Modulator ratio", path: "ops.0.ratio", min: 0.5, max: 8, step: 0.5 },
        ],
        clip: octaves,
        maxRatio: 20,
        predicted: (state) => {
          const p = state as Patch;
          return simplePair(1, p.ops[0].ratio, p.edges[0].index);
        },
        code: `for (const e of edges) if (e.to === i) {
  const depth = e.index * envelope(e.env);
  const mod   = out[e.from];
  if      (e.mode === "fm") freqOffset  += depth * mod;          // hertz
  else if (e.mode === "rm") ring        *= 1 + depth * (mod - 1); // amplitude
  else                      phaseOffset += depth * mod;          // radians
}
phaseOffset += op.feedback * 0.5 * (out[i] + prev[i]);

phase[i] += 2 * Math.PI * (freq + freqOffset) / sampleRate;
out[i]    = Math.sin(phase[i] + phaseOffset) * ring;`,
      },
      {
        title: "Reading Six Sines’ knobs",
        body: (
          <>
            <p>
              From here on most benches have a <M>Raw / Six Sines</M> switch. It sends the same patch to the Six Sines
              engine, translated into its parameters. Three conversions are worth knowing, all read from the fork’s
              source:
            </p>
            <table>
              <thead>
                <tr><th>Six Sines control</th><th>Value</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                <tr><td>Matrix cell depth</td><td className="m">1.0</td><td>index of 4π ≈ 12.6 rad (two full cycles of phase)</td></tr>
                <tr><td>Matrix cell overdrive</td><td className="m">on</td><td>that, times 10</td></tr>
                <tr><td>Feedback level</td><td className="m">1.0</td><td>π/2 ≈ 1.57 rad, applied to the mean of the last two samples</td></tr>
                <tr><td>Source ratio</td><td className="m">knob v</td><td>ratio of 2<sup>v</sup></td></tr>
              </tbody>
            </table>
            <p>
              So a preset whose matrix depth reads 0.08 has an index of 1, and one that reads 0.25 is at about 3. The
              matrix is feed-forward only: operator 2 can modulate operators 3 to 6 but never operator 1. Every DX-style
              algorithm is a subset of that triangle.
            </p>
          </>
        ),
        source: { kind: "operators", patch: pmPair(1, 3), engine: "six" },
        controls: [
          { label: "Index", path: "edges.0.index", min: 0, max: 12.5, step: 0.05, unit: "rad" },
          { label: "Modulator ratio", path: "ops.0.ratio", min: 0.5, max: 8, step: 0.5 },
        ],
        clip: octaves,
        maxRatio: 20,
        predicted: (state) => {
          const p = state as Patch;
          return simplePair(1, p.ops[0].ratio, p.edges[0].index);
        },
        tryThis: [<>Flip between the two engines at the same settings. The spectra should agree bar for bar.</>],
      },
    ],
  },
  {
    id: "index-envelopes",
    number: "4",
    part: PART,
    title: "The index envelope is the timbre",
    refs: ["chowning", "yamaha6"],
    steps: [
      {
        title: "A filter sweep without a filter",
        body: (
          <>
            <p>
              A static index gives a static spectrum, and static spectra sound like test equipment. Almost everything
              that makes an FM patch sound like an instrument is the index <em>moving</em>. Chowning’s paper is built
              on this: “the character of the temporal evolution of the spectral components is of critical importance
              in the determination of timbre.”
            </p>
            <p>
              Here the index starts high and decays. The partials collapse toward the carrier exactly as they would
              under a closing low-pass filter, but there is no filter. Three numbers shape it: where the index starts,
              how fast it falls, and where it settles.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1, 0, { label: "modulator" }), op(1, 0.8, { label: "carrier", amp: env(0.003, 1.2, 0.4, 0.3) })],
            edges: [edge(0, 1, 6, { env: env(0, 0.35, 0.15, 0.3) })],
          },
        },
        controls: [
          { label: "Peak index", path: "edges.0.index", min: 0, max: 12, step: 0.1, unit: "rad" },
          { label: "Index decay", path: "edges.0.env.d", min: 0.02, max: 4, log: true, unit: "s" },
          { label: "Index sustain", path: "edges.0.env.s", min: 0, max: 1, step: 0.01 },
          { label: "Index attack", path: "edges.0.env.a", min: 0, max: 1.5, step: 0.01, unit: "s" },
        ],
        clip: phrase,
        tryThis: [
          <>Decay 0.05 s, sustain 0: a click on a sine. Decay 0.35 s: a pluck. Decay 3 s: a slow filter close.</>,
          <>Set the attack to 0.4 s and the sustain to 1. The tone opens up after it starts, which is the brass gesture of lesson 9.</>,
        ],
      },
      {
        title: "Velocity and register",
        body: (
          <>
            <p>
              Real instruments get brighter when played harder, and they have fewer audible overtones at the top of
              their range. In FM both are scalings of the index.
            </p>
            <p>
              <strong>Velocity to index</strong> is the single most effective expressive mapping in FM. The loop
              repeats one note at rising and falling velocity; with the amount at zero only the loudness changes.
            </p>
            <p>
              <strong>Key scaling</strong> reduces the index as the pitch rises. Bandwidth is about{" "}
              <M>m · (I + 1)</M>, and <M>m</M> doubles every octave, so a fixed index sounds thin at the bottom and
              shrill at the top, and eventually runs past the sample-rate limit and aliases. Yamaha’s guide scales
              both feedback and modulator level down above a break point for the same reason.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1, 0, { label: "modulator" }), op(1, 0.8, { label: "carrier", amp: env(0.003, 0.9, 0.3, 0.25) })],
            edges: [edge(0, 1, 7, { env: env(0, 0.3, 0.2, 0.25), velocity: 0.8, keyScale: 0 })],
          },
        },
        controls: [
          { label: "Velocity → index", path: "edges.0.velocity", min: 0, max: 1, step: 0.01 },
          { label: "Key scaling", path: "edges.0.keyScale", min: 0, max: 1, step: 0.01, unit: "oct/oct" },
          { label: "Peak index", path: "edges.0.index", min: 0, max: 12, step: 0.1, unit: "rad" },
        ],
        clip: velocityRamp(57),
        tryThis: [
          <>Use the keyboard column to play the same patch at C2 and C6 with key scaling at 0, then at 0.7.</>,
        ],
      },
    ],
  },
  {
    id: "feedback",
    number: "5",
    part: PART,
    title: "Feedback: one operator, many harmonics",
    refs: ["schottstaedt", "sos13", "manny"],
    steps: [
      {
        title: "A sine that modulates itself",
        body: (
          <>
            <p>
              Route an operator’s output back into its own phase. Because it modulates itself, the ratio is always
              1 : 1 and every sideband lands on a harmonic. As the amount rises the sine leans over into a sawtooth:
              Schottstaedt describes the result as “a much broader, flatter spectrum” whose harmonics fall off as 1/n.
            </p>
            <p>
              There is a ceiling. Tomisawa, who designed the scheme, recommends staying between 0 and 1.5, and
              Schottstaedt’s advice is blunter: “keep the index below 1.0”. Past that the waveform develops a zig-zag
              instability on its falling edge and the tone breaks into noise. Six Sines’ feedback knob tops out at
              π/2 ≈ 1.57, right at the edge. Its overdrive switch goes ten times further.
            </p>
          </>
        ),
        source: { kind: "operators", patch: { ops: [op(1, 0.8, { feedback: 0.8, amp: env(0.005, 0, 1, 0.2) })], edges: [] } },
        controls: [{ label: "Feedback", path: "ops.0.feedback", min: 0, max: 4, step: 0.01, unit: "rad", marks: [0, 0.8, 1.2, 1.57, 3] }],
        clip: phrase,
        maxRatio: 32,
        tryThis: [
          <>Watch the scope between 0 and 1.2: sine to saw. Then push to 3 and watch the falling edge shatter.</>,
          <>Hold a low note at 1.57 and a high one. The high one breaks up first; there are fewer samples per cycle to keep the loop stable.</>,
        ],
      },
      {
        title: "Feedback as a cheap modulator stack",
        body: (
          <>
            <p>
              A feedback operator is most useful as a <em>modulator</em>. A plain sine modulator gives the carrier one
              family of sidebands. A saw-like modulator already contains many harmonics, and each one acts as its own
              modulator, so the carrier’s spectrum fills in densely. You get the richness of a two- or three-deep
              stack of operators for the price of one.
            </p>
            <p>
              This is how four-operator synths get big basses. Yamaha’s bass tutorial puts feedback on nearly every
              operator and notes that its saw-type feedback adds all the integer overtones while a square type adds only the odd ones. In Six Sines a negative feedback level gives the squarer flavour.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { feedback: 0, label: "modulator" }),
              op(1, 0.8, { label: "carrier", amp: env(0.004, 0.8, 0.5, 0.2) }),
            ],
            edges: [edge(0, 1, 2, { env: env(0, 0.4, 0.4, 0.2) })],
          },
        },
        controls: [
          { label: "Modulator feedback", path: "ops.0.feedback", min: 0, max: 1.57, step: 0.01, unit: "rad" },
          { label: "Index into carrier", path: "edges.0.index", min: 0, max: 8, step: 0.05, unit: "rad" },
        ],
        clip: phrase,
        maxRatio: 32,
        predict: {
          question: "The index into the carrier stays at 2. What happens to the spectrum as the modulator’s feedback goes from 0 to 1.5?",
          options: [
            "Nothing: the index into the carrier has not changed",
            "It gets brighter, with partials well beyond tick 3",
            "It gets duller, because feedback steals energy",
            "It turns inharmonic",
          ],
          answer: 1,
          explain: (
            <p>
              The bandwidth rule <M>m · (I + 1)</M> applies to each harmonic of the modulator separately. Its 4th
              harmonic acts like a modulator at ratio 4, reaching four times as far. Everything stays harmonic because
              every component is a whole multiple of the note.
            </p>
          ),
        },
      },
    ],
  },
];
