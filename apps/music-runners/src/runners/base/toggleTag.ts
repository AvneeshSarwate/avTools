// Toggle a runner tag on the selected notes: removed when every note has it,
// otherwise added (with the tag's defaults) to the notes without it.
import type { MetadataPanelProps, PianoRollNote } from "../../pianoRoll/types";
import { type TagSpec, tagDefaults, tagValue } from "../runnerTypes";

export function toggleTag(
  tag: TagSpec,
  selected: PianoRollNote[],
  applyMetadata: MetadataPanelProps["applyMetadata"],
): void {
  const ids = selected.map((note) => note.id);
  if (ids.length === 0) return;
  const allHave = selected.every((note) => tagValue(note, tag.key) !== undefined);
  if (allHave) {
    applyMetadata(`Remove ${tag.label}`, ids, (metadata) => {
      if (!metadata) return metadata;
      const next = { ...metadata };
      delete next[tag.key];
      return Object.keys(next).length === 0 ? undefined : next;
    });
  } else {
    applyMetadata(`Add ${tag.label}`, ids, (metadata, note) => {
      const existing = tagValue(note, tag.key);
      if (existing !== undefined) return metadata;
      return { ...(metadata ?? {}), [tag.key]: tagDefaults(tag) };
    });
  }
}
