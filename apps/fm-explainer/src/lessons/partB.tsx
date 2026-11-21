import { edge, env, op, type Patch } from "../audio/patch";
import { parallelPair } from "../viz/bessel";
import { chords, held, melody, phrase, pluckArp, struck, velocityRamp } from "./clips";
import type { Lesson } from "./types";

const PART = "B · Topologies";
const M = ({ children }: { children: React.ReactNode }) => <span className="m">{children}</span>;

const body = env(0.004, 1.2, 0.5, 0.3);

export const partB: Lesson[] = [
  {
    id: "primitives",
    number: "6a",
    part: PART,
    title: "Four ways to connect operators",
    refs: ["sos13", "yamaha6", "sixsines"],
    steps: [
      {
        title: "Series",
        body: (
          <>
            <p>When a patch has more than two operators, there are four ways in which they can be connected, and every arrangement on every FM instrument is a combination of these four. Each does something the others cannot. The purpose of this part is to make it possible to decide, from a description of the sound wanted, which connection is required.</p>
            <p>The first is the series connection, in which one operator modulates a second and the second modulates a third. The carrier is then modulated by a wave that is already complex. This connection gives the densest spectra and is the hardest to control, for reasons given in lesson 6b.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: { ops: [op(1), op(1), op(1, 0.8, { amp: body })], edges: [edge(0, 1, 1.5), edge(1, 2, 1.5)] },
        },
        controls: [
          { label: "Index 1 → 2", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Index 2 → 3", path: "edges.1.index", min: 0, max: 6, step: 0.05, unit: "rad" },
        ],
        clip: phrase,
        maxRatio: 24,
      },
      {
        title: "Parallel modulators",
        body: (
          <>
            <p>In the second connection two operators modulate the same carrier. Each contributes its own family of sidebands, and since each has its own ratio and its own envelope, the two families can differ in spacing and can change differently during the note. It is the connection to use when a sound has two components of timbre that behave differently, for example a body that lasts and an edge that fades. Lesson 6c examines it.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: { ops: [op(1), op(3), op(1, 0.8, { amp: body })], edges: [edge(0, 2, 1.5), edge(1, 2, 1)] },
        },
        controls: [
          { label: "Index 1 → 3 (ratio 1)", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Index 2 → 3 (ratio 3)", path: "edges.1.index", min: 0, max: 6, step: 0.05, unit: "rad" },
        ],
        clip: phrase,
        maxRatio: 24,
      },
      {
        title: "Parallel carriers",
        body: (
          <>
            <p>In the third connection one operator modulates two carriers, both of which are heard. If the carriers have different ratios, each gathers its sidebands about a different part of the spectrum. The result is a spectrum with fixed regions of emphasis, called formants, and it is by its formants that one vowel is distinguished from another. Lesson 6d examines this connection.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1), op(1, 0.8, { amp: body }), op(6, 0.25, { amp: body })],
            edges: [edge(0, 1, 1.5), edge(0, 2, 1)],
          },
        },
        controls: [
          { label: "Second carrier ratio", path: "ops.2.ratio", min: 2, max: 12, step: 1 },
          { label: "Second carrier level", path: "ops.2.level", min: 0, max: 0.8, step: 0.01 },
          { label: "Index 1 → 2", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
        ],
        clip: phrase,
        maxRatio: 24,
      },
      {
        title: "Independent pairs",
        body: (
          <>
            <p>In the fourth connection there are two separate pairs whose outputs are mixed, and neither affects the other. This is additive synthesis in which each component is an FM tone and not a sine wave. It is the connection most often used in practice, generally with one pair providing the beginning of the note and the other its continuation, each with its own envelopes. Lesson 6e examines it.</p>
            <p className="note">In Six Sines every operator can be heard and can at the same time modulate those numbered after it, so that the four connections are not alternatives there. Several of the presets in Part E use all four at once.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1), op(1, 0.8, { amp: body }), op(7), op(1, 0.4, { amp: env(0.002, 0.25, 0, 0.2) })],
            edges: [edge(0, 1, 1.5, { env: env(0, 0.8, 0.4, 0.3) }), edge(2, 3, 2.5, { env: env(0, 0.15, 0, 0.2) })],
          },
        },
        controls: [
          { label: "Body index (1 → 2)", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Attack index (3 → 4)", path: "edges.1.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Attack pair level", path: "ops.3.level", min: 0, max: 0.8, step: 0.01 },
        ],
        clip: phrase,
        maxRatio: 24,
      },
    ],
  },
  {
    id: "series",
    number: "6b",
    part: PART,
    title: "Operators in series",
    refs: ["schottstaedt", "yamaha6", "sos13"],
    steps: [
      {
        title: "A modulator that is not a sine",
        body: (
          <>
            <p>In a series of three operators the middle one has already been modulated when it reaches the carrier, and its output is a tone with several partials. Each of those partials acts on the carrier as a separate sine-wave modulator and surrounds it with its own set of sidebands. Schottstaedt describes each component of the lower pair as surrounded by the spectrum of the upper pair, “sort of like a set of formant regions”.</p>
            <p>It follows that the widths produced by the two stages are multiplied and not added. A small index at each stage gives a wide spectrum, and a small change at the top of the series changes everything beneath it.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: { ops: [op(1), op(1), op(1, 0.8, { amp: body })], edges: [edge(0, 1, 0), edge(1, 2, 2)] },
        },
        controls: [
          { label: "Top index (1 → 2)", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Bottom index (2 → 3)", path: "edges.1.index", min: 0, max: 6, step: 0.05, unit: "rad" },
        ],
        clip: held(48, 8),
        maxRatio: 32,
        predict: {
          question:
            "With the upper index at 0 this is a simple pair at an index of 2, which reaches about tick 4. If the upper index is raised to 2 as well, about how far does the spectrum reach?",
          options: ["Still about tick 4", "About tick 6, because the indices are added", "Tick 10 or beyond, because the widths are multiplied", "It becomes inharmonic"],
          answer: 2,
          explain: (
            <p>At an index of 2 the middle operator has partials of appreciable strength up to about its third harmonic, and each of them modulates the carrier. The third harmonic acts as a modulator of ratio 3, and by the rule <M>m · (I + 1)</M> it reaches three times as far as the fundamental does. Since all the ratios are whole numbers, the result is still harmonic.</p>
          ),
        },
        tryThis: [
          <>Leave the lower index at 1 and move only the upper one. The whole spectrum widens and narrows together, which is why a series is convenient when a single control is wanted for brightness.</>,
        ],
      },
      {
        title: "A series for the attack",
        body: (
          <>
            <p>Because a series responds so strongly to its upper index, a short envelope on that index produces a brief burst of many partials which change rapidly and then disappear. The first few thousandths of a second of a plucked or struck string are of this kind. Yamaha’s guide says that a convincing plucked string can hardly be made without operators in series, and it gives the method: very short envelopes on the series, and enough sensitivity to velocity that it is heard only when the key is struck hard.</p>
            <p>In the patch on this page the top operator has a ratio of 8 and a small index. Once the note is sounding it contributes almost nothing. During the attack it roughens the middle operator, and the middle operator in turn roughens the carrier.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(8), op(0.5), op(0.5, 0.9, { amp: env(0.002, 1.4, 0, 0.3) })],
            edges: [
              edge(0, 1, 1.2, { env: env(0, 0.08, 0, 0.1), velocity: 0.8 }),
              edge(1, 2, 3.5, { env: env(0, 0.3, 0.1, 0.3), velocity: 0.5 }),
            ],
          },
        },
        controls: [
          { label: "Top index (pick noise)", path: "edges.0.index", min: 0, max: 4, step: 0.05, unit: "rad" },
          { label: "Top decay", path: "edges.0.env.d", min: 0.01, max: 1, log: true, unit: "s" },
          { label: "Bottom index (string)", path: "edges.1.index", min: 0, max: 8, step: 0.05, unit: "rad" },
          { label: "Bottom decay", path: "edges.1.env.d", min: 0.02, max: 2, log: true, unit: "s" },
        ],
        clip: pluckArp,
        maxRatio: 32,
        tryThis: [
          <>Set the upper index to 0 and then restore it, attending only to the first instant of each note.</>,
          <>Lengthen the upper decay to 1 s. The noise of the pick is then heard as a buzz throughout the note, which shows why the envelope at the top of a series is kept short.</>,
        ],
      },
      {
        title: "The limit of a series",
        body: (
          <>
            <p>A series cannot usefully be made much longer. Each stage multiplies the width given by the stage above, so that with three or four stages at moderate indices the partials extend beyond half the sample rate, where they are reproduced at the wrong frequencies and heard as noise. The author of Yamaha’s guide remarks of a single series of eight operators that he cannot think of a use for it.</p>
            <p>Nor is great length often needed, since an operator with feedback behaves much like a long series of identical operators at a ratio of 1. The bench has a series of three operators and also a single modulator with feedback, so that the two can be compared.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1), op(1), op(1, 0, { feedback: 0, label: "fb" }), op(1, 0.8, { amp: body })],
            edges: [edge(0, 1, 1.4), edge(1, 3, 1.6), edge(2, 3, 0)],
          },
        },
        controls: [
          { label: "Chain: 1 → 2", path: "edges.0.index", min: 0, max: 4, step: 0.05, unit: "rad" },
          { label: "Chain: 2 → 4", path: "edges.1.index", min: 0, max: 4, step: 0.05, unit: "rad" },
          { label: "Feedback on 3", path: "ops.2.feedback", min: 0, max: 1.5, step: 0.01, unit: "rad" },
          { label: "Feedback op: 3 → 4", path: "edges.2.index", min: 0, max: 4, step: 0.05, unit: "rad" },
        ],
        clip: held(48, 8),
        maxRatio: 32,
        tryThis: [
          <>Note the spectrum given by the series. Then set both of its indices to zero and use the last two sliders to obtain the same reach from operator 3 alone. A feedback of about 1.0 with an index of about 1.6 comes close.</>,
        ],
      },
    ],
  },
  {
    id: "parallel-modulators",
    number: "6c",
    part: PART,
    title: "Two modulators on one carrier",
    refs: ["schottstaedt", "sos13", "yamaha6"],
    steps: [
      {
        title: "Low indices",
        body: (
          <>
            <p>When two modulators act on one carrier, the result is commonly described as the sum of two modulated waves. Sound On Sound’s series describes it so, and Yamaha’s FM 101 in much the same way. While both indices are low the description is nearly correct. The modulator at ratio 1 gives the carrier sidebands at 2 and 3, the modulator at ratio 5 gives it sidebands at 4 and 6, and nothing else of any strength appears.</p>
            <p>Keep both indices below 1 for the present, and confirm that each slider controls one family of sidebands and leaves the other alone.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: { ops: [op(1), op(5), op(1, 0.8, { amp: body })], edges: [edge(0, 2, 0.6), edge(1, 2, 0.6)] },
        },
        controls: [
          { label: "Index of modulator at 1", path: "edges.0.index", min: 0, max: 5, step: 0.05, unit: "rad" },
          { label: "Index of modulator at 5", path: "edges.1.index", min: 0, max: 5, step: 0.05, unit: "rad" },
        ],
        clip: held(48, 8),
        maxRatio: 24,
        predicted: (state) => {
          const p = state as Patch;
          return parallelPair(1, p.ops[0].ratio, p.edges[0].index, p.ops[1].ratio, p.edges[1].index);
        },
      },
      {
        title: "Higher indices and combination tones",
        body: (
          <>
            <p>The description is not correct in general, and the difference matters. The two modulators are added together inside the sine function and not after it, and the sine of a sum is not the sum of two sines. The spectrum in fact contains a partial at <M>c + k·m₁ + l·m₂</M> for every pair of whole numbers <M>k</M> and <M>l</M>, and its strength is the product of two Bessel terms, <M>J_k(I₁) · J_l(I₂)</M>. Schottstaedt calls the partials for which neither number is zero “sum and difference tones (intermodulation products)”.</p>
            <p>When both indices are low, the product is negligible unless <M>k</M> or <M>l</M> is zero, and this is why the simpler description served. When both are raised, the remaining partials become strong and fill the gaps between the two families. The orange bars are calculated from the product.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: { ops: [op(1), op(5), op(1, 0.8, { amp: body })], edges: [edge(0, 2, 0.6), edge(1, 2, 0.6)] },
        },
        controls: [
          { label: "Index of modulator at 1", path: "edges.0.index", min: 0, max: 5, step: 0.05, unit: "rad" },
          { label: "Index of modulator at 5", path: "edges.1.index", min: 0, max: 5, step: 0.05, unit: "rad" },
        ],
        clip: held(48, 8),
        maxRatio: 24,
        predicted: (state) => {
          const p = state as Patch;
          return parallelPair(1, p.ops[0].ratio, p.edges[0].index, p.ops[1].ratio, p.edges[1].index);
        },
        predict: {
          question:
            "The modulators are at ratios 1 and 5, and both are raised to an index of 2. If the result were the sum of two FM tones, there would be partials from 1 to 3 and at 4, 6, 9 and 11. What in fact appears?",
          options: [
            "Exactly those two families",
            "Those, and also groups about 6 and 11, because each sideband from the modulator at 5 acquires neighbours from the modulator at 1",
            "Only the family from the modulator at 5, because the higher modulator dominates",
            "Noise",
          ],
          answer: 1,
          explain: (
            <p>Each sideband produced by the modulator at ratio 5 is itself surrounded by the family belonging to the modulator at ratio 1, so that there are partials at 6 ± 1, 6 ± 2, 11 ± 1 and so on. Compare this with the series connection, in which the same indices made the spectrum extend further. Two modulators in parallel put energy between the partials already present, whereas two in series put it beyond them.</p>
          ),
        },
      },
      {
        title: "Two nearly equal ratios",
        body: (
          <>
            <p>The partials of this second kind can be put to use. If the two modulators are given nearly equal ratios, here 3.1 and 2.9, the difference between them is a very low frequency, 0.2 of the note. Every partial then has neighbours at that small distance, and what is heard is a rough metallic tone that churns slowly. Since the distance is a fraction of the note and not a fixed number of hertz, the churning is faster on higher notes.</p>
            <p>Each modulator on this page has its own decay, so that the texture changes during the note. This independent control of each component is the reason for preferring two modulators in parallel to two in series. The factory preset “Detuned Metal”, examined in Part E, is this patch.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(3.1), op(2.9), op(2, 0.8, { amp: env(0.002, 3, 0.1, 1.2) })],
            edges: [edge(0, 2, 1.2, { env: env(0, 1.5, 0, 1) }), edge(1, 2, 0.8, { env: env(0, 2.5, 0.3, 1) })],
          },
        },
        controls: [
          { label: "Modulator 1 ratio", path: "ops.0.ratio", min: 2.5, max: 3.5, step: 0.01 },
          { label: "Modulator 2 ratio", path: "ops.1.ratio", min: 2.5, max: 3.5, step: 0.01 },
          { label: "Index 1", path: "edges.0.index", min: 0, max: 4, step: 0.05, unit: "rad" },
          { label: "Index 2", path: "edges.1.index", min: 0, max: 4, step: 0.05, unit: "rad" },
        ],
        clip: struck,
        maxRatio: 16,
        tryThis: [
          <>Bring the two ratios together. The churning becomes slower, and stops when they are equal.</>,
          <>Set one index to zero. The tone is still inharmonic, but it no longer changes, since the beating requires both modulators.</>,
        ],
      },
    ],
  },
  {
    id: "parallel-carriers",
    number: "6d",
    part: PART,
    title: "Two carriers on one modulator",
    refs: ["chowning", "schottstaedt"],
    steps: [
      {
        title: "Chowning’s second carrier",
        body: (
          <>
            <p>The last figure of Chowning’s paper adds one thing to the simple pair, a second carrier driven by the same modulator. In his example the first carrier and the modulator are both at 300 Hz, and the second carrier is at 2100 Hz, with a fifth of the amplitude and half the index. “The effect”, he writes, “is that of a formant region added to the spectrum”, centred on the seventh harmonic.</p>
            <p>The patch on this page is the same. The second carrier does not add a new pitch, because its sidebands are spaced by the same modulator and therefore belong to the same harmonic series. What it adds is emphasis in one region. If its ratio is changed, the region moves to other harmonics and the note stays where it was.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1), op(1, 0.8, { amp: body }), op(7, 0.16, { amp: body })],
            edges: [edge(0, 1, 2), edge(0, 2, 1)],
          },
        },
        controls: [
          { label: "Formant carrier ratio", path: "ops.2.ratio", min: 2, max: 14, step: 1 },
          { label: "Formant level", path: "ops.2.level", min: 0, max: 0.6, step: 0.01 },
          { label: "Formant width (index 1 → 3)", path: "edges.1.index", min: 0, max: 4, step: 0.05, unit: "rad" },
          { label: "Body index (1 → 2)", path: "edges.0.index", min: 0, max: 5, step: 0.05, unit: "rad" },
        ],
        clip: melody,
        maxRatio: 20,
        predict: {
          question: "The formant carrier is moved from ratio 7 to ratio 10. What changes?",
          options: [
            "The pitch rises, because a louder high operator has been added",
            "The tone becomes inharmonic",
            "The same harmonics are present, and the emphasis moves from about the 7th to about the 10th",
            "Nothing audible",
          ],
          answer: 2,
          explain: (
            <p>The ratio of a carrier decides where its group of sidebands is centred. The ratio of the modulator decides their spacing, and therefore the fundamental. Since both carriers share a modulator at ratio 1, both groups lie on the same harmonic series.</p>
          ),
        },
      },
      {
        title: "Three carriers for a vowel",
        body: (
          <>
            <p>A voice consists of a buzzing source followed by three or four resonances, and the positions of the resonances determine the vowel. Three carriers on one modulator imitate this arrangement directly. Schottstaedt describes an FM voice of this kind, due to Le Brun, with formants near 520, 1190 and 2390 Hz. On this page the carriers are at ratios 2, 5 and 10, which at the pitch of the loop puts them in the same neighbourhood.</p>
            <p>In a real voice a formant keeps its frequency while the pitch changes, whereas a carrier defined by a ratio moves with the note. The vowel on this page is therefore right only near one pitch, and a complete voice patch chooses a different harmonic for each carrier as the note changes. For most purposes in sound design the simpler arrangement is the one wanted, namely a fixed shape of spectrum that follows the keyboard.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { feedback: 0.6 }),
              op(2, 0.7, { amp: env(0.06, 0.4, 0.8, 0.3) }),
              op(5, 0.3, { amp: env(0.06, 0.4, 0.8, 0.3) }),
              op(10, 0.1, { amp: env(0.06, 0.4, 0.8, 0.3) }),
            ],
            edges: [edge(0, 1, 1.2), edge(0, 2, 0.8), edge(0, 3, 0.6)],
          },
        },
        controls: [
          { label: "Formant 1 ratio", path: "ops.1.ratio", min: 1, max: 4, step: 1 },
          { label: "Formant 2 ratio", path: "ops.2.ratio", min: 3, max: 10, step: 1 },
          { label: "Formant 3 ratio", path: "ops.3.ratio", min: 8, max: 16, step: 1 },
          { label: "Formant 2 level", path: "ops.2.level", min: 0, max: 0.6, step: 0.01 },
        ],
        clip: { ...melody, bpm: 80 },
        maxRatio: 20,
        tryThis: [
          <>Ratios of 2, 5 and 10 give something like “ah”. Try 1, 9 and 12 for something nearer “ee”, and 2, 4 and 10 for “oh”.</>,
        ],
      },
    ],
  },
  {
    id: "pairs",
    number: "6e",
    part: PART,
    title: "Independent pairs",
    refs: ["yamaha6", "chowning"],
    steps: [
      {
        title: "A pair for the attack and a pair for the body",
        body: (
          <>
            <p>Most acoustic instruments begin a note with a short sound that is bright, noisy and often inharmonic, and continue with one that is simpler and harmonic. In a piano the first comes from the hammer and the second from the string. A single pair cannot produce both, because one envelope on the index would have to describe two unrelated changes. Two pairs can, and the ear takes them for one event provided that they begin together.</p>
            <p>On this page the pair that supplies the body is a tone at 1 : 1 whose index decays slowly. The pair that supplies the attack has a high and slightly inharmonic modulator, and a carrier that is silent after a fifth of a second. Its level and its index depend strongly on velocity, in accordance with Yamaha’s advice that the attack should be prominent only when the key is struck hard.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { label: "body mod" }),
              op(1, 0.8, { amp: env(0.003, 2, 0.15, 0.4), label: "body" }),
              op(7.1, 0, { label: "attack mod" }),
              op(1, 0.5, { amp: env(0.001, 0.2, 0, 0.15), label: "attack" }),
            ],
            edges: [
              edge(0, 1, 2.2, { env: env(0, 1.2, 0.2, 0.4), velocity: 0.4 }),
              edge(2, 3, 3, { env: env(0, 0.12, 0, 0.1), velocity: 0.9 }),
            ],
          },
        },
        controls: [
          { label: "Attack modulator ratio", path: "ops.2.ratio", min: 2, max: 14, step: 0.01, marks: [3, 7, 7.1, 11.3] },
          { label: "Attack index", path: "edges.1.index", min: 0, max: 8, step: 0.05, unit: "rad" },
          { label: "Attack length", path: "ops.3.amp.d", min: 0.02, max: 1.5, log: true, unit: "s" },
          { label: "Attack level", path: "ops.3.level", min: 0, max: 0.8, step: 0.01 },
          { label: "Body index", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
        ],
        clip: velocityRamp(60),
        maxRatio: 24,
        tryThis: [
          <>An attack ratio of 7 gives the tine of an electric piano, 11.3 gives a glassy tick, and 3 gives a knock on wood.</>,
          <>Lengthen the attack beyond 1 s. The two pairs are then heard as two instruments, because the attack now lasts as long as the body and the ear ceases to take the two for one event.</>,
        ],
      },
      {
        title: "Two pairs detuned",
        body: (
          <>
            <p>Two independent pairs can also be used to thicken a tone. If the second pair is a copy of the first, tuned a fraction of one per cent sharp, the two beat against each other as do the two or three strings of one note on a piano. Brightness remains under separate control, since each pair keeps its own index.</p>
            <p>The well-known electric piano of the DX7 consists of three pairs, one for the body and two for the tine, the last two detuned against each other. The first preset examined in Part E is of this kind.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1),
              op(1, 0.6, { amp: env(0.003, 2.5, 0.2, 0.5), pan: -0.4 }),
              op(1.004),
              op(1.004, 0.6, { amp: env(0.003, 2.5, 0.2, 0.5), pan: 0.4 }),
            ],
            edges: [edge(0, 1, 2, { env: env(0, 1.5, 0.25, 0.5) }), edge(2, 3, 2, { env: env(0, 1.5, 0.25, 0.5) })],
          },
        },
        controls: [
          { label: "Second pair: carrier ratio", path: "ops.3.ratio", min: 0.99, max: 1.02, step: 0.0005 },
          { label: "Second pair: modulator ratio", path: "ops.2.ratio", min: 0.99, max: 1.02, step: 0.0005 },
        ],
        clip: chords,
        tryThis: [
          <>Detune only the modulator of the second pair and leave its carrier at 1. The pitch does not change, but the timbre passes slowly through a cycle. Lesson 8 returns to this.</>,
        ],
      },
    ],
  },
  {
    id: "choosing",
    number: "6f",
    part: PART,
    title: "Choosing a topology",
    refs: ["yamaha6", "chowning", "schottstaedt"],
    steps: [
      {
        title: "What the new operator must do",
        body: (
          <>
            <p>Before adding an operator to a patch, it is worth deciding what the new component of the sound is required to do. The table gives the connection suited to each requirement, and the reason.</p>
            <table>
              <thead>
                <tr><th>If the sound needs</th><th>Use</th><th>Because</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>two components that behave differently in time, such as a click and a tone</td>
                  <td>independent pairs</td>
                  <td>each has its own carrier envelope and its own index envelope</td>
                </tr>
                <tr>
                  <td>two colours on the same pitch, each with its own change of index</td>
                  <td>parallel modulators</td>
                  <td>there is one carrier and two families of sidebands, with the combination tones in addition</td>
                </tr>
                <tr>
                  <td>emphasis in a fixed region, as in a vowel or the resonance of a body</td>
                  <td>parallel carriers</td>
                  <td>the carrier’s ratio places the group, and the shared modulator keeps one pitch</td>
                </tr>
                <tr>
                  <td>density, a noisy beginning, or brightness from a single control</td>
                  <td>series, or feedback</td>
                  <td>the widths multiply, so that a small change at the top alters everything below</td>
                </tr>
              </tbody>
            </table>
            <p>Yamaha’s manual for the DX7 adds a rule that applies equally to every later instrument: begin with the least complex arrangement that will do what is wanted. An operator left unused does no harm, whereas a series that was not needed makes the patch harder to control.</p>
            <p>The bench has all four connections in one patch of six operators, with every index at zero, so that only a sine wave is heard. It may be used to try out answers to the three cases that follow.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { feedback: 0 }),
              op(3),
              op(1, 0.8, { amp: body }),
              op(7),
              op(1, 0, { amp: env(0.001, 0.2, 0, 0.15) }),
              op(6, 0, { amp: body }),
            ],
            edges: [edge(0, 1, 0), edge(0, 2, 0), edge(1, 2, 0), edge(3, 4, 0), edge(0, 5, 0)],
          },
        },
        controls: [
          { label: "1 → 3 (modulator at 1)", path: "edges.1.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "2 → 3 (parallel modulator at 3)", path: "edges.2.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "1 → 2 (makes 2 a chain)", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Feedback on 1", path: "ops.0.feedback", min: 0, max: 1.5, step: 0.01, unit: "rad" },
          { label: "Pair 4 → 5: level", path: "ops.4.level", min: 0, max: 0.8, step: 0.01 },
          { label: "Pair 4 → 5: index", path: "edges.3.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Carrier 6 (formant): level", path: "ops.5.level", min: 0, max: 0.6, step: 0.01 },
          { label: "1 → 6 index", path: "edges.4.index", min: 0, max: 4, step: 0.05, unit: "rad" },
        ],
        clip: phrase,
        maxRatio: 24,
      },
      {
        title: "First case: a marimba",
        body: (
          <>
            <p>A bar of a marimba gives a short knock, like wood being struck, followed by a nearly pure tone that dies away in about a second. The partials of the knock do not belong to the harmonic series of the note.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1),
              op(1, 0.8, { amp: env(0.001, 1.1, 0, 0.3) }),
              op(3.9),
              op(1, 0.5, { amp: env(0.001, 0.09, 0, 0.08) }),
            ],
            edges: [edge(0, 1, 0.9, { env: env(0, 0.25, 0, 0.2) }), edge(2, 3, 2.4, { env: env(0, 0.06, 0, 0.06), velocity: 0.8 })],
          },
        },
        controls: [
          { label: "Knock ratio", path: "ops.2.ratio", min: 2, max: 10, step: 0.01 },
          { label: "Knock index", path: "edges.1.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Knock level", path: "ops.3.level", min: 0, max: 0.8, step: 0.01 },
        ],
        clip: struck,
        predict: {
          question: "Which connection should supply the knock?",
          options: [
            "A second modulator in parallel on the main carrier",
            "A pair of its own, with a very short carrier envelope",
            "A modulator in series above the main modulator",
            "A second carrier sharing the main modulator",
          ],
          answer: 1,
          explain: (
            <p>The knock must be inharmonic, and it must be gone in less than a tenth of a second while the tone continues. Its partials and its behaviour in time both differ from those of the tone, and so it needs a pair of its own. A second modulator on the main carrier would spread inharmonic sidebands through the whole of the tone, and a second carrier on the main modulator would be harmonic.</p>
          ),
        },
      },
      {
        title: "Second case: a brass swell",
        body: (
          <>
            <p>A brass tone is harmonic, and it grows brighter as it grows louder, continuously through the note. When a note is attacked hard there is in addition a brief edge at the top of the spectrum.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [op(1, 0, { feedback: 0.7 }), op(3), op(1, 0.8, { amp: env(0.06, 0.3, 0.8, 0.2) })],
            edges: [
              edge(0, 2, 3.2, { env: env(0.07, 0.3, 0.65, 0.2), velocity: 0.5 }),
              edge(1, 2, 1.2, { env: env(0.03, 0.15, 0.1, 0.1), velocity: 1 }),
            ],
          },
        },
        controls: [
          { label: "Main index (1 → 3)", path: "edges.0.index", min: 0, max: 6, step: 0.05, unit: "rad" },
          { label: "Edge index (2 → 3)", path: "edges.1.index", min: 0, max: 4, step: 0.05, unit: "rad" },
          { label: "Edge decay", path: "edges.1.env.d", min: 0.02, max: 1, log: true, unit: "s" },
        ],
        clip: melody,
        predict: {
          question: "Which connection should supply the edge on notes attacked hard?",
          options: [
            "A pair of its own, mixed with the first",
            "A second modulator at a higher whole-number ratio, in parallel on the same carrier",
            "A second carrier at a high ratio",
            "More feedback on the carrier",
          ],
          answer: 1,
          explain: (
            <p>The edge must be on the same pitch and in the same harmonic series as the rest, and it needs a change of index of its own, short and dependent on velocity, distinct from the slower swell. One carrier with a second index envelope means a second modulator in parallel. A separate pair would also serve, but would be heard as a second instrument added to the first, and a second carrier would give a constant emphasis where a momentary one is wanted.</p>
          ),
        },
      },
      {
        title: "Third case: a vocal pad",
        body: (
          <>
            <p>The sound wanted is a sustained pad with a nasal emphasis, somewhat like that of a voice, about the fifth or sixth harmonic. The emphasis is to stay where it is for as long as the note lasts.</p>
          </>
        ),
        source: {
          kind: "operators",
          patch: {
            ops: [
              op(1, 0, { feedback: 0.5 }),
              op(1, 0.7, { amp: env(0.4, 1, 0.8, 0.9) }),
              op(5, 0.22, { amp: env(0.5, 1, 0.8, 0.9) }),
            ],
            edges: [edge(0, 1, 1.4), edge(0, 2, 0.9)],
          },
        },
        controls: [
          { label: "Emphasis position (carrier ratio)", path: "ops.2.ratio", min: 2, max: 12, step: 1 },
          { label: "Emphasis level", path: "ops.2.level", min: 0, max: 0.6, step: 0.01 },
          { label: "Emphasis width", path: "edges.1.index", min: 0, max: 3, step: 0.05, unit: "rad" },
        ],
        clip: chords,
        predict: {
          question: "How should the emphasis be added?",
          options: [
            "Raise the index of the main pair",
            "Add a modulator at ratio 5 in parallel",
            "Add a second carrier at ratio 5 on the same modulator",
            "Add an operator in series above the modulator",
          ],
          answer: 2,
          explain: (
            <p>Emphasis in a region is obtained from a carrier in that region. A modulator at ratio 5 would do something different, since it would add partials five steps on either side of the fundamental and so alter the whole pattern. Raising the index, or adding a series above the modulator, would brighten the whole spectrum without emphasising any part of it.</p>
          ),
        },
      },
    ],
  },
];
