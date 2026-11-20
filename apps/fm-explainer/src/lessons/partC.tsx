import { edge, env, op } from "../audio/patch";
import { SOURCE, WAVEFORMS } from "../audio/sixSinesMap";
import { chords, held, melody, padChords, phrase } from "./clips";
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
        title: "Ring modulation: exactly two sidebands",
        body: (
          <>
            <p>
              Each cell of the Six Sines matrix can do something other than phase modulation. The most useful
              alternative is ring modulation, where the modulator scales the carrier’s <em>amplitude</em>. Multiplying
              two sines gives exactly two new partials, at the sum and the difference of their frequencies, and no
              more however hard you drive it.
            </p>
            <p>
              That makes it the precise tool where phase modulation is the broad one. A carrier at ratio 10
              ring-modulated by an operator at ratio 1 gains partials at 9 and 11 and nothing else. The same pair
              under phase modulation spreads a whole family around tick 10.
            </p>
            <p className="note">
              Six Sines blends between the dry carrier and the product: output = carrier × (1 + depth × (modulator −
              1)). At depth 1 the carrier itself disappears and only the two sidebands remain.
            </p>
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
          { label: "Modulator ratio", path: "ops.0.ratio", min: 0.5, max: 6, step: 0.5 },
        ],
        clip: held(48, 8),
        maxRatio: 20,
        predict: {
          question: "Carrier at 10, ring modulator at 1, depth 0.7. How many partials?",
          options: ["One, at 10", "Three: 9, 10, 11", "A family spreading out from 10, as with phase modulation", "Two: 1 and 10"],
          answer: 1,
          explain: (
            <p>
              Sum and difference, plus what is left of the carrier. Raising the depth changes their balance and never
              adds a fourth. Compare with the next step, the same two operators under phase modulation.
            </p>
          ),
        },
      },
      {
        title: "The same pair under phase modulation",
        body: (
          <p>
            Same operators, same ratios, phase modulation instead. Sweep the index and count. Use ring modulation when
            you want to add one specific pair of partials, for example a shimmer above a bell, and phase modulation
            when you want a region to fill in. The factory preset “Nostalgic Bell Synth” in Part E uses both from the
            same modulator.
          </p>
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
        title: "Operators that are not sines",
        body: (
          <>
            <p>
              A Six Sines source does not have to be a sine. Its waveform menu has rounded squares and saws, the
              half- and quarter-sine shapes from Yamaha’s later TX chips, and window shapes meant for amplitude work.
              Used as a modulator, a non-sine waveform behaves like the feedback operator of lesson 5: it brings
              several harmonics, each acting as a modulator, so one cell does the work of a stack.
            </p>
            <p>
              This step only runs in Six Sines. Change the modulator’s waveform and watch the reach of the spectrum at
              a fixed index. The factory bass presets lean on this heavily; many use no cross-modulation deeper than
              one cell.
            </p>
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
          <>Modulator on “Sawish” at index 1.5, against a sine modulator at the same index.</>,
          <>Carrier on “TX 2” (a half sine) with the index at 0: the carrier alone already has harmonics, so FM now starts from a richer place.</>,
        ],
      },
    ],
  },
  {
    id: "motion",
    number: "8",
    part: PART,
    title: "Motion: detune, drift and unison",
    refs: ["chowning", "sixsines"],
    steps: [
      {
        title: "Half a hertz on the modulator",
        body: (
          <>
            <p>
              With an exact whole-number ratio, reflected sidebands land precisely on existing partials and add or
              cancel once and for all. The tone is frozen. Chowning’s fix is in the 1973 paper: add a small constant,
              he suggests 0.5 Hz, to the modulating frequency. The reflected partials then miss by a hair, “producing a
              beat frequency or tremulant of 1 c/s”.
            </p>
            <p>
              The pitch does not waver, since the carrier has not moved. What moves is the balance between partials, a
              slow internal shimmer. A fixed offset in hertz beats at the same rate on every key, which is usually
              what you want; a ratio detune beats faster as you go up. Six Sines has both: the ratio itself, and an
              “absolute offset” in Hz on each source.
            </p>
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
          <>Set the offset to 0 and listen to how static the chord is. Then 0.5.</>,
          <>Raise the index. A higher index means more reflected partials taking part, so the shimmer gets deeper without getting faster.</>,
        ],
      },
      {
        title: "Slow change of index",
        body: (
          <>
            <p>
              The other source of life is a slow modulation of the index itself. In Six Sines every matrix cell has its
              own LFO alongside its envelope, and several of the string and bell presets run a different slow LFO on
              each cell so that no two partial families move together.
            </p>
            <p>
              The raw engine has no LFO, so this bench fakes the simplest case with two pairs. They are identical
              except that one modulator is 0.3 Hz off, which makes its timbre cycle while the other stays still. Mixed
              together the result drifts in a way neither does alone.
            </p>
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
            <p>
              Unison stacks several detuned copies of the whole voice. It thickens anything, but it interacts with FM
              in a specific way: detuning the copies moves the carrier, so the result beats in <em>pitch</em>, where
              the tricks in the last two steps moved only timbre. The two are complementary and the richest patches
              use a little of each.
            </p>
            <p>
              This step runs in Six Sines, where unison is a property of the whole patch. Set the voice count to 3 and
              bring up the spread.
            </p>
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
        tryThis: [<>Three voices at a shift of 0.006 is a section. Five at 0.03 is a detuned stack.</>],
      },
    ],
  },
];
