import { useMemo, useState } from "react";
import {
  defineEntityShape,
  type EntityShapeComponentProps,
  type ParamsValues,
  T,
  useLivecodeActions,
  useParamsPresets,
  useParamsValues,
} from "@livecode-ui";

/**
 * Named presets for one params entity: type a name and press set to save the
 * current values under it, pick a preset to load it, and see every leaf of
 * the loaded preset beside the live value, with the ones that have drifted
 * marked dirty. The loaded name lives in a shape prop so it survives a
 * reload; the presets themselves live on the entity and save with the
 * project.
 */
interface Extra {
  loadedPreset: string;
}

type Leaf = { path: string; preset: unknown; current: unknown; dirty: boolean };

function flatten(values: ParamsValues | null, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!values) return out;
  for (const [key, value] of Object.entries(values)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      for (const [k, v] of flatten(value as ParamsValues, path)) out.set(k, v);
    } else out.set(path, value);
  }
  return out;
}

function show(value: unknown): string {
  return typeof value === "number" ? String(Math.round(value * 1000) / 1000) : String(value);
}

function PresetSwitcher({ shape, entityName, editor }: EntityShapeComponentProps<Extra>) {
  const presets = useParamsPresets(entityName);
  const values = useParamsValues(entityName);
  const { setParamsPreset, deleteParamsPreset, recallParamsPreset } = useLivecodeActions();
  const [name, setName] = useState("");
  const loaded = shape.props.loadedPreset;
  const loadedValues = Object.hasOwn(presets, loaded) ? presets[loaded] : null;

  const setLoaded = (next: string) =>
    editor.updateShape({ id: shape.id, type: shape.type, props: { loadedPreset: next } } as never);

  const leaves = useMemo<Leaf[]>(() => {
    const current = flatten(values);
    const preset = flatten(loadedValues);
    const paths = [...new Set([...preset.keys(), ...current.keys()])].sort();
    return paths.map((path) => ({
      path,
      preset: preset.get(path),
      current: current.get(path),
      dirty: loadedValues !== null && preset.has(path) && !Object.is(preset.get(path), current.get(path)),
    }));
  }, [values, loadedValues]);
  const dirtyCount = leaves.filter((leaf) => leaf.dirty).length;
  const target = name.trim() || loaded;

  const save = async () => {
    if (!target) return;
    await setParamsPreset(entityName, target);
    setLoaded(target);
    setName("");
  };
  const load = async (label: string) => {
    if (!label) return;
    if (await recallParamsPreset(entityName, label)) setLoaded(label);
  };
  const remove = async () => {
    if (!loaded) return;
    await deleteParamsPreset(entityName, loaded);
    setLoaded("");
  };

  return (
    <div className="preset-switcher" data-entity={entityName} data-dirty={dirtyCount > 0}>
      <header>
        <strong>presets: {entityName}</strong>
        <span className="preset-switcher__state">
          {!values ? "no entity" : !loaded ? "nothing loaded" : loadedValues === null
            ? `${loaded} (deleted)`
            : dirtyCount ? `${loaded} · ${dirtyCount} changed` : `${loaded} · saved`}
        </span>
      </header>
      <div className="preset-switcher__controls">
        <select
          data-role="load"
          value={loadedValues ? loaded : ""}
          disabled={!values}
          onChange={(event) => void load(event.target.value)}
        >
          <option value="">load preset…</option>
          {Object.keys(presets).sort().map((label) => (
            <option key={label} value={label}>{label}</option>
          ))}
        </select>
        <input
          data-role="name"
          placeholder={loaded ? `name (blank = update ${loaded})` : "preset name"}
          value={name}
          disabled={!values}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void save(); }}
        />
        <button type="button" data-role="set" disabled={!values || !target} onClick={() => void save()}>
          set
        </button>
        <button type="button" data-role="delete" disabled={!loadedValues} onClick={() => void remove()} title="delete loaded preset">
          ×
        </button>
      </div>
      <table className="preset-switcher__leaves">
        <thead><tr><th>param</th><th>preset</th><th>now</th></tr></thead>
        <tbody>
          {leaves.map((leaf) => (
            <tr key={leaf.path} data-path={leaf.path} data-dirty={leaf.dirty}>
              <td>{leaf.path}</td>
              <td>{leaf.preset === undefined ? "–" : show(leaf.preset)}</td>
              <td>{leaf.current === undefined ? "–" : show(leaf.current)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`
        .preset-switcher { display: grid; grid-template-rows: auto auto 1fr; gap: 6px; height: 100%; padding: 8px 10px; box-sizing: border-box; font: 12px/1.3 system-ui, sans-serif; }
        .preset-switcher header { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
        .preset-switcher__state { opacity: 0.8; }
        .preset-switcher[data-dirty="true"] .preset-switcher__state { color: #ffcf6e; }
        .preset-switcher__controls { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 6px; }
        .preset-switcher__controls select, .preset-switcher__controls input, .preset-switcher__controls button { min-width: 0; padding: 3px 6px; border-radius: 4px; border: 1px solid #3a4a44; background: #1c2320; color: #eef5f1; font: inherit; }
        .preset-switcher__controls button { cursor: pointer; }
        .preset-switcher__controls button:disabled { opacity: 0.5; cursor: default; }
        .preset-switcher__leaves { width: 100%; border-collapse: collapse; overflow: auto; display: block; }
        .preset-switcher__leaves th, .preset-switcher__leaves td { text-align: left; padding: 1px 6px 1px 0; white-space: nowrap; }
        .preset-switcher__leaves th { opacity: 0.6; font-weight: normal; }
        .preset-switcher__leaves tr[data-dirty="true"] td { color: #ffcf6e; }
      `}</style>
    </div>
  );
}

export const PresetSwitcherShape = defineEntityShape<Extra>({
  type: "sonar-preset-switcher",
  entityType: "params",
  defaultSize: { w: 360, h: 300 },
  props: { loadedPreset: T.string },
  defaultProps: { loadedPreset: "" },
  component: PresetSwitcher,
});

export const shapeUtils = [PresetSwitcherShape];
