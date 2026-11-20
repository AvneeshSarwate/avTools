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
            <p>
              With more than two operators there are only four things you can do, and every algorithm on every FM synth
              is a combination of them. Each has a job. The aim of this part is that you can look at a sound you want
              and say which connection it calls for before touching a control.
            </p>
            <p>
              <strong>Series.</strong> A modulates B, B modulates C. The carrier is bent by something that is already
              a complex wave. This is the dense, bright, hard-to-steer connection. Lesson 6b.
            </p>
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
          <p>
            <strong>Parallel modulators.</strong> A and B both modulate C. Two independent sets of sidebands share one
            carrier, and each modulator can have its own ratio and its own envelope. This is the connection for
            sounds with two spectral ingredients that move differently, such as a body and a bite. Lesson 6c.
          </p>
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
          <p>
            <strong>Parallel carriers.</strong> A modulates both B and C, which are both heard. If the carriers sit at
            different ratios, each parks its cluster of sidebands in a different part of the spectrum. That is a
            formant structure: fixed regions of emphasis, the thing that makes a vowel a vowel. Lesson 6d.
          </p>
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
            <p>
              <strong>Independent pairs.</strong> A modulates B, C modulates D, and the two results are mixed. Nothing
              interacts. This is additive synthesis whose partials happen to be FM tones, and it is the workhorse of
              practical patches: one pair for the attack, one for the body, each with its own envelopes. Lesson 6e.
            </p>
            <p className="note">
              Six Sines lets every operator be heard and modulate later ones at once, so these four are not exclusive
              choices there. Several factory presets in Part E are all four at the same time.
            </p>
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
    title: "Series: bandwidth compounds",
    refs: ["schottstaedt", "yamaha6", "sos13"],
    steps: [
      {
        title: "A modulator that is not a sine",
        body: (
          <>
            <p>
              In a chain, the middle operator is already an FM tone by the time it reaches the carrier. Think of it as
              a bundle of sine modulators, one per partial. Each of them wraps its own set of sidebands around the
              carrier. Schottstaedt describes each component of the lower pair as surrounded by the spectrum of the upper pair, “sort of like a set of formant regions”.
            </p>
            <p>
              The practical consequence is that the two indices multiply in effect. Small numbers at each stage produce
              a wide spectrum, and a small move at the top of the chain moves everything below it.
            </p>
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
            "With the top index at 0 this is a plain pair at index 2, reaching about tick 4. You raise the top index to 2 as well. Roughly how far does the spectrum now reach?",
          options: ["Still about tick 4", "About tick 6: the indices add", "About tick 10 or beyond: the reach multiplies", "It becomes inharmonic"],
          answer: 2,
          explain: (
            <p>
              The middle operator at index 2 has partials up to about its 3rd harmonic. Each one modulates the carrier:
              the 3rd harmonic acts as a modulator at ratio 3, and <M>m · (I + 1)</M> with <M>m = 3</M> reaches three
              times as far as the fundamental does. All ratios are whole numbers, so it stays harmonic.
            </p>
          ),
        },
        tryThis: [
          <>Hold the bottom index at 1 and sweep only the top one. The whole spectrum breathes from one control. That is why chains make good “one knob” brightness.</>,
        ],
      },
      {
        title: "Why chains make attacks",
        body: (
          <>
            <p>
              Because a chain is so sensitive, a fast envelope at its top produces a burst of dense, rapidly changing
              partials and then gets out of the way. That is a good description of the first few milliseconds of a
              plucked or struck string. Yamaha’s guide goes as far as saying a realistic plucked string is nearly impossible without a stack, and gives the recipe: very short envelopes on the stack, and velocity
              sensitivity so that it only speaks when the key is hit hard.
            </p>
            <p>
              The top operator here is at ratio 8 with a small index. It contributes almost nothing once the note is
              sounding. In the attack it roughens the middle operator, which roughens the carrier.
            </p>
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
          <>Set the top index to 0, then bring it back. Listen only to the first instant of each note.</>,
          <>Lengthen the top decay to 1 s. The pick noise turns into a buzz that never leaves: chains want short envelopes.</>,
        ],
      },
      {
        title: "The limit, and the shortcut",
        body: (
          <>
            <p>
              Chains do not scale. Each stage multiplies the bandwidth of the one above, so by the third or fourth
              stage at moderate indices the partials are past the top of the audio band, folding back as aliasing, and
              the ear hears noise. Yamaha’s author says of an eight-operator single stack that he cannot imagine a
              practical use for it.
            </p>
            <p>
              And you rarely need the depth. An operator with feedback is, in effect, an endless chain of itself at
              ratio 1. This bench has both: a three-deep chain, and a single modulator with feedback. Try to match
              them.
            </p>
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
          <>Note the chain’s spectrum. Zero both chain indices, then use the last two sliders to get the same reach from operator 3 alone. About 1.0 of feedback and 1.6 of index is close.</>,
        ],
      },
    ],
  },
  {
    id: "parallel-modulators",
    number: "6c",
    part: PART,
    title: "Parallel modulators: sums, until they are not",
    refs: ["schottstaedt", "sos13", "yamaha6"],
    steps: [
      {
        title: "At low index it looks additive",
        body: (
          <>
            <p>
              Two modulators into one carrier. Popular guides describe the result as the sum of the two modulated
              waveforms: Sound On Sound’s Synth Secrets says so, and Yamaha’s FM 101 says much the same. With both indices low that is a fair description. Modulator 1 at
              ratio 1 gives the carrier neighbours at 2 and 3. Modulator 2 at ratio 5 gives it neighbours at 4 and 6.
              You can see both families and nothing else.
            </p>
            <p>
              Keep both indices under 1 for now and confirm that each slider controls its own family.
            </p>
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
        title: "Raise the index: combination tones",
        body: (
          <>
            <p>
              The sum picture is wrong in general, and it matters. The two modulators are added <em>inside</em> the
              sine, not after it, and a sine of a sum is not a sum of sines. The true spectrum has a partial at{" "}
              <M>c + k·m₁ + l·m₂</M> for every pair of whole numbers <M>k</M> and <M>l</M>, with a height that is the{" "}
              <em>product</em> of two Bessel terms, <M>J_k(I₁) · J_l(I₂)</M>. Schottstaedt calls the cross terms
              “sum and difference tones (intermodulation products)”.
            </p>
            <p>
              At low index the product is tiny unless one of <M>k</M>, <M>l</M> is zero, which is why the sum picture
              worked. Raise both and the cross terms fill the gaps. The orange bars use the product formula.
            </p>
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
            "Modulators at ratios 1 and 5, both raised to an index of 2. Under the “sum of two FM tones” picture you would see partials around 1–3 and at 1, 4, 6, 9, 11. What will actually appear?",
          options: [
            "Exactly those two families",
            "Those, plus clusters around 6 and 11 (each ratio-5 sideband grows its own ratio-1 neighbours)",
            "Only the ratio-5 family, because the higher modulator dominates",
            "Noise",
          ],
          answer: 1,
          explain: (
            <p>
              Every sideband from the ratio-5 modulator is itself surrounded by the ratio-1 family: 6 ± 1, 6 ± 2,
              11 ± 1 and so on. Compare with the series connection, where the spectrum reached further at the same
              indices. Parallel modulators spread energy <em>between</em> the partials you already have; a chain pushes
              it <em>outward</em>.
            </p>
          ),
        },
      },
      {
        title: "Two close ratios: built-in beating",
        body: (
          <>
            <p>
              The cross terms have a musical use. Give the two modulators nearly equal ratios, here 3.1 and 2.9, and
              the difference tone <M>m₁ − m₂</M> is a very low frequency: 0.2 of the note. Every partial acquires
              neighbours that close, and you hear a rough, slowly churning metal. Because the gap is a ratio and not a
              fixed number of hertz, the churn speeds up as you play higher.
            </p>
            <p>
              Each modulator has its own decay here, so the texture changes over the note. That per-ingredient
              envelope control is the reason to choose parallel modulators over a chain. The factory preset “Detuned
              Metal” in Part E is this patch.
            </p>
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
          <>Bring the two ratios together until they meet. The churn slows and stops.</>,
          <>Zero one index. Inharmonic still, but static: no beating without the second modulator.</>,
        ],
      },
    ],
  },
  {
    id: "parallel-carriers",
    number: "6d",
    part: PART,
    title: "Parallel carriers: formants",
    refs: ["chowning", "schottstaedt"],
    steps: [
      {
        title: "Chowning’s second carrier",
        body: (
          <>
            <p>
              The last figure in Chowning’s 1973 paper adds one thing to the basic pair: a second carrier driven by the
              same modulator. His numbers were a 300 Hz carrier and 300 Hz modulator, plus a second carrier at 2100 Hz
              at one fifth the amplitude with its index scaled by a half. “The effect”, he writes, “is that of a
              formant region added to the spectrum”, centred on the 7th harmonic.
            </p>
            <p>
              That is the patch below. The second carrier does not add a new pitch, because its sidebands are spaced by
              the same modulator and so fall on the same harmonic series. It adds a <em>region</em>. Move the second
              carrier’s ratio and the bump slides along the harmonics without changing what note you hear.
            </p>
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
          question: "You move the formant carrier from ratio 7 to ratio 10. What changes?",
          options: [
            "The pitch rises, because a louder high operator has been added",
            "The tone becomes inharmonic",
            "The same harmonics are present; the emphasis moves from around the 7th to around the 10th",
            "Nothing audible",
          ],
          answer: 2,
          explain: (
            <p>
              Carrier ratio sets where a cluster is centred. Modulator ratio sets the spacing, and therefore the
              fundamental. With a shared modulator at ratio 1 every cluster sits on the same harmonic series.
            </p>
          ),
        },
      },
      {
        title: "Three formants make a vowel",
        body: (
          <>
            <p>
              A voice is a buzzing source filtered by three or four resonances whose positions define the vowel. Three
              carriers on one modulator imitate that directly: Schottstaedt’s page describes Le Brun’s FM voice with
              formants near 520, 1190 and 2390 Hz. Here the carriers are at ratios 2, 5 and 10, which at the pitch of
              the loop is the same neighbourhood.
            </p>
            <p>
              A real formant stays put in hertz while the pitch moves. A ratio-based carrier moves with the note, so
              this vowel is only correct near one pitch. A full voice patch re-picks each carrier’s harmonic as the
              note changes. For sound design the ratio version is often what you want anyway: a fixed <em>shape</em>{" "}
              that follows the keyboard.
            </p>
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
          <>Formants at 2, 5, 10 lean toward “ah”. Try 1, 9, 12 for something nearer “ee”, and 2, 4, 10 for “oh”.</>,
        ],
      },
    ],
  },
  {
    id: "pairs",
    number: "6e",
    part: PART,
    title: "Independent pairs: attack and body",
    refs: ["yamaha6", "chowning"],
    steps: [
      {
        title: "Two envelopes, two jobs",
        body: (
          <>
            <p>
              Most acoustic instruments have a noisy, bright, inharmonic start and a simpler, harmonic sustain: the
              hammer and then the string, the tongue and then the reed. A single pair cannot do both, because one
              index envelope would have to describe two unrelated things. Two pairs can, and the ear fuses them into
              one event as long as they start together.
            </p>
            <p>
              The body pair is a 1 : 1 tone with a slow index decay. The attack pair is a high, slightly inharmonic
              modulator on a carrier that is gone in a fifth of a second. Its level and index respond strongly to
              velocity, following Yamaha’s advice that the attack component should be prominent only when the keys are struck hard.
            </p>
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
          <>Attack ratio 7 gives a tine (electric piano). 11.3 gives a glassy tick. 3 gives a wooden knock.</>,
          <>Stretch the attack length past 1 s. The two pairs stop fusing and you hear two instruments.</>,
        ],
      },
      {
        title: "Detune the pairs against each other",
        body: (
          <>
            <p>
              Independent pairs have a second use: thickness. Two copies of the same pair, one a fraction of a percent
              sharp, beat against each other the way two strings of a piano note or two players in a section do. This
              costs nothing in brightness control, because each pair still has its own index.
            </p>
            <p>
              The classic DX electric piano is three pairs: one body, and two tine pairs detuned against each other.
              Part E opens with exactly that.
            </p>
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
          <>Detune only the modulator of the second pair and leave its carrier at 1. The pitch stays put but the timbre slowly cycles. Lesson 8 returns to this.</>,
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
        title: "Four questions",
        body: (
          <>
            <p>Before reaching for an operator, ask what the new ingredient has to do.</p>
            <table>
              <thead>
                <tr><th>If the sound needs…</th><th>Use</th><th>Because</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>two ingredients with different time behaviour (click + tone)</td>
                  <td>independent pairs</td>
                  <td>each gets its own carrier envelope and index envelope</td>
                </tr>
                <tr>
                  <td>two colours on one pitch centre, each with its own index contour</td>
                  <td>parallel modulators</td>
                  <td>one carrier, separate sideband families, cross terms as a bonus</td>
                </tr>
                <tr>
                  <td>a fixed region of emphasis, a vowel, a body resonance</td>
                  <td>parallel carriers</td>
                  <td>carrier ratio places a cluster; shared modulator keeps one pitch</td>
                </tr>
                <tr>
                  <td>density, a noisy transient, one-gesture brightness</td>
                  <td>series, or feedback</td>
                  <td>bandwidth multiplies; a small move at the top moves everything</td>
                </tr>
              </tbody>
            </table>
            <p>
              Yamaha’s DX7 manual adds a rule that survives every synth since: start with the least complex algorithm
              that will do the job. An unused operator costs nothing. A chain you did not need costs you control.
            </p>
            <p>
              The bench has all four connections available in one six-operator patch, with everything off but a sine.
              Use it as a scratchpad for the questions in the next three steps.
            </p>
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
        title: "Case: a marimba",
        body: (
          <p>
            A marimba bar gives a short woody knock and then a nearly pure tone that dies in about a second. The knock
            is not part of the harmonic series of the note.
          </p>
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
          question: "Which connection suits the knock?",
          options: [
            "A second modulator in parallel on the main carrier",
            "Its own pair, with a very short carrier envelope",
            "A modulator stacked in series above the main modulator",
            "A second carrier sharing the main modulator",
          ],
          answer: 1,
          explain: (
            <p>
              The knock has to be inharmonic and has to vanish in under a tenth of a second while the tone rings on.
              Different pitch content and different time behaviour: independent pair. A parallel modulator would
              smear inharmonic sidebands across the ringing tone, and a second carrier on the shared modulator would
              stay harmonic.
            </p>
          ),
        },
      },
      {
        title: "Case: a brass section swell",
        body: (
          <p>
            A brass tone is harmonic, and it gets brighter as it gets louder, continuously, across the whole note. On
            hard attacks there is extra edge in the very top of the spectrum.
          </p>
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
          question: "The extra edge on hard attacks: where does it go?",
          options: [
            "Its own pair, mixed in",
            "A second modulator at a higher whole-number ratio, in parallel on the same carrier",
            "A second carrier at a high ratio",
            "More feedback on the carrier",
          ],
          answer: 1,
          explain: (
            <p>
              It must stay on the same pitch centre and the same harmonic series, and it needs its own contour
              (short, velocity-driven) separate from the main swell. Same carrier, separate index envelope: parallel
              modulator. A separate pair would work too but would sound like a layered second instrument; a second
              carrier would give a static bump, not an attack.
            </p>
          ),
        },
      },
      {
        title: "Case: a hollow, vocal pad",
        body: (
          <p>
            A sustained pad with a nasal, slightly vocal emphasis around the 5th or 6th harmonic that does not move as
            the note sustains.
          </p>
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
          question: "How do you add the emphasis?",
          options: [
            "Raise the index of the main pair",
            "Add a modulator at ratio 5 in parallel",
            "Add a second carrier at ratio 5 on the same modulator",
            "Add a chain above the modulator",
          ],
          answer: 2,
          explain: (
            <p>
              A region of emphasis is a carrier. A modulator at ratio 5 would instead add partials 5 steps either side
              of the fundamental, changing the overall pattern. Raising the index or adding a chain brightens
              everything, with no bump.
            </p>
          ),
        },
      },
    ],
  },
];
