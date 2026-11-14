import type { PianoRollHandle } from "../pianoRoll/types";

/**
 * Source roll handles by instance shape id, while the roll is mounted (its
 * section is open). The recorder commits a take through one so the take is a
 * single undo step in that roll; scripts and the console read it too.
 */
export const sourceRollHandles = new Map<string, PianoRollHandle>();
