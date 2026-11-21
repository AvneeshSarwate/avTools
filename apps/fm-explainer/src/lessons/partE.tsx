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
      <p>This is the electric piano of the DX7, and recipe 9.6 was taken from it. Three pairs of operators are mixed, and none affects another. Operators 1 and 2 form the body, with modulator and carrier at the same ratio. Operators 3 and 4, and operators 5 and 6, form two tine pairs, in each of which the modulator is about seven times the carrier.</p>
      <p>The two tine pairs are not tuned alike. Their modulators are at 6.995 and 7, and their carriers at 1.005 and 0.999. Neither pair sounds out of tune when heard alone, but the two beat slowly against each other, and this gives the metallic part of the sound its shimmer. It is the detuning of lesson 6e, applied to the tine and not to the body.</p>
      <p>The envelopes separate the two components in time. The index of the body rises to about 3.6 radians and falls over some four seconds to 29 per cent of that value, whereas the indices of the tines rise to about 2.5 radians and fall to zero in less than half a second. In all three cells the depth knob is almost at zero and the envelope is set to add to it, so that the envelope supplies the whole of the index. Velocity reduces all three envelopes on soft notes, which is why hard notes are rough and soft ones nearly pure.</p>
      <p>The output levels of the two tine carriers are zero in the preset file and are raised by a macro, which gives the player a single control for the amount of tine.</p>
    </>,
    [
      <>Switch off 3 → 4 and 5 → 6. The tine carriers then give plain sine waves, and what is heard is a soft piano whose notes have no distinct beginning.</>,
      <>Switch off 1 → 2 and leave the others on. The body is then a sine wave with the tine above it, which shows that all the roughness of the body came from that one cell.</>,
      <>Play one note softly and then hard, and compare how far the spectrum reaches.</>,
    ],
  ),
  preset(
    "10.2", "preset-4op-bass", "Classic 4op Bass", "Bass/Classic 4op Bass", bassLine,
    <>
      <p>This preset is a single series of four operators. Operator 1, at a ratio of 9, modulates operator 2 at 0.5, which modulates operator 3 at 0.5, which modulates operator 4 at 1, and only operator 4 is heard. It is the connection of lesson 6b with nothing added.</p>
      <p>The half ratios account for the depth of the sound. The partials of a pair are spaced by the modulator’s frequency, so that a modulator at 0.5 places them at 0.5, 1, 1.5, 2 and so on. The carrier is at 1, but the series to which it belongs has its fundamental an octave lower, and the ear hears that lower octave although the only operator heard is not tuned to it.</p>
      <p>The indices are small in the upper stages and larger in the last. The first two cells reach about 0.3 and 0.7 radians, and the third reaches about 3.3 and falls in a third of a second to about 1. Small values suffice above because the widths of successive stages are multiplied. The operator at ratio 9 has scarcely any effect on the sustained tone. Its envelope is short, and what it contributes is a high buzz at the first instant of the note, in the manner of the pick noise of lesson 6b.</p>
    </>,
    [
      <>Switch off 1 → 2. The change is confined to the beginning of each note.</>,
      <>Switch off 2 → 3 as well. The tone is thinner, but the lower octave is still heard, since it depends on the ratio of operator 3 and not on the length of the series.</>,
    ],
    32,
  ),
  preset(
    "10.3", "preset-muted-strat", "Muted Strat", "Guitar/Muted Strat", pluckArp,
    <>
      <p>The preset consists of two series of three operators, panned to opposite sides. In each the ratios are about 8, 0.5 and 0.5, and only the last operator is heard. It follows closely the method that Yamaha’s guide gives for plucked strings, and recipe 9.5 was made from its numbers.</p>
      <p>The two series do different things. In the one on the left, the index into the carrier rises to about 3.9 radians and falls to zero in less than a tenth of a second, and the carrier’s own envelope ends after about a third of a second however long the key is held. This series supplies the pluck. In the one on the right, the index rises to about 2.6 radians and settles at 16 per cent of that, and the carrier lasts as long as the key. This series supplies the string.</p>
      <p>The top operators of the two series are at 8.08 and 8, a small mismatch of the kind used for the tines of the electric piano. The patch plays one note at a time and uses three unison voices, which give the single string some width.</p>
    </>,
    [
      <>Switch off output 3. The beginning of each note loses its edge, and what is left is a soft pluck.</>,
      <>Switch off output 6 and hold a long note. The series on the left is over almost at once, whatever the length of the note.</>,
    ],
    32,
  ),
  preset(
    "10.4", "preset-detuned-metal", "Detuned Metal", "Bells/Detuned Metal", bellTune,
    <>
      <p>Two modulators act in parallel on one carrier. Operators 1 and 2, at ratios of 3.1 and 2.9, both modulate operator 4, at a ratio of 2. Operator 1 is also heard directly, at a low level and with some feedback. This is the patch of the third step of lesson 6c.</p>
      <p>Neither modulator stands in a whole-number ratio to the carrier, and the partials are consequently inharmonic, which gives the metallic sound. The two ratios differ by 0.2 of the note, so that the combination tones described in that lesson lie very close to the other partials and beat against them. Because the difference is a fraction of the note, the beating is faster on higher notes.</p>
      <p>The indices are low, about 1.0 and 0.3 radians at their greatest, and at such values the two families of sidebands are nearly independent. Each has its own envelope. The first falls to zero in about half a second, and the second settles at a quarter of its greatest value. The inharmonic part of the sound therefore diminishes as the note continues, in accordance with Chowning’s premise that the spectrum of a percussive sound goes from the complex to the simple.</p>
    </>,
    [
      <>Switch off 2 → 4. The tone is still metallic, but the slow beating is gone.</>,
      <>Switch off 1 → 4 and leave 2 → 4 on. Only the weaker and longer-lived family of sidebands is then heard.</>,
    ],
    16,
  ),
  preset(
    "10.5", "preset-nostalgic-bell", "Nostalgic Bell Synth", "Keys/Nostalgic Bell Synth", chords,
    <>
      <p>One operator modulates three others, and all four are heard. Operator 1, at the pitch of the note, acts on operators 2, 3 and 4. This is the arrangement of lesson 6d, parallel carriers on one modulator, with the difference that each carrier is treated in its own way.</p>
      <p>Operator 2 is at a ratio of 2.16 and has feedback, and operator 1 modulates its phase at a steady index of about 3 radians. Since 2.16 is not a whole number the result is inharmonic, and it supplies the bell-like body of the sound. Operator 3 is an octave below the note. The envelope of its cell is set to subtract from the depth and not to add to it, so that the index moves in the opposite direction to the usual one, and the colour of this lower layer changes while the note is held. Operator 4 is at a ratio of 10, and its cell is set to ring modulation, with a low-frequency oscillator on the depth.</p>
      <p>Ring modulation is used for the highest carrier for the reason given in lesson 7. Phase modulation at a ratio of 10 would spread a wide group of partials over the top of the spectrum, whereas ring modulation adds exactly two, at 9 and 11, and the oscillator makes them come and go. Operators 5 and 6 are switched on in the preset file but are connected to nothing.</p>
    </>,
    [
      <>Switch off 1 → 4 and attend to the top of the spectrum, from which the partials at 9 and 11 disappear.</>,
      <>Switch off output 2. The bell-like character goes with it, and what is left is a soft organ tone with a faint high component.</>,
    ],
    16,
  ),
  preset(
    "10.6", "preset-supersaw", "Hello Supersaw", "Keys/Hello Supersaw", padChords,
    <>
      <p>This preset makes the thick, bright, slowly beating sound that subtractive synthesizers call a supersaw, and it makes it without the modulation matrix. All six operators are heard, and none modulates another.</p>
      <p>The harmonics come from feedback. Each operator feeds back into its own phase by about 0.3 radians, which adds a few harmonics to the sine wave but is not enough to make a sawtooth. Key velocity is routed to the amount of feedback, so that a harder note pushes every operator further toward a sawtooth and the sound grows brighter as it grows louder.</p>
      <p>The thickness comes from tuning. The operators are set to ratios of 1, 1.005, 1.01, 1.02, 0.995 and 0.99, which places them between 17 cents below the played pitch and 34 cents above it. Tones as close as this are heard as one note that beats, and since the differences are ratios the beating is faster on higher notes. The operators also start at different points in their cycles, so that they do not begin each note in step, and they are panned alternately to left and right, which spreads the beating across the stereo field.</p>
      <p>Because no operator modulates another, the spectrum of the whole is the sum of six spectra, each a harmonic series slightly displaced from the next. Every other preset in this part has at least one matrix cell switched on, and what that cell contributes can be judged by comparison with this one.</p>
    </>,
    [
      <>Switch off the feedback loops one at a time. Each operator then gives a sine wave, and when all six are off the sound is that of six detuned sines, which confirms that feedback was the only source of harmonics.</>,
      <>Play softly and then hard. The harder note is brighter, and the brightness comes from feedback alone.</>,
    ],
    32,
  ),
  preset(
    "10.7", "preset-hihat", "Hihat Closed", "Drums/Hihat Closed", hats,
    <>
      <p>This preset makes a closed hi-hat, which is noise without pitch, and it does so by the method of recipe 9.8 carried as far as the engine allows. The operators form a series, 1 into 2 into 3 into 4, and operator 4 modulates both 5 and 6, which are the two heard most strongly. Operator 1 also modulates operator 3 directly.</p>
      <p>Every setting is chosen to widen the spectrum. Each cell has a depth of 1.0, which is an index of 12.6 radians, and the two cells that leave operator 1 have overdrive switched on, which makes it 126. The feedback of operator 2 is at its greatest value with overdrive, about ten times the limit of stability given in lesson 5. The waveforms are rounded squares and not sines. The ratios are 0.33, 1, 7.96, 15.1, 32 and 32, and the whole patch is transposed up three octaves.</p>
      <p>Since the widths of successive stages are multiplied, and none of the ratios shares a fundamental with another, most of the energy lies beyond half the sample rate and is reproduced at the wrong frequencies. No pitch survives this. The only properties left to be shaped are the envelope, which is short, and the positions of operators 5 and 6, which are panned to opposite sides.</p>
    </>,
    [
      <>Switch off feedback 2, and then 1 → 2. Each step brings the sound nearer to a clang with a pitch.</>,
      <>Switch off 3 → 4. Operators 5 and 6 are then modulated by operator 4 alone, and the tone is harsh but has a pitch.</>,
    ],
    48,
  ),
  preset(
    "10.8", "preset-retro-brass", "Retrofuture Brass", "Keys/Retrofuture Brass", brassLine,
    <>
      <p>Two operators are used, and both are heard. Operator 1, at a ratio of 0.25, modulates operator 4, at 0.5. The carrier is thus at twice the frequency of the modulator, and the result has every harmonic of the lower operator with the greatest weight on the second, which is the nasal ratio of 2 : 1 in the table of lesson 2. The patch is transposed up an octave, so that the carrier is at the pitch of the key and the modulator an octave below it.</p>
      <p>Both operators have feedback at the top of the knob, which is π/2 radians and the limit of Tomisawa’s range. The preset is therefore the brass tone of recipe 9.1 made with operators that resemble sawtooth waves where Chowning’s were sines, and the index of 3.9 radians acts on a modulator that is already bright.</p>
      <p>Three envelopes close the tone after the attack. The feedback of operator 4 falls to zero in about a fifth of a second, that of operator 1 in about half a second, and the index between them in rather less than a second. The brightness thus diminishes in three overlapping stages, of which the fastest gives the bite at the beginning of the note. Three unison voices are used.</p>
    </>,
    [
      <>Switch off 1 → 4. Two sawtooth-like tones an octave apart remain, which are brassy but lack the growl at the beginning.</>,
      <>Switch off feedback 1 only. The modulator then has few harmonics of its own, and the patch is close to Chowning’s brass with a ratio of 2 : 1.</>,
    ],
    32,
  ),
  preset(
    "10.9", "preset-growler", "Growler", "Bass/Growler", low(bassLine, 0),
    <>
      <p>One source feeds the whole patch. Operator 1, at a ratio of 0.25 and with feedback at the top of the knob, modulates operators 2, 3 and 6, and operator 3 also modulates operator 6. Operator 6 therefore receives the source twice, once directly and once after it has passed through operator 3. Operators 2 and 6 are the ones heard.</p>
      <p>The indices are very high, about 9.5 radians into operator 3, 9.2 into operator 6, and 10.5 from operator 3 into operator 6. Values of this size were used in recipe 9.7 for bells and in 9.8 for noise. Here the result remains harmonic, because the ratios, 0.25, 1 and 2, are all octaves of one another, so that every partial is a multiple of the lowest operator however many partials there are.</p>
      <p>The growl comes from the timing of the envelopes. The direct cell into operator 6 takes about a quarter of a second to open, and the cell from operator 3 takes several seconds, so that the spectrum is still widening long after the note has begun. A low-frequency oscillator synchronised to the tempo varies the depth of the cell into operator 2 at the same time. The patch plays one note at a time, glides between notes, and uses two unison voices.</p>
    </>,
    [
      <>Switch off 3 → 6. The later part of the widening is lost, and a held note changes much less.</>,
      <>Switch off feedback 1. Every part of the patch becomes thinner at once, since all of it was fed from this one source.</>,
    ],
    48,
  ),
  preset(
    "10.10", "preset-organ", "Organ", "Keys/Organ", chords,
    <>
      <p>This preset is additive, with one pair added for the click of the key. Operators 1 to 5 are heard at ratios of 1, 2, 3, 4 and 8, and correspond to the drawbars of an organ. Some of them have a little feedback, which adds a few harmonics to each.</p>
      <p>The one matrix cell in use runs from operator 5 to operator 6. Operator 6 is at a ratio of 3.95 and has feedback at the top of the knob, and it is modulated at about 3.8 radians. Its output envelope lasts only about a hundredth of a second, so that the pair is heard as a click at the beginning of each note and not afterwards. The ratio of 3.95 is close to 4 but not equal to it, which keeps the click from merging with the drawbars.</p>
      <p>The preset shows the least use of frequency modulation that is still worth making, namely an additive patch that employs a single pair for a transient, as in lesson 6e.</p>
    </>,
    [
      <>Switch off output 6 and play short notes. Their beginnings are then indistinct.</>,
      <>Switch off outputs 2, 3 and 4 in turn, which corresponds to pushing in drawbars.</>,
    ],
    16,
  ),
  preset(
    "10.11", "preset-five-primes", "Five Primes Bell", "Bells/Five Primes Bell", bellTune,
    <>
      <p>All six operators are heard, at ratios of 1, 2, 3, 5, 7 and 11, and only the lowest three are connected. Operator 1 modulates operators 2 and 3, and operator 2 modulates operator 3. Operators 4, 5 and 6 are plain partials.</p>
      <p>The bell-like quality comes from the choice of ratios. Above the octave only the harmonics with prime numbers are present, and the fourth, sixth, eighth, ninth and tenth are absent. Most of the octaves and fifths that make a tone sound smooth are thereby removed, and the partials, though harmonic, are heard as a bright struck chord. No inharmonic ratio is needed for this.</p>
      <p>The three cells give the sound its movement. Their indices are about 6.3, 4.5 and 6.6 radians, and each has a very slow oscillator on its depth, at a different rate from the others. Operators 1 and 3 have feedback as well. The lower partials consequently vary continually, while the upper three do not change.</p>
    </>,
    [
      <>Switch off all three cells. The bell is then static: its partials are correct, but nothing in it moves.</>,
      <>Remember this sound when reading the next page, which uses the same six ratios.</>,
    ],
    24,
  ),
  preset(
    "10.12", "preset-bowing", "Bowing 1", "Strings/Bowing 1", padChords,
    <>
      <p>The ratios are those of the preceding preset, 1, 2, 3, 5, 7 and 11, and again all six operators are heard. The difference is that every operator now modulates one or more of those after it: 1 modulates 2 and 3, 2 modulates 3, 3 modulates 4 and 5, and 4 and 5 both modulate 6. The series, the parallel modulators and the parallel carriers of Part B are all present at once.</p>
      <p>No one connection is extreme. Each cell has an index between 3 and 5 radians, and every operator has a moderate amount of feedback. The density of the sound comes from the number of paths by which one operator can affect another.</p>
      <p>The envelopes are what make it resemble a bowed string. Most of the cells open slowly, taking between a quarter of a second and nearly four seconds, so that the spectrum continues to fill for some seconds after the note has begun, somewhat as the tone of a string develops while the bow takes hold.</p>
      <p>The two presets together show that the ratios do not determine the instrument. With the same six ratios, one arrangement of cells and envelopes gives a bell and another gives a string. The ratios decide which pitches are present, and the connections and their envelopes decide what kind of thing is heard to be sounding.</p>
    </>,
    [
      <>Switch off 3 → 4 and 3 → 5. The upper half of the network is then cut off from the lower, and the tone moves most of the way toward the bell.</>,
      <>Switch off every cell and every feedback loop, leaving only the outputs. What remains is the static chord of the preceding page.</>,
    ],
    32,
  ),
];
