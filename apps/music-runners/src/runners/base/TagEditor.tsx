// Schema-driven metadata editor: the runner's tags as chips over the selected
// notes, with field inputs when every selected note carries the tag. Rendered
// through the piano roll's metadata panel slot, above the generic tree editor.
import { useEffect, useState } from "react";
import { Field, NumberBox, TextField, Toggle } from "../../ui/controls/controls";
import type { JsonObject, MetadataPanelProps, PianoRollNote } from "../../pianoRoll/types";
import { type RunnerDefinition, type TagFieldSpec, type TagSpec, tagDefaults, tagValue } from "../runnerTypes";

export interface TagEditorProps extends MetadataPanelProps {
  def: RunnerDefinition;
}

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

function fieldValue(note: PianoRollNote, tag: TagSpec, field: TagFieldSpec): unknown {
  const value = tagValue(note, tag.key);
  if (!value || value === true) return undefined;
  return value[field.key] ?? field.default;
}

function sharedValue(selected: PianoRollNote[], tag: TagSpec, field: TagFieldSpec): { mixed: boolean; value: unknown } {
  const values = selected.map((note) => JSON.stringify(fieldValue(note, tag, field)));
  const mixed = new Set(values).size > 1;
  return { mixed, value: mixed ? undefined : fieldValue(selected[0], tag, field) };
}

function FieldInput({ tag, field, selected, applyMetadata }: { tag: TagSpec; field: TagFieldSpec } & MetadataPanelProps) {
  const { mixed, value } = sharedValue(selected, tag, field);
  const ids = selected.map((note) => note.id);
  const setField = (next: unknown) => {
    applyMetadata(`Set ${tag.label}.${field.label}`, ids, (metadata) => {
      const current = metadata?.[tag.key];
      const base: JsonObject = current && typeof current === "object" && !Array.isArray(current) ? (current as JsonObject) : {};
      return { ...(metadata ?? {}), [tag.key]: { ...base, [field.key]: next } };
    });
  };
  // Text-ish fields keep a draft so typing is not interrupted by re-renders.
  const textual = field.kind === "numberList" || field.kind === "string";
  const asText = (): string => {
    if (mixed) return "";
    if (field.kind === "numberList") return Array.isArray(value) ? (value as number[]).join(", ") : "";
    return typeof value === "string" ? value : "";
  };
  const [draft, setDraft] = useState(asText);
  const signature = JSON.stringify([value, mixed, ids]);
  useEffect(() => {
    setDraft(asText());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const commitText = () => {
    if (field.kind === "numberList") {
      const list = draft
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      setField(list);
    } else {
      setField(draft);
    }
  };

  if (field.kind === "boolean") {
    return (
      <span className="tag-field">
        <Toggle label={field.label} on={!mixed && Boolean(value)} mixed={mixed} onChange={(on) => setField(on)} />
      </span>
    );
  }
  if (field.kind === "number") {
    return <NumberField field={field} mixed={mixed} value={typeof value === "number" ? value : null} onCommit={setField} />;
  }
  return (
    <Field label={field.label}>
      <TextField
        className="tag-field__text"
        value={draft}
        placeholder={mixed ? "mixed" : textual && field.kind === "numberList" ? "60, 64, 67" : ""}
        onChange={setDraft}
        onCommit={commitText}
      />
    </Field>
  );
}

/** A number field that previews a drag locally and writes one undoable edit at its end. */
function NumberField({
  field,
  mixed,
  value,
  onCommit,
}: {
  field: Extract<TagFieldSpec, { kind: "number" }>;
  mixed: boolean;
  value: number | null;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [value, mixed]);
  return (
    <span className="tag-field">
      <Field label={field.label}>
        <NumberBox
          value={draft ?? (mixed ? null : value ?? field.default)}
          placeholder="mixed"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={setDraft}
          onCommit={onCommit}
        />
      </Field>
    </span>
  );
}

export function TagEditor({ def, selected, applyMetadata }: TagEditorProps) {
  if (selected.length === 0) return <div className="tag-editor tag-editor--empty">select notes to tag them</div>;
  return (
    <div className="tag-editor">
      {def.tags.map((tag) => {
        const count = selected.filter((note) => tagValue(note, tag.key) !== undefined).length;
        const state = count === 0 ? "none" : count === selected.length ? "all" : "some";
        return (
          <div key={tag.key} className={`tag-row tag-row--${state}`}>
            <button
              type="button"
              className="tag-chip"
              data-control
              style={tag.color ? ({ "--tag-color": tag.color } as React.CSSProperties) : undefined}
              title={tag.hotkey ? `hotkey: ${tag.hotkey}` : undefined}
              onClick={() => toggleTag(tag, selected, applyMetadata)}
            >
              {tag.label}
              {tag.hotkey ? <kbd>{tag.hotkey}</kbd> : null}
              {state === "some" ? <small>{count}/{selected.length}</small> : null}
            </button>
            {state === "all" && tag.fields.length > 0 ? (
              <div className="tag-fields">
                {tag.fields.map((field) => (
                  <FieldInput key={field.key} tag={tag} field={field} selected={selected} applyMetadata={applyMetadata} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
