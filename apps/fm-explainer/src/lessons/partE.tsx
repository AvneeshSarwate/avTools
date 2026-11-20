import {
  bassLine, bellTune, brassLine, chords, epChords, hats, padChords, pluckArp,
} from "./clips";
import type { Clip, Lesson } from "./types";

const PART = "E · Presets taken apart";

// Every page here loads a factory preset from packages/six-sines/ui/presets
// unchanged. The diagram and the stage switches are read from the preset file;
// indices are the file's depths converted to radians (depth x 4 pi).

const preset = (
  number: string,
  id: string,
  title: string,
  path: string,
  clip: Clip,
  body: React.ReactNode,
  tryThis: React.ReactNode[],
  maxRatio = 24,
): Lesson => ({
  id,
  number,
  part: PART,
  title,
  refs: ["sixsines"],
  steps: [{ title, body, source: { kind: "preset", path: `presets/${path}.sxsnp` }, clip, tryThis, maxRatio }],
});

const low = (clip: Clip, semitones: number): Clip => ({
  ...clip,
  notes: clip.notes.map(([p, ...rest]) => [p + semitones, ...rest]) as Clip["notes"],
});

export const partE: Lesson[] = [
  preset(
    "10.1", "preset-dx-piano", "Surge DX Piano Port", "Keys/Surge DX Piano Port", epChords,
    <>
      <p>
        <strong>Topology: three independent pairs.</strong> This is the classic DX electric piano and the reference for
        recipe 9.6. Operators 1 → 2 are the body at 1 : 1. Operators 3 → 4 and 5 → 6 are two tine pairs with the
        modulator at about 7 times the carrier.
      </p>
      <p>
        <strong>Read the numbers.</strong> The two tine pairs are deliberately mismatched: modulators at 6.995 and 7,
        carriers at 1.005 and 0.999. Neither pair is audibly out of tune, but against each other they beat slowly.
        That is lesson 6e’s detuned pairs, applied only to the metallic layer. The tine carriers’ output levels sit
        at zero in the file and are brought up by a macro, which is how the preset offers a tine-amount control.
      </p>
      <p>
        <strong>Envelopes do the rest.</strong> The body’s index peaks near 3.6 rad and settles to about 29% of that.
        The tine indices peak near 2.5 rad and fall to zero. In all three cells the depth knob itself is almost at
        zero and the envelope is set to <em>add</em>, so the envelope is the entire index. Velocity is patched into
        each cell, which is where the bark comes from.
      </p>
    </>,
    [
      <>Switch off 3 → 4 and 5 → 6. What is left is a soft, slightly hollow piano with no attack definition.</>,
      <>Switch off 1 → 2 instead: a pure sine body with the tink on top. The body’s growl was all in that one cell.</>,
      <>Play one note softly and then hard. Watch how far the spectrum reaches in each case.</>,
    ],
  ),
  preset(
    "10.2", "preset-4op-bass", "Classic 4op Bass", "Bass/Classic 4op Bass", bassLine,
    <>
      <p>
        <strong>Topology: one pure chain.</strong> Operator 1 at ratio 9 modulates 2 at ratio 0.5, which modulates 3
        at 0.5, which modulates the only audible operator, 4, at ratio 1. Four operators, one output: the series
        connection of lesson 6b with nothing else.
      </p>
      <p>
        <strong>Why half ratios.</strong> Sidebands are spaced by the modulator, so modulators at 0.5 put partials at
        0.5, 1, 1.5, 2… The carrier is at 1, but the series it sits in has its fundamental an octave lower. The ear
        hears a sub-octave that no operator is actually tuned to.
      </p>
      <p>
        <strong>Small indices, on purpose.</strong> The stages peak at roughly 0.3, 0.7 and 3.3 rad. In a chain the
        reach multiplies, so the upper stages need very little. The ratio-9 operator at the top barely registers in
        the sustained tone; it adds a high buzz to the first instant, the pick-noise trick.
      </p>
    </>,
    [
      <>Switch off 1 → 2. The change is confined to the attack.</>,
      <>Switch off 2 → 3 as well. The bass thins out but the sub-octave stays: it comes from operator 3’s ratio, not from the depth of the chain.</>,
    ],
    32,
  ),
  preset(
    "10.3", "preset-muted-strat", "Muted Strat", "Guitar/Muted Strat", pluckArp,
    <>
      <p>
        <strong>Topology: two three-operator stacks.</strong> 1 → 2 → 3 and 4 → 5 → 6, both with ratios near
        8 → 0.5 → 0.5, panned to opposite sides. It is Yamaha’s attack-stack-plus-body-stack recipe (9.5) almost to
        the letter.
      </p>
      <p>
        <strong>The two stacks have different jobs.</strong> In the left stack the lower cell peaks at 3.9 rad and
        decays to nothing, and its carrier is a one-shot that dies regardless of how long you hold the key. That is
        the pluck. In the right stack the lower cell peaks at 2.6 rad and sustains at 16%, with a carrier that holds.
        That is the string.
      </p>
      <p>
        <strong>Details.</strong> The top operators are at 8.08 and 8, the same mismatch trick as the piano’s tines.
        The patch is monophonic with three unison voices, which is what makes it sound like one string with width.
      </p>
    </>,
    [
      <>Switch off output 3. The note loses its front edge and becomes a soft, organ-like pluck.</>,
      <>Switch off output 6 instead and hold a long note: the left stack alone is over almost at once.</>,
    ],
    32,
  ),
  preset(
    "10.4", "preset-detuned-metal", "Detuned Metal", "Bells/Detuned Metal", bellTune,
    <>
      <p>
        <strong>Topology: two parallel modulators.</strong> Operators 1 (ratio 3.1) and 2 (ratio 2.9) both modulate
        operator 4 (ratio 2). Operator 1 is also heard directly, quietly, with some feedback. This is lesson 6c’s third
        step.
      </p>
      <p>
        <strong>Why 3.1 and 2.9.</strong> Neither ratio is a whole number against the carrier, so the partials are
        inharmonic: metal. And the two differ by 0.2 of the note, so the cross terms put a slow difference tone under
        everything. The roughness speeds up as you play higher because the gap is a ratio.
      </p>
      <p>
        <strong>Low indices.</strong> About 1.0 and 0.3 rad at their peaks. At that level the two sideband families
        are nearly independent, and each has its own envelope: the first decays to zero, the second holds at a
        quarter. The inharmonic content therefore thins out through the note, Chowning’s “from the complex to the
        simple”.
      </p>
    </>,
    [
      <>Switch off 2 → 4. The tone is still metallic but it stops moving.</>,
      <>Switch off 1 → 4 and leave the other. Now only the quieter, longer-lived family remains.</>,
    ],
    16,
  ),
  preset(
    "10.5", "preset-nostalgic-bell", "Nostalgic Bell Synth", "Keys/Nostalgic Bell Synth", chords,
    <>
      <p>
        <strong>Topology: one modulator, three destinations.</strong> Operator 1 is heard, and it also drives
        operators 2, 3 and 4, all of which are heard too. It is the parallel-carrier idea of lesson 6d with a different treatment on each branch. Operators 5 and 6 are switched on in the file but connected to nothing.
      </p>
      <p>
        <strong>Three branches.</strong> Into operator 2 (ratio 2.16, with feedback) it is steady phase modulation
        at about 3 rad: an inharmonic, bell-like body. Into operator 3 (ratio 0.5) the cell’s envelope is inverted,
        so the index moves opposite to the usual direction and the sub-octave layer changes colour as the note
        sustains. Into operator 4 (ratio 10) it is <em>ring</em> modulation, with an LFO on the depth.
      </p>
      <p>
        <strong>Why ring modulation up there.</strong> At ratio 10, phase modulation would spread a wide cluster
        across the top of the spectrum. Ring modulation adds exactly two partials, at 9 and 11, and the LFO fades them
        in and out. A shimmer, placed precisely: lesson 7.
      </p>
    </>,
    [
      <>Switch off 1 → 4 and listen for what leaves the top of the spectrum.</>,
      <>Switch off output 2. The bell character goes with it; what is left is a soft organ with a sparkle.</>,
    ],
    16,
  ),
  preset(
    "10.6", "preset-supersaw", "Hello Supersaw", "Keys/Hello Supersaw", padChords,
    <>
      <p>
        <strong>Topology: none.</strong> Six operators, all heard, and not one matrix cell switched on. The only
        modulation is each operator’s own feedback.
      </p>
      <p>
        <strong>What it is doing.</strong> Feedback at 0.2 of the knob is about 0.3 rad, enough to lean each sine
        toward a saw, and velocity is patched to raise it. The six ratios are 1, 1.005, 1.01, 1.02, 0.995 and 0.99,
        with staggered start phases and alternating pans. Six detuned saws: the “supersaw” of subtractive synths,
        built from feedback operators.
      </p>
      <p>
        <strong>Why it belongs here.</strong> It marks one end of the range. Parallel, non-interacting operators with
        feedback cover a lot of analogue-style territory, and the result is easy to predict because nothing
        intermodulates. Everything else in this part moves away from this by adding cells.
      </p>
    </>,
    [
      <>Switch off the feedback loops one at a time. Each operator falls back to a sine and the stack turns into a drawbar organ.</>,
      <>Play hard and soft. Velocity is brightness here, through feedback, with no cell involved.</>,
    ],
    32,
  ),
  preset(
    "10.7", "preset-hihat", "Hihat Closed", "Drums/Hihat Closed", hats,
    <>
      <p>
        <strong>Topology: a chain, driven as hard as the engine allows.</strong> 1 → 2 → 3 → 4, then 4 into both 5
        and 6, plus 1 → 3. This is recipe 9.8 with every safeguard removed.
      </p>
      <p>
        <strong>The numbers.</strong> Every cell is at depth 1.0, an index of 12.6 rad, and the two cells out of
        operator 1 have overdrive on, which is 126 rad. Operator 2’s feedback is at maximum with overdrive, ten times
        past the stable limit from lesson 5. The ratios are 0.33, 1, 7.96, 15.1, 32 and 32, the waveforms are rounded
        squares, and the whole patch is transposed up three octaves.
      </p>
      <p>
        <strong>Why it is noise.</strong> Every one of those choices multiplies bandwidth, and none of the ratios
        share a fundamental. Most of the energy has been pushed past the top of the audio band and folded back, and
        no pitch survives. The only musical parameters left are the envelope and the two hard-panned outputs.
      </p>
    </>,
    [
      <>Switch off feedback 2, then 1 → 2. You are walking back from noise toward a clang.</>,
      <>Switch off 3 → 4. With the chain cut, operators 5 and 6 are steered only by operator 4 alone: a harsh but pitched tone.</>,
    ],
    48,
  ),
  preset(
    "10.8", "preset-retro-brass", "Retrofuture Brass", "Keys/Retrofuture Brass", brassLine,
    <>
      <p>
        <strong>Topology: one pair, both operators heard.</strong> Operator 1 (ratio 0.25) modulates operator 4
        (ratio 0.5). The carrier is at twice the modulator, so the result has every harmonic of the lower operator
        with the weight on the 2nd: the nasal 2 : 1 row from lesson 2.
      </p>
      <p>
        <strong>Feedback at the limit.</strong> Both operators have feedback at 1.0, which is π/2 rad, the top of
        Tomisawa’s range. So this is the brass recipe (9.1) with saw-like operators where Chowning had sines, and the
        cross-modulation, at 3.9 rad, is working on a modulator that is already bright.
      </p>
      <p>
        <strong>Three decays.</strong> The two feedback loops and the cell each have their own decay to zero, at
        slightly different rates. The tone therefore closes down in three overlapping stages after the attack. The
        patch is raised an octave and uses three unison voices.
      </p>
    </>,
    [
      <>Switch off 1 → 4. Two feedback saws an octave apart: brassy, but the growl in the attack is gone.</>,
      <>Switch off feedback 1 only. The modulator is a sine again, and this becomes Chowning’s brass with a 2 : 1 ratio.</>,
    ],
    32,
  ),
  preset(
    "10.9", "preset-growler", "Growler", "Bass/Growler", low(bassLine, 0),
    <>
      <p>
        <strong>Topology: fan-out plus a chain.</strong> Operator 1 (ratio 0.25, feedback at maximum) drives operators
        2, 3 and 6. Operator 3 also drives operator 6. So the output at 6 receives the same source twice: directly,
        and after it has been through operator 3.
      </p>
      <p>
        <strong>High indices.</strong> About 9.5 rad into operator 3, 9.2 into operator 6 and 10.5 from 3 into 6.
        These are bell-and-noise numbers, kept on the rails by ratios that are all octaves of each other (0.25, 1,
        2), so everything stays harmonic however dense it gets.
      </p>
      <p>
        <strong>The growl is timing.</strong> The cells into operator 6 have slow attacks. The spectrum is still
        opening well after the note has started, and a tempo-synced LFO wobbles the 1 → 2 depth underneath. The patch
        is monophonic with glide and two unison voices.
      </p>
    </>,
    [
      <>Switch off 3 → 6. The late swell disappears and the note sits still.</>,
      <>Switch off feedback 1. Everything downstream thins at once: one saw-like source was feeding the whole patch.</>,
    ],
    48,
  ),
  preset(
    "10.10", "preset-organ", "Organ", "Keys/Organ", chords,
    <>
      <p>
        <strong>Topology: additive, with one pair for the click.</strong> Operators 1 to 5 are heard at ratios 1, 2, 3, 4 and 8. They are drawbars. Small amounts of feedback on some of them add a
        little colour to each.
      </p>
      <p>
        <strong>The one cell.</strong> The top drawbar, operator 5, also modulates operator 6 (ratio 3.95, feedback at maximum) at about 3.8 rad, and operator 6’s output envelope is very short. That pair is the key click and nothing else.
        The off-integer ratio keeps it from blending into the drawbars.
      </p>
      <p>
        <strong>Why it belongs here.</strong> It is the smallest useful dose of FM: an additive patch that borrows
        one pair for a transient. Independent pairs, lesson 6e, reduced to a single cell.
      </p>
    </>,
    [
      <>Switch off output 6 and play staccato. The notes lose their start.</>,
      <>Switch off outputs 2 to 4 in turn: you are pushing drawbars in.</>,
    ],
    16,
  ),
  preset(
    "10.11", "preset-five-primes", "Five Primes Bell", "Bells/Five Primes Bell", bellTune,
    <>
      <p>
        <strong>Topology: additive carriers with a small FM cluster.</strong> All six operators are heard, at ratios
        1, 2, 3, 5, 7 and 11. Only the bottom three are connected: 1 → 2, 1 → 3 and 2 → 3. Operators 4, 5 and 6 are
        plain partials.
      </p>
      <p>
        <strong>The ratios are the bell.</strong> Above the octave only prime-numbered harmonics are present: the
        4th, 6th, 8th, 9th and 10th are missing. That removes most of the octave and fifth doublings that make a tone
        read as smooth, so the partials are harmonic and yet sound struck and bright. No inharmonic ratio is needed.
      </p>
      <p>
        <strong>The cluster adds motion.</strong> The three cells run at roughly 6.3, 4.5 and 6.6 rad, each with a
        very slow LFO on its depth at a different rate, and operators 1 and 3 have feedback. The low partials shift
        continuously while the upper three stay fixed.
      </p>
    </>,
    [
      <>Switch off all three cells. A static additive bell: correct, and lifeless.</>,
      <>Keep this sound in mind for the next page, which uses the same six ratios.</>,
    ],
    24,
  ),
  preset(
    "10.12", "preset-bowing", "Bowing 1", "Strings/Bowing 1", padChords,
    <>
      <p>
        <strong>Topology: a cascading network.</strong> The same prime ratios as the bell, 1, 2, 3, 5, 7 and 11, with
        all six operators heard. This time every operator feeds onward: 1 → 2, 1 → 3, 2 → 3, 3 → 4, 3 → 5, 4 → 6 and
        5 → 6. Series, parallel modulators and parallel carriers all at once.
      </p>
      <p>
        <strong>Moderate everywhere.</strong> Each cell is between 3 and 5 rad and every operator has some feedback.
        No single connection is extreme. The density comes from the number of paths.
      </p>
      <p>
        <strong>The envelopes make it a bow.</strong> Most cells have slow attacks, and they are slower further down
        the cascade. The spectrum fills in from the bottom upward over the first second, the way a bow takes hold of
        a string.
      </p>
      <p>
        <strong>The pairing with the bell.</strong> Same ratios, different routing and envelopes, different
        instrument. If one thing is worth carrying away from this manual it is that the ratios choose the pitch
        material, and the topology and its envelopes choose what kind of object is making the sound.
      </p>
    </>,
    [
      <>Switch off 3 → 4 and 3 → 5. The upper half of the cascade is cut off and the tone moves most of the way back toward the bell.</>,
      <>Switch off everything except the outputs. You are back at the static additive chord of the previous page.</>,
    ],
    32,
  ),
];
