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
        title: "The index follows the amplitude",
        body: (
          <>
            <p>Chowning based his brass tone on Risset’s analysis of the trumpet, from which he took three facts. All the harmonics are present. The higher ones grow stronger as the note grows louder. And the attack is fast, and may rise above the level at which the note then settles.</p>
            <p>The first fact fixes the ratio at 1 : 1, and since nothing in the description calls for a second component, one pair is enough. The second fact is met by giving the index the same envelope as the amplitude, and this is what remains to be adjusted. Chowning uses one function for both: it rises in a tenth of a second, falls back to three quarters, and holds, while the index goes from 0 to 5. The overshoot at the start, which the third fact requires, is heard as the bite at the beginning of the note.</p>
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
          <>Make the index attack much shorter than the amplitude attack, say 0.01 s against 0.08 s. The note is then bright from the first instant, and is heard as a synthesizer and not as a horn.</>,
          <>With the sustain at 1 there is no overshoot, and the note begins softly, as on a flugelhorn. With the sustain at 0.4 the beginning is a hard accent.</>,
        ],
      },
      {
        title: "Three additions",
        body: (
          <>
            <p>The brass tone of the preceding step is a single pair with one envelope. Three additions make it more useful, and each applies a connection from Part B.</p>
            <ul>
              <li>Feedback on the modulator gives it harmonics of its own, so that the upper part of the spectrum is filled without raising the index (lesson 5).</li>
              <li>A second modulator at ratio 3, in parallel with the first, has a short envelope that depends on velocity, and supplies the edge on notes attacked hard (lesson 6f).</li>
              <li>A second carrier on the same modulator, slightly detuned, gives the effect of a second player (lesson 6e).</li>
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
            <p>In woodwinds and organ pipes, Chowning observes, the higher harmonics are often the first to sound, and the lower ones grow as the tone reaches its steady state. This is the reverse of what happens in brass.</p>
            <p>The behaviour can be had from one pair by placing the carrier on an upper harmonic. With the carrier at 3 and the modulator at 1, an index of zero gives the third harmonic alone. As the index rises, sidebands appear at 2 and 1 below it and at 4 and 5 above, so that the fundamental arrives after the note has begun.</p>
            <p>Two things are left to choose: the harmonic on which the carrier is placed, and the value the index reaches. Chowning’s settings are these.</p>
            <table>
              <thead>
                <tr><th>Timbre</th><th>Carrier : modulator</th><th>Index</th></tr>
              </thead>
              <tbody>
                <tr><td>Reed</td><td className="m">3 : 1</td><td className="m">0 → 2</td></tr>
                <tr><td>Bassoon, in the lower octaves</td><td className="m">5 : 1</td><td className="m">0 → 1.5</td></tr>
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
          question: "The carrier is at 3 and the modulator at 1, and the index rises from 0 to 2 during the attack. What is heard first?",
          options: [
            "The fundamental, with harmonics added above it",
            "The 3rd harmonic, an octave and a fifth above the note, after which the fundamental appears beneath it",
            "Noise, then tone",
            "All harmonics at once",
          ],
          answer: 1,
          explain: (
            <p>At an index of 0 only the carrier sounds, and the carrier is the third harmonic. If the index attack is made very slow the two stages can be heard separately. At the ordinary speed the ear takes them together as the breathy beginning of a reed note.</p>
          ),
        },
        tryThis: [          <>Put the carrier on 5, set the index to 1.5 and play in the lowest octave. This is Chowning’s bassoon.</>,],
      },
      {
        title: "The clarinet",
        body: (
          <>
            <p>The clarinet has mainly odd harmonics. Chowning obtains them with the carrier at 3 and the modulator at 2. The fundamental is then 1, and the sidebands, at 3 ± 2k, are all odd. He also reverses the envelope of the index, which falls from 4 to 2 during the attack, so that “the bandwidth of the spectrum will decrease as the amplitude increases during the attack”.</p>
            <p>The modulator on this page has an offset of 0.4 Hz. This is the device described in lesson 8, and Chowning recommends it for these tones.</p>
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
        tryThis: [          <>Play in the octave below the loop. The pitch heard is that of the key, because the fundamental is at 1 although neither operator is tuned to it.</>,],
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
            <p>A bowed string has a dense harmonic spectrum with a broad region of greatest strength, a slow beginning while the bow takes hold, slight continual variation, and fewer audible overtones on the higher strings.</p>
            <p>Schottstaedt’s fm-violin, which was used in a great deal of computer music, has three modulators in parallel on one carrier, at 1, 3 and 4 times the note. They are in parallel because each needs an index of its own. The three indices together determine the shape of the broad region, which one modulator at a higher index could not do.</p>
            <p>The indices are small, and they are made smaller as the pitch rises: in his formulas each is divided by a function of the frequency. On this page that is done by the key scaling of lesson 4, which is already set. The modulators are offset by a fraction of a hertz to give the variation. What remains to adjust is the three indices.</p>
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
          <>Set the indices of the modulators at 3 and 4 to zero. What remains is a duller tone, like that of a flute, which shows that the upper two supply the rasp of the bow.</>,
          <>Shorten the bow attack to 0.02 s. The spectrum is unchanged, but the note is now heard as a short bounced stroke.</>,
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
        title: "A fixed fundamental and two modulators",
        body: (
          <>
            <p>Yamaha’s tutorial on bass sounds lists what a bass patch requires: a solid fundamental, envelopes quick enough for short notes, and a brightness that responds to velocity.</p>
            <p>The fundamental is kept solid by a single carrier at ratio 1, which sounds it whatever the modulators do. Two modulators act on this carrier in parallel. The first has feedback, which makes it resemble a sawtooth, and it supplies the steady character of the tone. The second has a short envelope of its own and depends entirely on velocity, so that it is heard only as a snap at the beginning of notes struck hard. A fourth operator is placed in series above the first modulator, where a small index adds roughness.</p>
            <p>The choice left open is how the brightness is divided between the two modulators. Brightness from the feedback is constant and buzzing, and brightness from the second modulator is momentary and percussive.</p>
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
          <>Set the snap index to 0. The line loses the definition of its attacks but keeps its weight. Then restore it and set the body index to 0, which has the opposite effect.</>,
          <>Set the carrier ratio to 0.5. The fundamental is then an octave lower, with the modulators at twice its frequency. The author of the tutorial came on this by accident, and says that it gives a much heavier bottom end.</>,
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
        title: "A series for the attack and a series for the body",
        body: (
          <>
            <p>When a string is plucked there is first a burst of many bright partials, lasting a few hundredths of a second, as the string leaves the plectrum. It is followed by a tone that loses its upper harmonics steadily as it rings.</p>
            <p>Yamaha’s harp patch uses two series of three operators side by side, one for the attack and one for the body. Operators are placed in series because the attack needs more density than one pair can give (lesson 6b), and there are two series because the attack and the body behave differently in time (lesson 6e). In each series the lower two operators are at a ratio of 0.5, which gives a complete harmonic series whose fundamental is an octave below the key, and the top operator, at about 8, adds the noise of the pick.</p>
            <p>What is left to adjust is the relation between the two decays.</p>
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
          <>Shorten the body’s ring time to 0.3 s, as when the strings are damped with the palm. The patch is then close to the factory preset “Muted Strat” in Part E, from which its numbers are taken.</>,
          <>Lengthen the decay of the attack series to 0.6 s. The pluck becomes a nasal honk, like that of a clavinet.</>,
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
        title: "A pair for the body and two for the tine",
        body: (
          <>
            <p>In an electric piano a hammer strikes a metal tine. There is a high metallic sound that dies quickly, and beneath it a mellow tone that rings on and becomes rough when the key is struck hard.</p>
            <p>These are two components with different behaviour in time, and the patch accordingly uses independent pairs. One pair, at 1 : 1, gives the body. Two more give the tine, each with its modulator at about 7 times its carrier, and the two are slightly detuned against each other so that the metallic sound shimmers. The numbers are taken from the factory preset “Surge DX Piano Port”, which is the first examined in Part E.</p>
            <p>The expressive character of the instrument comes almost wholly from the effect of velocity on the index of the body pair, which produces the roughness of hard notes. The tine pairs need little adjustment beyond being short.</p>
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
          <>Set the effect of velocity on the body index to 0. The chords become as even as those of an organ, which shows how much depended on that one mapping.</>,
          <>A tine ratio of 14 gives the glassy piano heard on many recordings of the 1980s, and a ratio of 10 is nearer to a real tine.</>,
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
            <p>Chowning states two premises for percussive sounds: the partials are not usually in the harmonic series, and “the evolution of the spectrum is from the complex to the simple”.</p>
            <p>Inharmonic partials need only a suitable ratio, so that one pair is enough. For his bell the carrier is at 200 Hz and the modulator at 280 Hz, a ratio of 1 : 1.4, and the index falls from 10 to 0 along the same exponential curve, 15 seconds long, as the amplitude. The spectrum therefore becomes simpler as the bell rings, until almost nothing but the carrier is left.</p>
            <p>The ratio and the initial index are the two things to adjust.</p>
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
          <>Make the index decay much shorter than the ring time, say 1 s against 9 s. The result is a bar struck with a soft mallet, bright at the stroke and followed by a long pure hum.</>,
        ],
      },
      {
        title: "Drum",
        body: (
          <>
            <p>The drum has the same ratio, 1 : 1.4, and the same single pair as the bell of the preceding step. Chowning changes two numbers: the note lasts 0.2 seconds, and the index begins at 2 where that of the bell began at 10. “The principal difference from the bell sound, in addition to the short duration, is the vastly reduced initial bandwidth of the spectrum.”</p>
            <p>A bell and a tom-tom are thus the same patch with different values. The comparison shows how much of the identity of an instrument lies in the course of the index, and how little in the connection of the operators.</p>
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
          question: "Starting from the drum, the index is raised to 10 and the length to 2 seconds, and nothing else is changed. What is the result?",
          options: ["A longer drum", "A snare", "The bell from the previous step, shorter", "A bass note"],
          answer: 2,
          explain: (
            <p>Those two numbers were the only differences between the two patches.</p>
          ),
        },
      },
      {
        title: "Wood drum",
        body: (
          <>
            <p>The third percussive sound in the paper uses an extreme setting to imitate a resonant body. The carrier is at 80 Hz and the modulator at 55 Hz, and the index starts at 25 and falls to nothing within the first 25 thousandths of a second, while the amplitude dies away more slowly.</p>
            <p>An index of 25 with a modulator at 55 Hz spreads the energy over nearly 3000 Hz, so that for an instant the sound is a broad band of noise. The band then narrows rapidly to a single sine wave, and this, Chowning says, “has the perceptual effect of a strong resonance”. Nothing that resonates has been modelled. A very rapid fall of the index is simply heard as a resonance.</p>
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
          <>Lengthen the collapse time to 0.3 s. The impression of a resonance is lost, and the fall of the index is heard as a sweep.</>,
          <>Play higher on the keyboard, where the same patch suggests a log drum, a tabla, or a stretched rubber band.</>,
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
        title: "A series driven until the pitch is lost",
        body: (
          <>
            <p>A hi-hat or a cymbal has no pitch, because its spectrum is so dense and so inharmonic that the ear can find no fundamental in it.</p>
            <p>Such a spectrum is produced by doing what Part B advised against. The operators are in a long series, their ratios have no simple relation, the indices are great enough to carry the sidebands beyond half the sample rate, and the feedback is beyond the limit at which it is stable. Reid observes that feedback between operators at unrelated frequencies soon turns to noise and is useful for percussion on that account, and Schottstaedt finds that bursts of noise begin when the feedback index is a little above 1.</p>
            <p>Only the amplitude envelope and the register are left to adjust. It is more instructive to proceed in the other direction, reducing the stages one by one until a pitch can be heard again, and so finding where the noise begins.</p>
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
          <>A length of 0.6 s gives an open hi-hat, and 1.5 s a ride cymbal. An octave higher the cymbal is brighter.</>,
          <>Reduce all three indices together. At about 2 a clangorous pitch appears, which resembles a cowbell.</>,
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
            <p>A sung vowel is a harmonic buzz with three fixed regions of emphasis, a gentle beginning, and slight continual variation.</p>
            <p>Parallel carriers on one modulator provide the regions (lesson 6d): each carrier places one formant, and the shared modulator keeps all three on one harmonic series. The modulator has feedback, so that each formant is a group of partials and not a single one, and a small offset in hertz, which supplies the variation.</p>
            <p>The three carrier ratios determine the vowel. Their levels fall steeply from the first to the third, and Schottstaedt gives the amplitudes in Le Brun’s voice as 0.86, 0.13 and 0.01. The indices must be small, because a wide index spreads each formant into its neighbours and the vowel is lost.</p>
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
          <>Ratios of 2, 5 and 10 are near “ah”, 1, 9 and 12 near “ee”, and 2, 3 and 10 near “oo”.</>,
          <>Raise the formant width above 2. The vowel is lost, and what remains is an ordinary bright tone.</>,
        ],
      },
    ],
  },
];
