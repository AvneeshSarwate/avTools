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
    title: "From vibrato to timbre",
    refs: ["chowning", "sos12"],
    steps: [
      {
        title: "Speeding up a vibrato",
        body: (
          <>
            <p>Frequency modulation is the same thing as vibrato. One oscillator, called the modulator, raises and lowers the pitch of another, called the carrier. When the modulator runs at 5 Hz the result is the wobble of a singer’s voice, and the ear follows the pitch as it moves. If the modulator is made faster and nothing else is changed, there comes a point, somewhere between 20 and 30 Hz, at which the ear can no longer follow the movement, and what is heard is a steady tone of a different colour.</p>
            <p>Hold the note and drag the rate from left to right while watching the spectrum. The single peak acquires neighbours on either side, and the neighbours move further apart as the rate rises. These neighbours are called sidebands. The timbre of the tone is determined by where they lie and how strong they are, and the rest of this manual is concerned with how to place them.</p>
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
          <>Set the rate to 261.63 Hz, which is the frequency of the held C. The sidebands then fall on the whole-number ticks, because their spacing equals the frequency of the note, and the tone has a definite pitch.</>,
          <>With the rate at 110 Hz, raise the depth. The sidebands already present do not move, since their spacing depends only on the rate. What the greater depth does is to add more of them.</>,
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
            <p>Suppose the carrier has frequency <M>c</M> and the modulator frequency <M>m</M>. The output then contains a partial at <M>c</M>, and further partials at <M>c ± m</M>, <M>c ± 2m</M>, <M>c ± 3m</M> and so on. The modulator’s frequency therefore fixes the spacing of the partials. From this page onward the modulator follows the keyboard as the carrier does, and its frequency is accordingly given as a ratio to the note played.</p>
            <p>How many of these partials are strong enough to hear depends on the modulation index, written <M>I</M>, which is the greatest departure of the carrier’s frequency from its resting value divided by the modulator’s frequency. The strength of each pair of sidebands is given by a Bessel function of the index, and the orange bars show the values so calculated. For most purposes it is enough to remember that the pair of order <M>n</M> remains close to zero until the index reaches about <M>n</M>.</p>
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
          <>At ratio 1, move the index slowly from 0 to 10. The carrier, at tick 1, grows weaker, disappears when the index is near 2.4, and then returns. The total energy is the same throughout, and raising the index only moves it from one partial to another.</>,
          <>After changing the ratio, strike the key again. The two oscillators then restart together, and the measured spectrum settles on the predicted bars.</>,
        ],
      },
      {
        title: "Reflection",
        body: (
          <>
            <p>The lower sidebands lie at <M>c − m</M>, <M>c − 2m</M> and so on, and when <M>m</M> is as large as <M>c</M> some of these frequencies are negative. A sine wave of negative frequency is the same wave as one of the corresponding positive frequency with its sign reversed. Such a sideband is therefore heard at the positive frequency, and if another partial already lies there the two are added, or, where their signs differ, subtracted.</p>
            <p>Chowning regarded this as the source of the method’s usefulness: “the special richness of this FM technique lies in the fact that there are ratios of the carrier and modulating frequencies and values of the index which will produce sideband components that fall in the negative frequency domain.” It is the reason, for example, that a ratio of 1 yields every harmonic and a ratio of 2 only the odd ones, as the next lesson shows.</p>
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
            <p>The upper sidebands are at 1 + 3 = 4, and then at 7 and 10. The lower ones are at 1 − 3 = −2, which is heard at 2, and then at −5 and −8, which are heard at 5 and 8. Every harmonic is therefore present except the multiples of 3. This is the spectrum of a pulse wave whose pulse occupies a third of the cycle, and it has the same hollow sound.</p>
          ),
        },
      },
      {
        title: "A rule for bandwidth",
        body: (
          <>
            <p>The Bessel values are seldom needed in practice, because one rule answers most questions. There are about <M>I + 1</M> sidebands of appreciable strength on each side of the carrier, so that the sound occupies a band about <M>2 · m · (I + 1)</M> hertz wide. Chowning gives the same rule in the form <M>2(d + m)</M>, where <M>d</M> is the greatest departure of the frequency from its resting value.</p>
            <p>Two consequences of this rule are used repeatedly in the lessons on topology. The first is that doubling the modulator’s ratio doubles the width of the band if the index is unchanged. The second is that the width depends on the product of the ratio and the index, so that a high ratio with a low index may reach as far up the spectrum as a low ratio with a high index. The two sounds are nevertheless quite different, since the first consists of a few partials far apart and the second of many close together.</p>
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
          <>Compare ratio 1 at index 6 with ratio 4 at index 1.5. Both reach about tick 8. The first has a partial at every tick and sounds like a sawtooth, while the second has partials only at the odd ticks and sounds hollow.</>,
        ],
      },
    ],
  },
  {
    id: "ratio",
    number: "2",
    part: PART,
    title: "Harmonic and inharmonic ratios",
    refs: ["chowning", "sos13"],
    steps: [
      {
        title: "Whole-number ratios",
        body: (
          <>
            <p>When the frequencies of carrier and modulator are in the ratio of two whole numbers, every sideband is a multiple of one common fundamental, and the tone has a definite pitch. Which multiples are present depends on the ratio.</p>
            <table>
              <thead>
                <tr><th>Carrier : modulator</th><th>Partials</th><th>Resembles</th></tr>
              </thead>
              <tbody>
                <tr><td className="m">1 : 1</td><td>every harmonic</td><td>sawtooth, brass</td></tr>
                <tr><td className="m">1 : 2</td><td>odd harmonics only</td><td>square wave, clarinet</td></tr>
                <tr><td className="m">1 : 3</td><td>all but every third</td><td>narrow pulse</td></tr>
                <tr><td className="m">2 : 1</td><td>every harmonic, strongest at the 2nd</td><td>nasal reed</td></tr>
                <tr><td className="m">3 : 1</td><td>every harmonic, strongest at the 3rd</td><td>woodwind</td></tr>
              </tbody>
            </table>
            <p>In the last two rows the carrier is above the modulator. The spacing of the partials is still the modulator’s frequency, which is now the fundamental, while the carrier is the partial about which the energy is gathered. A region of the spectrum that is emphasised in this way is called a formant, and lesson 6d is devoted to it.</p>
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
          question: "The carrier is at 1 and the modulator at 2. Which harmonics will be present?",
          options: ["All of them", "Only the odd ones: 1, 3, 5, 7 …", "Only the even ones: 2, 4, 6 …", "1, 2, 4, 8 … (octaves)"],
          answer: 1,
          explain: (
            <p>The upper sidebands are at 1 + 2k, which is odd for every k. The lower ones are at −1, −3 and so on, which are heard at 1, 3 and so on, and are odd as well. A spectrum of odd harmonics alone is that of a square wave, and also that of a pipe closed at one end, of which the clarinet is the familiar example.</p>
          ),
        },
      },
      {
        title: "Ratios that are not whole numbers",
        body: (
          <>
            <p>If the modulator’s ratio is not a whole number, the sidebands are no longer multiples of a common fundamental. The ear then ceases to hear them as one note with a timbre and hears them as a group of separate tones sounding together, which is the sound of struck metal: bells, gongs and chimes. Chowning’s bell has a carrier and modulator in the ratio 1 : 1.4.</p>
            <p>The loop on this page is a progression of chords, because the difference is easiest to hear in harmony. With a whole-number ratio the chords are clear. With any other ratio they are confused, since each note contributes partials that belong to no chord.</p>
            <p className="note">On this page the index falls during each note, a matter treated in lesson 4. The clangour is consequently strongest at the beginning of the note, and what remains at the end is nearly a pure tone.</p>
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
          <>Try each of the marked ratios in turn. At 1 and 2 the chords are those of an ordinary instrument, and at 1.4, 2.76 and 3.5 they are those of a set of bells.</>,
          <>Try 1.01. A ratio very close to a whole number is still heard as harmonic, but the reflected partials fall slightly to one side of the others and beat against them. Lesson 8 makes deliberate use of this.</>,
        ],
      },
    ],
  },
  {
    id: "fm-vs-pm",
    number: "3",
    part: PART,
    title: "Frequency modulation and phase modulation",
    refs: ["sos12", "schottstaedt", "sixsines"],
    steps: [
      {
        title: "Modulating the frequency by a fixed swing",
        body: (
          <>
            <p>Until now the control has been the index, and the program has multiplied it by the modulator’s frequency to obtain the swing of the carrier in hertz. On this page that multiplication is omitted, so that the modulator swings the carrier by the same number of hertz at every pitch. This is what happens when two analogue oscillators are connected in the obvious way.</p>
            <p>Play the four octaves. The lowest note is harsh and the highest is almost a sine wave. The reason is that the index is the swing divided by the modulator’s frequency, and each octave doubles that frequency, so that with a fixed swing each octave halves the index. Reid states the general rule: the index is proportional to the modulator’s amplitude and inversely proportional to its frequency.</p>
          </>
        ),
        source: { kind: "native", params: native({ ratio: 1, deviationHz: 500 }) },
        controls: [{ label: "Frequency swing", path: "deviationHz", min: 0, max: 2000, unit: "Hz" }],
        clip: octaves,
        maxRatio: 20,
      },
      {
        title: "Modulating the phase",
        body: (
          <>
            <p>The instruments made by Yamaha, and Six Sines also, leave the carrier’s frequency alone and add the modulator to its phase. An index of <M>I</M> then means that the phase is advanced and retarded by <M>I</M> radians, which distorts the wave to the same degree at every pitch. The spectrum of a note, measured in multiples of its fundamental, is therefore the same whatever key is played.</p>
            <p>The two methods are closely related. Schottstaedt states the relation in one sentence, “To go from FM to PM, integrate the FM modulating signal”, and when the modulator is a sine wave the output of one cannot be distinguished from that of the other. Phase modulation is preferred for two practical reasons. The index does not depend on the pitch, as has just been said. And if the modulator contains a constant offset, the effect in phase modulation is a constant shift of phase, which cannot be heard, whereas in frequency modulation it is a change of pitch.</p>
            <p>The remaining lessons use the worklet of which the central part is printed below. An operator may be acted on by another in any of three ways, after which its sine is computed.</p>
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
        title: "The units of Six Sines",
        body: (
          <>
            <p>Most of the benches from here on have a switch marked <M>Raw / Six Sines</M>, which sends the same patch to the Six Sines engine after translating it into that engine’s parameters and shows the Six Sines editor. To read a Six Sines preset the following conversions are needed. They are taken from the source code of the fork.</p>
            <table>
              <thead>
                <tr><th>Six Sines control</th><th>Value</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                <tr><td>Matrix cell depth</td><td className="m">1.0</td><td>an index of 4π, about 12.6 rad, which is two full cycles of phase</td></tr>
                <tr><td>Matrix cell overdrive</td><td className="m">on</td><td>ten times that</td></tr>
                <tr><td>Feedback level</td><td className="m">1.0</td><td>π/2, about 1.57 rad, applied to the mean of the last two samples</td></tr>
                <tr><td>Source ratio</td><td className="m">knob v</td><td>a ratio of 2<sup>v</sup></td></tr>
              </tbody>
            </table>
            <p>A preset whose matrix depth is 0.08 therefore has an index of about 1, and one whose depth is 0.25 an index of about 3. The matrix allows an operator to modulate only those numbered after it, so that operator 2 may modulate operators 3 to 6 but not operator 1. Nearly every arrangement of operators found on a DX-style instrument can be made within this restriction, the exceptions being those in which a feedback path passes through more than one operator.</p>
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
        tryThis: [          <>Change engines without moving the sliders. The two spectra should agree.</>,],
      },
    ],
  },
  {
    id: "index-envelopes",
    number: "4",
    part: PART,
    title: "Changing the index during a note",
    refs: ["chowning", "yamaha6"],
    steps: [
      {
        title: "A falling index",
        body: (
          <>
            <p>A fixed index gives a fixed spectrum, and a tone whose spectrum never changes is heard as the output of a machine. In an instrument the spectrum changes during every note, and in frequency modulation this is achieved by changing the index. Chowning made it the premise of his paper: “the character of the temporal evolution of the spectral components is of critical importance in the determination of timbre.”</p>
            <p>On this page the index begins high and falls. As it falls the outer partials disappear first, exactly as they would if a low-pass filter were being closed, although no filter is present. The change is described by three quantities: the value from which the index starts, the time it takes to fall, and the value at which it comes to rest.</p>
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
          <>With the sustain at 0, a decay of 0.05 s gives a click followed by a sine wave, a decay of 0.35 s gives a plucked sound, and a decay of 3 s gives the sound of a filter closing slowly.</>,
          <>Set the attack to 0.4 s and the sustain to 1. The tone now grows brighter after it has begun, which is how a brass note behaves, and is the basis of recipe 9.1.</>,
        ],
      },
      {
        title: "Velocity and register",
        body: (
          <>
            <p>An instrument played harder is brighter as well as louder, and at the top of its range it has fewer audible overtones than at the bottom. In frequency modulation both effects are obtained by scaling the index.</p>
            <p>The first is obtained by letting the velocity of the key reduce the index for soft notes. The loop repeats one note at velocities that rise and then fall. When the amount is zero the notes differ only in loudness, and when it is raised they differ in brightness also. This is usually the first mapping to set up in a patch, because so much of the impression of a played instrument depends on it.</p>
            <p>The second is obtained by reducing the index as the pitch rises, which is called key scaling. The need for it follows from the rule for bandwidth. The band extends about <M>m · (I + 1)</M> on each side of the carrier, and <M>m</M> doubles with each octave, so that an index which sounds right in the middle of the keyboard gives too narrow a band at the bottom and too wide a one at the top. At a sufficiently high pitch the upper partials pass half the sample rate and are reproduced at the wrong frequencies. Yamaha’s guide makes the same adjustment, reducing the level of the feedback and of the modulators above a chosen key.</p>
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
          <>Use the keyboard column to play the patch two octaves below the loop and two octaves above it, first with the key scaling at 0 and then at 0.7.</>,
        ],
      },
    ],
  },
  {
    id: "feedback",
    number: "5",
    part: PART,
    title: "Feedback",
    refs: ["schottstaedt", "sos13", "manny"],
    steps: [
      {
        title: "A sine that modulates itself",
        body: (
          <>
            <p>An operator’s output may be added to its own phase. Since it then modulates itself, the ratio of modulator to carrier is necessarily 1, and every sideband is a harmonic. As the amount of feedback is increased the sine wave leans forward until it resembles a sawtooth. Schottstaedt describes the result as “a much broader, flatter spectrum” than that of an ordinary pair, in which the harmonics diminish in proportion to their number.</p>
            <p>The amount cannot be increased indefinitely. Tomisawa, who devised the method, recommended values between 0 and 1.5, and Schottstaedt’s advice is to “keep the index below 1.0”. Above these values the falling edge of the wave becomes unstable and the tone turns to noise. The feedback knob of Six Sines reaches π/2, or about 1.57, which is at the limit of Tomisawa’s range, and its overdrive switch multiplies this by ten.</p>
          </>
        ),
        source: { kind: "operators", patch: { ops: [op(1, 0.8, { feedback: 0.8, amp: env(0.005, 0, 1, 0.2) })], edges: [] } },
        controls: [{ label: "Feedback", path: "ops.0.feedback", min: 0, max: 4, step: 0.01, unit: "rad", marks: [0, 0.8, 1.2, 1.57, 3] }],
        clip: phrase,
        maxRatio: 32,
        tryThis: [
          <>Watch the waveform as the feedback goes from 0 to 1.2. Then raise it to 3 and watch the falling edge.</>,
          <>With the feedback at 1.57, hold a low note and then a high one. The high note turns to noise first, probably because it has fewer samples in each cycle.</>,
        ],
      },
      {
        title: "A feedback operator as modulator",
        body: (
          <>
            <p>The chief use of an operator with feedback is as a modulator. A sine-wave modulator gives the carrier one family of sidebands. A modulator with feedback already contains several harmonics, each of which acts on the carrier as a modulator in its own right, so that the carrier’s spectrum is filled much more densely. One operator thus does the work for which two or three would otherwise be placed in series, an arrangement examined in lesson 6b.</p>
            <p>Instruments with only four operators obtain their fuller bass sounds in this way. Yamaha’s tutorial on bass sounds puts feedback on nearly every operator, and observes that feedback of the sawtooth type adds all the harmonics while that of the square type adds only the odd ones. In Six Sines a negative feedback level gives a result of the second kind, because the signal fed back is then squared, which doubles its frequency and so makes the operator modulate itself at a ratio of 2.</p>
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
            "It gets duller, because the feedback takes energy from the modulator",
            "It turns inharmonic",
          ],
          answer: 1,
          explain: (
            <p>The rule for bandwidth applies separately to each harmonic of the modulator. Its fourth harmonic, for instance, acts as a modulator of ratio 4, and at a given index reaches four times as far as the fundamental does. Since every component is a whole multiple of the note, the result remains harmonic.</p>
          ),
        },
      },
    ],
  },
];
