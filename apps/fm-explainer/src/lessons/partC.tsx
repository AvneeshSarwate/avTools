import { edge, env, op } from "../audio/patch";
import { SOURCE, WAVEFORMS } from "../audio/sixSinesMap";
import { bellTune, chords, held, melody, padChords, phrase } from "./clips";
import type { Lesson } from "./types";

const PART = "C · Beyond plain PM";
const M = ({ children }: { children: React.ReactNode }) => <span className="m">{children}</span>;
const body = env(0.004, 1.2, 0.5, 0.3);

export const partC: Lesson[] = [
  {
    id: "modes",
    number: "7",
    part: PART,
    title: "Ring modulation and other waveforms",
    refs: ["sixsines", "sos12"],
    steps: [
      {
        title: "Ring modulation",
        body: (
          <>
            <p>Each cell of the Six Sines matrix can be set to act in other ways than by phase modulation. The most useful of these is ring modulation, in which the modulator multiplies the carrier’s amplitude. The product of two sine waves consists of exactly two partials, one at the sum of their frequencies and one at the difference, and no others appear however great the depth.</p>
            <p>Ring modulation is therefore suited to adding particular partials, where phase modulation fills a region. A carrier at ratio 10, ring-modulated by an operator at ratio 1, acquires partials at 9 and 11 and nothing else. The same two operators under phase modulation would spread a family of partials about tick 10.</p>
            <p>If the modulator’s ratio is not a whole number, the two new partials are no longer harmonics of the note. There are still only two of them, however, and they lie at equal distances above and below the carrier, so that the change is heard as the retuning of two tones and not as a change of timbre. Phase modulation at such a ratio displaces a great many partials at once, and it is this that destroys the sense of a single pitch.</p>
            <p className="note">Six Sines mixes the unmodulated carrier with the product according to the depth: the output is the carrier multiplied by 1 + depth × (modulator − 1). At a depth of 1 the carrier itself is absent and only the two new partials remain.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1), op(10, 0.8, { amp: body })],
            edges: [edge(0, 1, 0.7, { mode: "rm" })],
          },
        },
        controls: [
          { label: "Ring depth", path: "edges.0.index", min: 0, max: 1, step: 0.01 },
          { label: "Carrier ratio", path: "ops.1.ratio", min: 1, max: 14, step: 1 },
          { label: "Modulator ratio", path: "ops.0.ratio", min: 0.5, max: 6, step: 0.01, marks: [1, 1.3, 2, 2.76] },
        ],
        clip: held(48, 8),
        maxRatio: 20,
        tryThis: [
          <>Set the modulator’s ratio to 1.3 and then to 2.76. The two new partials move away from the ticks, but the carrier stays at 10 and the tone keeps its pitch.</>,
        ],
        predict: {
          question: "The carrier is at 10 and is ring-modulated by an operator at 1, with a depth of 0.7. How many partials are there?",
          options: ["One, at 10", "Three, at 9, 10 and 11", "A family spreading out from 10, as with phase modulation", "Two, at 1 and 10"],
          answer: 1,
          explain: (
            <p>The two new partials are at the sum and the difference, and what is left of the carrier makes the third. A greater depth alters the balance among the three and never adds a fourth. The next step has the same two operators under phase modulation, for comparison.</p>
          ),
        },
      },
      {
        title: "The same pair under phase modulation",
        body: (
          <>
            <p>The operators here are those of the preceding step, a carrier at ratio 10 and a modulator at ratio 1, but the cell is set to phase modulation where before it was set to ring modulation. Raise the index and count the partials. Ring modulation is the method to choose when one particular pair of partials is to be added, for example a faint high pair above a bell, and phase modulation when a region is to be filled. The factory preset “Nostalgic Bell Synth” in Part E applies both from one modulator.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: { ops: [op(1), op(10, 0.8, { amp: body })], edges: [edge(0, 1, 1.5)] },
        },
        controls: [
          { label: "Index", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Carrier ratio", path: "ops.1.ratio", min: 1, max: 14, step: 1 },
        ],
        clip: held(48, 8),
        maxRatio: 20,
      },
      {
        title: "Ring modulation of a tone with harmonics",
        body: (
          <>
            <p>The result is different when the carrier has harmonics of its own. Ring modulation then gives a sum and a difference for every harmonic of the carrier, so that a carrier with ten audible harmonics acquires twenty new partials. If the modulator’s ratio is a whole number, these fall on harmonics of the note. If it is not, every one of them is inharmonic, and the tone is that of a bell or a gong, which is the sound for which the ring modulator is best known.</p>
            <p>On this page the carrier is at the pitch of the note and has feedback, which gives it harmonics that diminish in proportion to their number, as in lesson 5. The modulator is a sine wave at a ratio of 1.4. The harmonic of the carrier at <M>k</M> therefore produces partials at <M>k + 1.4</M> and <M>k − 1.4</M>, and where the second of these is negative it is reflected, as in lesson 1. The modulator can be given feedback as well, in which case each of its harmonics acts in the same way, and the partials become too many to follow.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1.4, 0, { feedback: 0, label: "modulator" }),
              op(1, 0.8, { feedback: 1, label: "carrier", amp: env(0.002, 3, 0, 1.2) }),
            ],
            edges: [edge(0, 1, 0.8, { mode: "rm" })],
          },
        },
        controls: [
          { label: "Modulator ratio", path: "ops.0.ratio", min: 0.5, max: 6, step: 0.01, marks: [1, 1.4, 2, 2.76, 3.5] },
          { label: "Ring depth", path: "edges.0.index", min: 0, max: 1, step: 0.01 },
          { label: "Carrier feedback", path: "ops.1.feedback", min: 0, max: 1.5, step: 0.01, unit: "rad" },
          { label: "Modulator feedback", path: "ops.0.feedback", min: 0, max: 1.5, step: 0.01, unit: "rad" },
        ],
        clip: bellTune,
        maxRatio: 10,
        tryThis: [
          <>Set the modulator’s ratio to 1 and then to 2. All the partials are then harmonics of the note, and the result is an ordinary bright tone.</>,
          <>Set the carrier’s feedback to 0. Only three partials remain, as in the first step, and the sound of a bell is lost.</>,
          <>Compare the ratios 1.4, 2.76 and 3.5, which give three different bells from the same carrier.</>,
        ],
      },
      {
        title: "Operators that are not sines",
        body: (
          <>
            <p>A source in Six Sines need not be a sine wave. Its list of waveforms includes rounded square and sawtooth shapes, the half-sine and quarter-sine shapes of Yamaha’s later TX instruments, and window shapes intended for work with amplitude. When such a waveform is used as a modulator it behaves as the feedback operator of lesson 5 does: it supplies several harmonics, each of which modulates the carrier, so that one matrix cell does what would otherwise need operators in series.</p>
            <p>This step runs only in Six Sines. Change the modulator’s waveform, and observe how far the spectrum reaches while the index is unchanged. Several of the factory bass presets depend on this, and use no modulation more than one cell deep.</p>
          </>
        ),
        source: {
          kind: "operators",
          engine: "six",
          patch: { ops: [op(1), op(1, 0.8, { amp: body })], edges: [edge(0, 1, 1.5, { env: env(0, 0.6, 0.4, 0.3) })] },
        },
        controls: [{ label: "Index", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" }],
        sixControls: [
          { label: "Modulator waveform", id: SOURCE(0) + 5, initial: 0, options: WAVEFORMS.slice(0, 17) },
          { label: "Carrier waveform", id: SOURCE(1) + 5, initial: 0, options: WAVEFORMS.slice(0, 17) },
        ],
        clip: phrase,
        maxRatio: 32,
        tryThis: [
          <>Set the modulator to “Sawish” at an index of 1.5, and compare the result with a sine-wave modulator at the same index.</>,
          <>Set the carrier to “TX 2”, which is half a sine wave, and the index to 0. The carrier alone then has harmonics, so that modulation begins from a spectrum that is already complex.</>,
        ],
      },
    ],
  },
  {
    id: "motion",
    number: "8",
    part: PART,
    title: "Detuning, drift and unison",
    refs: ["chowning", "sixsines"],
    steps: [
      {
        title: "A small offset on the modulator",
        body: (
          <>
            <p>When the ratio is exactly a whole number, each reflected sideband falls exactly on another partial, and the two are added or subtracted in a proportion that never changes. The tone is consequently static. Chowning’s paper gives the remedy, which is to add a small constant to the modulating frequency. With an addition of 0.5 Hz, he says, the reflected partials no longer coincide with the others, “producing a beat frequency or tremulant of 1 c/s”.</p>
            <p>The pitch is unaffected, because the carrier has not been altered. What changes is the balance among the partials, which now varies slowly. An offset fixed in hertz gives the same rate of beating on every key, and this is usually what is wanted, whereas a detuned ratio gives a rate that rises with the pitch. Six Sines provides both, the second by the ratio itself and the first by an offset in hertz on each source.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1, 0, { hz: 0.5 }), op(1, 0.8, { amp: env(0.01, 1, 0.8, 0.4) })],
            edges: [edge(0, 1, 3)],
          },
        },
        controls: [
          { label: "Modulator offset", path: "ops.0.hz", min: -4, max: 4, step: 0.05, unit: "Hz" },
          { label: "Index", path: "edges.0.index", min: 0, max: 8, step: 0.05, unit: "rad" },
        ],
        clip: chords,
        tryThis: [
          <>Set the offset to 0 and listen to the chord, and then set it to 0.5.</>,
          <>Raise the index. More reflected partials then take part, so that the variation is greater in extent though no faster.</>,
        ],
      },
      {
        title: "Slow change of index",
        body: (
          <>
            <p>A slow variation of timbre, like that which the small offset of the preceding step produces, can also be obtained by modulating the index itself at a low rate. In Six Sines every matrix cell has a low-frequency oscillator of its own as well as an envelope, and several of the string and bell presets give each cell a different slow rate, so that no two families of partials move together.</p>
            <p>The raw engine has no low-frequency oscillator, and this bench obtains a similar effect from two pairs. Each has a modulator offset by a fraction of a hertz, by different amounts, so that the timbres of the two pass through their cycles at different rates. The mixture drifts in a way that neither pair does alone.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(2, 0, { hz: 0.3 }),
              op(1, 0.55, { amp: env(0.5, 1, 0.9, 1.2), pan: -0.5 }),
              op(3, 0, { hz: -0.2 }),
              op(1.003, 0.55, { amp: env(0.7, 1, 0.9, 1.2), pan: 0.5 }),
            ],
            edges: [edge(0, 1, 2.2), edge(2, 3, 1.6)],
          },
        },
        controls: [
          { label: "Left modulator offset", path: "ops.0.hz", min: -2, max: 2, step: 0.05, unit: "Hz" },
          { label: "Right modulator offset", path: "ops.2.hz", min: -2, max: 2, step: 0.05, unit: "Hz" },
          { label: "Right carrier ratio", path: "ops.3.ratio", min: 0.99, max: 1.01, step: 0.0005 },
        ],
        clip: padChords,
        maxRatio: 20,
      },
      {
        title: "Unison",
        body: (
          <>
            <p>Unison plays several copies of the whole voice, each slightly detuned. It thickens any sound, but its effect on an FM patch differs from that of the offset on the modulator and the slow change of index, which the two preceding steps described. Detuning the copies moves their carriers, so that the result beats in pitch, whereas those methods changed only the timbre. Since the two kinds of movement are different, they may be used together.</p>
            <p>This step runs in Six Sines, where unison is a property of the whole patch. Set the number of voices to 3 and raise the ratio shift.</p>
          </>
        ),
        source: {
          kind: "operators",
          engine: "six",
          patch: {
            ops: [op(1, 0, { feedback: 0.6 }), op(1, 0.8, { amp: env(0.02, 0.8, 0.8, 0.5) })],
            edges: [edge(0, 1, 2, { env: env(0.05, 0.8, 0.6, 0.5) })],
          },
        },
        controls: [{ label: "Index", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" }],
        sixControls: [
          { label: "Unison voices", id: 530, initial: 1, min: 1, max: 5, step: 1 },
          { label: "Unison ratio shift", id: 531, initial: 0.008, min: 0, max: 0.05, step: 0.0005 },
        ],
        clip: melody,
        tryThis: [          <>Three voices with a shift of 0.006 resemble a section of players, and five with a shift of 0.03 resemble a deliberately detuned stack of oscillators.</>,],
      },
    ],
  },
];
