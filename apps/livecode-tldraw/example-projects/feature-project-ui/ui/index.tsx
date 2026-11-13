import { useState } from "react";
import {
  defineEntityShape,
  type EntityShapeComponentProps,
  useLivecodeActions,
  useParamsPresets,
  useParamsValues,
} from "@livecode-ui";

/**
 * A four-bank preset switcher for one params entity. This file is the whole
 * project UI: `shapeUtils` is what the app registers when the project opens.
 *
 * Presets live on the entity (saved with the project, copied by Duplicate),
 * so this component holds no state of its own beyond which mode the buttons
 * are in. `useParamsPresets` re-renders only when the bank changes; a knob
 * being modulated at 60 fps never touches it.
 */
const BANKS = ["A", "B", "C", "D"] as const;
type Mode = "recall" | "save" | "clear";

function PresetBank({ entityName }: EntityShapeComponentProps) {
  const presets = useParamsPresets(entityName);
  const values = useParamsValues(entityName);
  const { recallParamsPreset, setParamsPreset, deleteParamsPreset } =
    useLivecodeActions();
  const [mode, setMode] = useState<Mode>("recall");
  const [last, setLast] = useState<string | null>(null);

  const press = async (bank: string) => {
    if (mode === "save") {
      await setParamsPreset(entityName, bank);
      setMode("recall");
    } else if (mode === "clear") {
      await deleteParamsPreset(entityName, bank);
      setMode("recall");
      if (last === bank) setLast(null);
    } else if (await recallParamsPreset(entityName, bank)) {
      setLast(bank);
    }
  };

  return (
    <div className="preset-bank" data-entity={entityName}>
      <header className="preset-bank__header">
        <strong>presets: {entityName}</strong>
        <span>{values ? `${Object.keys(values).length} params` : "no entity"}</span>
      </header>
      <div className="preset-bank__banks">
        {BANKS.map((bank) => {
          const filled = Object.hasOwn(presets, bank);
          return (
            <button
              key={bank}
              type="button"
              className="preset-bank__bank"
              data-bank={bank}
              data-filled={filled}
              data-active={last === bank}
              disabled={!values || (mode !== "save" && !filled)}
              onClick={() => void press(bank)}
              title={filled ? `preset ${bank}` : `empty bank ${bank}`}
            >
              {bank}
            </button>
          );
        })}
      </div>
      <div className="preset-bank__modes">
        {(["recall", "save", "clear"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            data-mode={candidate}
            data-selected={mode === candidate}
            onClick={() => setMode(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>
      <style>{`
        .preset-bank { display: grid; grid-template-rows: auto 1fr auto; gap: 8px; height: 100%; padding: 10px; box-sizing: border-box; font: 13px/1.3 system-ui, sans-serif; }
        .preset-bank__header { display: flex; justify-content: space-between; gap: 8px; opacity: 0.9; }
        .preset-bank__banks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .preset-bank__bank { font-size: 20px; border-radius: 6px; border: 1px solid #3a4a44; background: #1c2320; color: #9aa6a0; cursor: pointer; }
        .preset-bank__bank[data-filled="true"] { background: #274036; color: #e6fff2; }
        .preset-bank__bank[data-active="true"] { outline: 2px solid #7ee0b0; }
        .preset-bank__bank:disabled { cursor: default; opacity: 0.5; }
        .preset-bank__modes { display: flex; gap: 6px; }
        .preset-bank__modes button { flex: 1; border-radius: 4px; border: 1px solid #3a4a44; background: transparent; color: #cfd8d3; cursor: pointer; }
        .preset-bank__modes button[data-selected="true"] { background: #3a4a44; color: #fff; }
      `}</style>
    </div>
  );
}

export const PresetBankShape = defineEntityShape({
  type: "preset-bank",
  entityType: "params",
  defaultSize: { w: 320, h: 150 },
  defaultEntityName: "project-ui/look",
  component: PresetBank,
});

export const shapeUtils = [PresetBankShape];
