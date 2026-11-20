import { edge, env, op } from "../audio/patch";
import {
  bassLine, bellTune, brassLine, drums, epChords, hats, melody, padChords, pluckArp, struck,
} from "./clips";
import type { Lesson } from "./types";

const PART = "D · Recipes";
const M = ({ children }: { children: React.ReactNode }) => <span className="m">{children}</span>;

// Each recipe starts from a patch with the routing and ratios in place. The
// controls on the bench are the one or two decisions that make the sound.

export const partD: Lesson[] = [
  {
    id: "brass",
    number: "9.1",
    part: PART,
    title: "Brass",
    refs: ["chowning", "schottstaedt"],
    steps: [
      {
        title: "Brightness follows loudness",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> Chowning starts from Risset’s analysis of trumpet tones: all
              harmonics present, the higher ones growing with intensity, and a fast attack that may overshoot the
              steady level.
            </p>
            <p>
              <strong>Topology.</strong> All harmonics means a ratio of 1 : 1. Nothing here needs a second ingredient,
              so one pair is enough.
            </p>
            <p>
              <strong>The decision.</strong> The index envelope has the same shape as the amplitude envelope. Chowning
              uses one function for both, rising in a tenth of a second, sagging to three quarters, and holding, with
              the index running from 0 to 5. The brighter-when-louder link is the whole recipe, and the overshoot is
              the “blat” at the start of the note.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1), op(1, 0.8, { amp: env(0.08, 0.12, 0.75, 0.12) })],
            edges: [edge(0, 1, 5, { env: env(0.08, 0.12, 0.75, 0.12), velocity: 0.5 })],
          },
        },
        controls: [
          { label: "Peak index", path: "edges.0.index", min: 0, max: 8, step: 0.05, unit: "rad" },
          { label: "Index attack", path: "edges.0.env.a", min: 0.005, max: 0.4, log: true, unit: "s" },
          { label: "Index sustain (fraction of peak)", path: "edges.0.env.s", min: 0, max: 1, step: 0.01 },
          { label: "Amplitude attack", path: "ops.1.amp.a", min: 0.005, max: 0.4, log: true, unit: "s" },
        ],
        clip: brassLine,
        tryThis: [
          <>Make the index attack much faster than the amplitude attack (0.01 against 0.08). The note starts bright and stays; it now reads as a synth, not a horn.</>,
          <>Sustain at 1 removes the overshoot: a softer, flugelhorn start. Sustain at 0.4 gives a hard sforzando.</>,
        ],
      },
      {
        title: "A bigger section",
        body: (
          <>
            <p>
              Three additions take the textbook brass to something usable, and each is a topology choice from Part B.
            </p>
            <ul>
              <li>Feedback on the modulator makes it saw-like, so the top of the spectrum fills in without a higher index (lesson 5).</li>
              <li>A second modulator at ratio 3 in parallel, short and velocity-driven, gives the edge on hard attacks (lesson 6f).</li>
              <li>A second, slightly detuned carrier on the same modulator doubles the player (lesson 6e).</li>
            </ul>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { feedback: 0.7 }),
              op(3),
              op(1, 0.6, { amp: env(0.07, 0.12, 0.8, 0.15), pan: -0.3 }),
              op(1.004, 0.6, { amp: env(0.09, 0.12, 0.8, 0.15), pan: 0.3 }),
            ],
            edges: [
              edge(0, 2, 3.2, { env: env(0.08, 0.12, 0.7, 0.15), velocity: 0.5 }),
              edge(1, 2, 1.2, { env: env(0.02, 0.12, 0.05, 0.1), velocity: 1 }),
              edge(0, 3, 3.2, { env: env(0.1, 0.12, 0.7, 0.15), velocity: 0.5 }),
            ],
          },
        },
        controls: [
          { label: "Modulator feedback", path: "ops.0.feedback", min: 0, max: 1.5, step: 0.01, unit: "rad" },
          { label: "Attack edge (2 → 3)", path: "edges.1.index", min: 0, max: 4, step: 0.05, unit: "rad" },
          { label: "Second player detune", path: "ops.3.ratio", min: 1, max: 1.015, step: 0.0005 },
        ],
        clip: brassLine,
        maxRatio: 24,
      },
    ],
  },
  {
    id: "woodwinds",
    number: "9.2",
    part: PART,
    title: "Woodwinds",
    refs: ["chowning"],
    steps: [
      {
        title: "Carrier above the modulator",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> In woodwinds and organ pipes, Chowning observes, the higher
              harmonics are often the <em>first</em> to speak; the lower ones arrive as the tone settles. That is the
              opposite of brass.
            </p>
            <p>
              <strong>Topology.</strong> One pair, with the carrier placed on an upper harmonic. With the carrier at 3
              and the modulator at 1, an index of zero gives the 3rd harmonic alone. As the index rises the sidebands
              step down to 2 and 1 and up to 4 and 5: the fundamental arrives late.
            </p>
            <p>
              <strong>The decision.</strong> Which harmonic the carrier sits on, and how far the index opens.
              Chowning’s settings:
            </p>
            <table>
              <thead>
                <tr><th>Timbre</th><th>Carrier : modulator</th><th>Index</th></tr>
              </thead>
              <tbody>
                <tr><td>Generic reed</td><td className="m">3 : 1</td><td className="m">0 → 2</td></tr>
                <tr><td>Bassoon (low register)</td><td className="m">5 : 1</td><td className="m">0 → 1.5</td></tr>
                <tr><td>Clarinet</td><td className="m">3 : 2</td><td className="m">4 → 2 (next step)</td></tr>
              </tbody>
            </table>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1, 0, { hz: 0.4 }), op(3, 0.8, { amp: env(0.07, 0, 1, 0.1) })],
            edges: [edge(0, 1, 2, { env: env(0.09, 0, 1, 0.1) })],
          },
        },
        controls: [
          { label: "Carrier harmonic", path: "ops.1.ratio", min: 1, max: 7, step: 1, marks: [3, 5] },
          { label: "Index", path: "edges.0.index", min: 0, max: 5, step: 0.05, unit: "rad", marks: [1.5, 2] },
          { label: "Index attack", path: "edges.0.env.a", min: 0.005, max: 0.5, log: true, unit: "s" },
        ],
        clip: melody,
        predict: {
          question: "Carrier at 3, modulator at 1, index rising from 0 to 2 over the attack. What do you hear first?",
          options: [
            "The fundamental, with harmonics added above it",
            "The 3rd harmonic, an octave and a fifth above the note, with the fundamental filling in underneath",
            "Noise, then tone",
            "All harmonics at once",
          ],
          answer: 1,
          explain: (
            <p>
              At index 0 only the carrier sounds, and the carrier is the 3rd harmonic. Slow the index attack right
              down to hear it as two events. At normal speed the ear takes it as the “chiff” of a reed starting.
            </p>
          ),
        },
        tryThis: [<>Carrier 5, index 1.5, and play in the bottom octave: Chowning’s bassoon.</>],
      },
      {
        title: "Clarinet: odd harmonics and a closing index",
        body: (
          <>
            <p>
              A clarinet has mostly odd harmonics. Chowning gets them from carrier 3, modulator 2: the fundamental is
              then 1, and the sidebands at 3 ± 2k are all odd. He also turns the index envelope upside down, running
              it from 4 down to 2, so “the bandwidth of the spectrum will decrease as the amplitude increases during
              the attack”.
            </p>
            <p>
              The modulator carries a 0.4 Hz offset here, his own suggestion for realism from lesson 8.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(2, 0, { hz: 0.4 }), op(3, 0.8, { amp: env(0.08, 0, 1, 0.1) })],
            edges: [edge(0, 1, 4, { env: env(0, 0.12, 0.5, 0.1) })],
          },
        },
        controls: [
          { label: "Starting index", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Settles to (fraction)", path: "edges.0.env.s", min: 0, max: 1, step: 0.01 },
          { label: "Settling time", path: "edges.0.env.d", min: 0.01, max: 1, log: true, unit: "s" },
        ],
        clip: melody,
        tryThis: [<>Play below the staff. Note that the keyboard pitch is the fundamental at 1; the roll’s C3 sounds as written.</>],
      },
    ],
  },
  {
    id: "strings",
    number: "9.3",
    part: PART,
    title: "Bowed strings",
    refs: ["schottstaedt"],
    steps: [
      {
        title: "Three small modulators",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> A dense harmonic spectrum with a broad hump, a slow onset as the
              bow takes hold, constant small movement, and fewer audible overtones on the higher strings.
            </p>
            <p>
              <strong>Topology.</strong> Schottstaedt’s fm-violin, the workhorse of a generation of computer music,
              is three modulators in parallel on one carrier, at 1, 3 and 4 times the note. Parallel because each
              needs its own index: the three indices shape the hump, which a single modulator at a higher index
              cannot do.
            </p>
            <p>
              <strong>The decision.</strong> The indices are small, and they shrink as the pitch rises. His formulas
              divide each index by a function of the frequency. Here that is the key-scaling control from lesson 4.
              The modulators are a fraction of a hertz off, for bow noise.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { hz: 0.3 }),
              op(3, 0, { hz: -0.4 }),
              op(4, 0, { hz: 0.5 }),
              op(1, 0.8, { amp: env(0.25, 0.3, 0.85, 0.3) }),
            ],
            edges: [
              edge(0, 3, 1.4, { env: env(0.2, 0.4, 0.6, 0.3), keyScale: 0.5 }),
              edge(1, 3, 0.9, { env: env(0.2, 0.4, 0.6, 0.3), keyScale: 0.5 }),
              edge(2, 3, 0.6, { env: env(0.2, 0.4, 0.6, 0.3), keyScale: 0.5 }),
            ],
          },
        },
        controls: [
          { label: "Index of modulator at 1", path: "edges.0.index", min: 0, max: 3, step: 0.05, unit: "rad" },
          { label: "Index of modulator at 3", path: "edges.1.index", min: 0, max: 3, step: 0.05, unit: "rad" },
          { label: "Index of modulator at 4", path: "edges.2.index", min: 0, max: 3, step: 0.05, unit: "rad" },
          { label: "Bow attack", path: "ops.3.amp.a", min: 0.01, max: 1, log: true, unit: "s" },
        ],
        clip: padChords,
        maxRatio: 24,
        tryThis: [
          <>Zero the modulators at 3 and 4. What remains is a duller, flute-like tone: the upper two are the rosin.</>,
          <>Shorten the bow attack to 0.02 s for a spiccato; the same spectrum reads as a different articulation.</>,
        ],
      },
    ],
  },
  {
    id: "bass",
    number: "9.4",
    part: PART,
    title: "Bass",
    refs: ["manny", "yamaha6"],
    steps: [
      {
        title: "Fundamental first, then character",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> Yamaha’s bass tutorial lists the requirements: a solid
              fundamental, quick envelopes that suit short notes, and a tone whose brightness answers to velocity.
            </p>
            <p>
              <strong>Topology.</strong> One carrier at ratio 1 keeps the fundamental solid whatever else happens.
              Two modulators feed it in parallel. The first, with feedback, is the body: a saw-like modulator at
              ratio 1. The second has its own short envelope and full velocity sensitivity, and exists only to snap
              on hard notes. A fourth operator sits in series above the body modulator for extra growl.
            </p>
            <p>
              <strong>The decision.</strong> How much of the brightness lives in feedback (static, buzzy) and how
              much in the snap modulator (dynamic, percussive).
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(2, 0, { label: "growl" }),
              op(1, 0, { feedback: 0.9, label: "body" }),
              op(1, 0, { label: "snap" }),
              op(1, 0.9, { feedback: 0.3, amp: env(0.002, 0.5, 0.6, 0.08) }),
            ],
            edges: [
              edge(0, 1, 0.6, { env: env(0, 0.2, 0.2, 0.08) }),
              edge(1, 3, 2.2, { env: env(0, 0.25, 0.35, 0.08), velocity: 0.4 }),
              edge(2, 3, 3, { env: env(0, 0.07, 0, 0.05), velocity: 1 }),
            ],
          },
        },
        controls: [
          { label: "Body feedback", path: "ops.1.feedback", min: 0, max: 1.5, step: 0.01, unit: "rad" },
          { label: "Body index", path: "edges.1.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Snap index", path: "edges.2.index", min: 0, max: 8, step: 0.05, unit: "rad" },
          { label: "Snap decay", path: "edges.2.env.d", min: 0.01, max: 0.5, log: true, unit: "s" },
          { label: "Growl (series, 1 → 2)", path: "edges.0.index", min: 0, max: 3, step: 0.05, unit: "rad" },
          { label: "Carrier ratio", path: "ops.3.ratio", min: 0.5, max: 2, step: 0.5, marks: [0.5, 1, 2] },
        ],
        clip: bassLine,
        maxRatio: 32,
        tryThis: [
          <>Snap index to 0: the line loses its articulation but not its weight. Body index to 0: the reverse.</>,
          <>Carrier ratio 0.5 puts the fundamental an octave down with the modulators now at 2 : 1 above it. The tutorial’s author found the same trick by accident and calls the result a much heavier bottom end.</>,
        ],
      },
    ],
  },
  {
    id: "plucked",
    number: "9.5",
    part: PART,
    title: "Plucked strings",
    refs: ["yamaha6"],
    steps: [
      {
        title: "An attack stack and a body stack",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> A burst of dense, bright, briefly noisy partials as the string
              leaves the plectrum, collapsing within a few tens of milliseconds to a tone that loses its upper
              harmonics steadily as it rings.
            </p>
            <p>
              <strong>Topology.</strong> Yamaha’s harp is two three-operator stacks side by side. One is the attack,
              with very short envelopes, and one is the body. Series, because the attack needs density that a single
              pair cannot give (lesson 6b), and two stacks because attack and body have different time behaviour
              (lesson 6e).
            </p>
            <p>
              <strong>The decision.</strong> The balance of the two decays. The modulators at ratio 0.5 under a carrier
              at 0.5 give a full harmonic series an octave below the nominal ratio, which is where the weight of a
              guitar string comes from.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(8.08),
              op(0.5),
              op(0.5, 0.8, { amp: env(0.001, 0.45, 0, 0.2), pan: -0.4, label: "attack" }),
              op(8),
              op(0.5),
              op(0.5, 0.8, { amp: env(0.002, 2.2, 0, 0.4), pan: 0.3, label: "body" }),
            ],
            edges: [
              edge(0, 1, 0.3, { env: env(0, 0.05, 0, 0.05) }),
              edge(1, 2, 3.9, { env: env(0, 0.12, 0, 0.1), velocity: 0.7 }),
              edge(3, 4, 1.1, { env: env(0.004, 0.1, 0, 0.1) }),
              edge(4, 5, 2.6, { env: env(0, 0.5, 0.16, 0.4), velocity: 0.4 }),
            ],
          },
        },
        controls: [
          { label: "Attack stack index", path: "edges.1.index", min: 0, max: 8, step: 0.05, unit: "rad" },
          { label: "Attack stack decay", path: "edges.1.env.d", min: 0.01, max: 1, log: true, unit: "s" },
          { label: "Body stack index", path: "edges.3.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Body index decay", path: "edges.3.env.d", min: 0.05, max: 3, log: true, unit: "s" },
          { label: "Body ring time", path: "ops.5.amp.d", min: 0.2, max: 6, log: true, unit: "s" },
        ],
        clip: pluckArp,
        maxRatio: 32,
        tryThis: [
          <>Shorten the body ring to 0.3 s for a palm mute. This is close to the factory preset “Muted Strat” in Part E, whose numbers these are.</>,
          <>Lengthen the attack stack decay to 0.6 s. The pluck becomes a nasal honk: a clavinet.</>,
        ],
      },
    ],
  },
  {
    id: "epiano",
    number: "9.6",
    part: PART,
    title: "Electric piano",
    refs: ["sixsines", "yamaha6"],
    steps: [
      {
        title: "Body pair and tine pairs",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> A tine struck by a hammer: a high metallic “tink” that dies
              quickly, over a mellow tone that rings and barks when hit hard.
            </p>
            <p>
              <strong>Topology.</strong> Independent pairs, the textbook case. One body pair at 1 : 1. Two tine pairs
              with the modulator near 7 times the carrier, detuned against each other so that the tink shimmers. The
              numbers below are taken from the factory preset “Surge DX Piano Port”, the first breakdown in Part E.
            </p>
            <p>
              <strong>The decision.</strong> Everything expressive is velocity into the body index. That one mapping
              produces the bark. The tines mostly need to be short.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1),
              op(1, 0.8, { amp: env(0.002, 4, 0, 0.35), label: "body" }),
              op(6.995),
              op(1.005, 0.3, { amp: env(0.001, 0.9, 0, 0.3), pan: -0.5, label: "tine" }),
              op(7),
              op(0.999, 0.3, { amp: env(0.001, 0.9, 0, 0.3), pan: 0.5, label: "tine" }),
            ],
            edges: [
              edge(0, 1, 3.6, { env: env(0, 1.4, 0.29, 0.35), velocity: 1 }),
              edge(2, 3, 2.5, { env: env(0, 0.25, 0, 0.2), velocity: 1 }),
              edge(4, 5, 2.4, { env: env(0, 0.22, 0, 0.2), velocity: 1 }),
            ],
          },
        },
        controls: [
          { label: "Body index (the bark)", path: "edges.0.index", min: 0, max: 8, step: 0.05, unit: "rad" },
          { label: "Velocity → body index", path: "edges.0.velocity", min: 0, max: 1, step: 0.01 },
          { label: "Tine modulator ratio", path: "ops.2.ratio", min: 3, max: 14, step: 0.01, marks: [6.995, 10, 14] },
          { label: "Tine level", path: "ops.3.level", min: 0, max: 0.6, step: 0.01 },
          { label: "Tine decay", path: "edges.1.env.d", min: 0.02, max: 1.5, log: true, unit: "s" },
        ],
        clip: epChords,
        maxRatio: 24,
        tryThis: [
          <>Set velocity → body index to 0. The chords flatten into an organ: the instrument was in that one control.</>,
          <>Tine ratio 14 is the glassy “FM piano” of a thousand ballads. 10 is nearer a real tine.</>,
        ],
      },
    ],
  },
  {
    id: "bells",
    number: "9.7",
    part: PART,
    title: "Bells and drums",
    refs: ["chowning"],
    steps: [
      {
        title: "Bell",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> Chowning’s two premises for percussive sounds: the partials are
              not in the harmonic series, and “the evolution of the spectrum is from the complex to the simple”.
            </p>
            <p>
              <strong>Topology.</strong> One pair. Inharmonicity needs only a ratio.
            </p>
            <p>
              <strong>The decision.</strong> The ratio and the starting index. His bell: carrier 200 Hz, modulator
              280 Hz (1 : 1.4), index 10 falling to 0 on the same 15-second exponential as the amplitude. As it rings
              the spectrum thins until, as he puts it, the predominant frequency is the carrier alone.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1.4), op(1, 0.8, { amp: env(0.001, 9, 0, 3) })],
            edges: [edge(0, 1, 10, { env: env(0, 9, 0, 3) })],
          },
        },
        controls: [
          { label: "Modulator ratio", path: "ops.0.ratio", min: 1, max: 5, step: 0.01, marks: [1.4, 1.41, 2.76, 3.5] },
          { label: "Starting index", path: "edges.0.index", min: 0, max: 14, step: 0.1, unit: "rad" },
          { label: "Ring time", path: "ops.1.amp.d", min: 0.2, max: 15, log: true, unit: "s" },
          { label: "Index decay", path: "edges.0.env.d", min: 0.1, max: 15, log: true, unit: "s" },
        ],
        clip: bellTune,
        maxRatio: 20,
        tryThis: [
          <>Make the index decay much shorter than the ring time (1 s against 9 s). A soft mallet on a bar: bright strike, long pure hum.</>,
        ],
      },
      {
        title: "Drum",
        body: (
          <>
            <p>
              Same ratio, same routing. Chowning changes two numbers: the note lasts 0.2 seconds and the index starts
              at 2 where the bell’s started at 10. “The principal difference from the bell sound, in addition to the
              short duration, is the vastly reduced initial bandwidth of the spectrum.”
            </p>
            <p>
              A bell and a tom are the same patch. That is the clearest demonstration in the paper that the index
              contour, more than the routing, is the instrument.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1.4), op(1, 0.9, { amp: env(0.004, 0.22, 0, 0.1) })],
            edges: [edge(0, 1, 2, { env: env(0, 0.2, 0, 0.1), velocity: 0.5 })],
          },
        },
        controls: [
          { label: "Starting index", path: "edges.0.index", min: 0, max: 12, step: 0.1, unit: "rad" },
          { label: "Length", path: "ops.1.amp.d", min: 0.03, max: 2, log: true, unit: "s" },
          { label: "Modulator ratio", path: "ops.0.ratio", min: 1, max: 5, step: 0.01 },
        ],
        clip: drums,
        maxRatio: 20,
        predict: {
          question: "Starting from the drum, you raise the index to 10 and the length to 2 seconds, leaving everything else. What do you get?",
          options: ["A longer drum", "A snare", "The bell from the previous step, shorter", "A bass note"],
          answer: 2,
          explain: <p>The only differences between the two patches were those two numbers.</p>,
        },
      },
      {
        title: "Wood drum",
        body: (
          <>
            <p>
              The third percussion sound in the paper uses an extreme setting to get something that sounds like a
              resonant body. Carrier 80 Hz, modulator 55 Hz, and an index of 25 that collapses to nothing within the
              first 25 milliseconds while the amplitude dies more slowly.
            </p>
            <p>
              An index of 25 on a 55 Hz modulator spreads energy over nearly 3 kHz. For an instant the sound is a
              broadband thwack. Then the bandwidth shrinks to a sine. Chowning: this “has the perceptual effect of a
              strong resonance”. Nothing resonant is being modelled; a very fast index sweep is heard as one.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(0.6875), op(1, 0.9, { amp: env(0.001, 0.2, 0, 0.1) })],
            edges: [edge(0, 1, 25, { env: env(0, 0.03, 0, 0.03) })],
          },
        },
        controls: [
          { label: "Starting index", path: "edges.0.index", min: 0, max: 30, step: 0.5, unit: "rad" },
          { label: "Index collapse time", path: "edges.0.env.d", min: 0.005, max: 0.5, log: true, unit: "s" },
          { label: "Length", path: "ops.1.amp.d", min: 0.05, max: 1.5, log: true, unit: "s" },
        ],
        clip: { ...drums, notes: drums.notes.map(([p, ...rest]) => [p - 12, ...rest]) as typeof drums.notes },
        maxRatio: 32,
        tryThis: [
          <>Stretch the collapse time to 0.3 s. The resonance illusion breaks and you hear the sweep for what it is.</>,
          <>Play up the keyboard: log drum, tabla, a plucked rubber band.</>,
        ],
      },
    ],
  },
  {
    id: "noise",
    number: "9.8",
    part: PART,
    title: "Noise percussion",
    refs: ["sos13", "schottstaedt"],
    steps: [
      {
        title: "Push a chain until the pitch goes",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> A hi-hat or cymbal has no pitch. Its spectrum is so dense and so
              inharmonic that no fundamental can be picked out.
            </p>
            <p>
              <strong>Topology.</strong> Everything Part B warned against. A deep chain, unrelated ratios, indices
              far beyond the point where sidebands pass the top of the audio band and fold back, and feedback past
              its stable limit. Reid notes that feedback between operators at unrelated frequencies quickly
              degenerates into noise, and that this is useful for percussion; Schottstaedt places the onset of noise
              bursts just above a feedback index of 1.
            </p>
            <p>
              <strong>The decision.</strong> Only the amplitude envelope and the register. The useful exercise runs
              the other way: turn stages down until a pitch reappears, and find where noise begins.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(0.331, 0, { feedback: 0.6 }),
              op(1, 0, { feedback: 2.5 }),
              op(7.96, 0, { feedback: 0.7 }),
              op(15.1, 0.7, { amp: env(0.001, 0.07, 0, 0.05) }),
            ],
            edges: [edge(0, 1, 12), edge(1, 2, 12), edge(2, 3, 12)],
            gain: 0.4,
          },
        },
        controls: [
          { label: "Index 1 → 2", path: "edges.0.index", min: 0, max: 14, step: 0.1, unit: "rad" },
          { label: "Index 2 → 3", path: "edges.1.index", min: 0, max: 14, step: 0.1, unit: "rad" },
          { label: "Index 3 → 4", path: "edges.2.index", min: 0, max: 14, step: 0.1, unit: "rad" },
          { label: "Feedback on 2", path: "ops.1.feedback", min: 0, max: 4, step: 0.01, unit: "rad" },
          { label: "Length", path: "ops.3.amp.d", min: 0.01, max: 1.5, log: true, unit: "s" },
        ],
        clip: hats,
        maxRatio: 48,
        tryThis: [
          <>Length 0.6 s is an open hat, 1.5 s a ride. Play an octave up for a brighter cymbal.</>,
          <>Bring all three indices down together. Somewhere around 2 a clangorous pitch emerges: a cowbell lives on the way from noise to tone.</>,
        ],
      },
    ],
  },
  {
    id: "voice",
    number: "9.9",
    part: PART,
    title: "Voice",
    refs: ["schottstaedt", "chowning"],
    steps: [
      {
        title: "Carriers on the formants",
        body: (
          <>
            <p>
              <strong>What the ear expects.</strong> A harmonic buzz with three fixed regions of emphasis, a gentle
              onset, and a pitch that is never quite still.
            </p>
            <p>
              <strong>Topology.</strong> Parallel carriers on one modulator (lesson 6d): the carriers place the
              formants and the shared modulator keeps them on one harmonic series. The modulator has feedback so that
              each formant is a cluster, not a single line.
            </p>
            <p>
              <strong>The decision.</strong> The three carrier ratios are the vowel, and their levels fall steeply:
              Le Brun’s figures, as Schottstaedt reports them, are 0.86, 0.13 and 0.01 for the three formants. The
              indices are small. A wide index smears a formant into its neighbours and the vowel is lost.
            </p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { feedback: 0.5, hz: 0.6 }),
              op(2, 0.75, { amp: env(0.09, 0.3, 0.85, 0.25) }),
              op(5, 0.22, { amp: env(0.11, 0.3, 0.85, 0.25) }),
              op(10, 0.06, { amp: env(0.13, 0.3, 0.85, 0.25) }),
            ],
            edges: [edge(0, 1, 1.1), edge(0, 2, 0.7), edge(0, 3, 0.5)],
          },
        },
        controls: [
          { label: "Formant 1 ratio", path: "ops.1.ratio", min: 1, max: 4, step: 1 },
          { label: "Formant 2 ratio", path: "ops.2.ratio", min: 3, max: 11, step: 1 },
          { label: "Formant 3 ratio", path: "ops.3.ratio", min: 8, max: 16, step: 1 },
          { label: "Formant 2 level", path: "ops.2.level", min: 0, max: 0.6, step: 0.01 },
          { label: "Formant width (index 1 → 3)", path: "edges.1.index", min: 0, max: 3, step: 0.05, unit: "rad" },
        ],
        clip: { ...melody, bpm: 76 },
        maxRatio: 20,
        tryThis: [
          <>2 / 5 / 10 is near “ah”. 1 / 9 / 12 is near “ee”. 2 / 3 / 10 is near “oo”.</>,
          <>Raise the formant width past 2. The vowel dissolves into a generic bright tone.</>,
        ],
      },
    ],
  },
];
