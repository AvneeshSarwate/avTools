import { useState } from "react";
import { type Editor, useValue } from "tldraw";
import { RUNNERS } from "../runners/registry";
import { createInstance, listInstances } from "../shapes";
import { banksStore, createBank, deleteBank, duplicateBank, renameBank } from "../store/banks";
import { useSnapshot } from "valtio";

export function BankSidebar({ editor }: { editor: Editor | null }) {
  const banks = useSnapshot(banksStore).banks;
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Which banks are referenced by instance shapes, kept reactive to the canvas.
  const usage = useValue(
    "bank usage",
    () => {
      const counts = new Map<string, number>();
      if (!editor) return counts;
      for (const instance of listInstances(editor)) {
        counts.set(instance.props.bankId, (counts.get(instance.props.bankId) ?? 0) + 1);
      }
      return counts;
    },
    [editor],
  );

  if (collapsed) {
    return (
      <aside className="bank-sidebar bank-sidebar--collapsed">
        <button type="button" onClick={() => setCollapsed(false)} title="show banks">
          ▸ banks
        </button>
      </aside>
    );
  }

  const commitRename = () => {
    if (editing && editing.draft.trim()) renameBank(editing.id, editing.draft.trim());
    setEditing(null);
  };

  return (
    <aside className="bank-sidebar">
      <div className="bank-sidebar__header">
        <strong>banks</strong>
        <button type="button" onClick={() => setCollapsed(true)} title="hide">
          ◂
        </button>
      </div>
      {RUNNERS.map((def) => {
        const list = Object.values(banks)
          .filter((bank) => bank.runnerType === def.type)
          .sort((a, b) => a.createdAt - b.createdAt);
        return (
          <section key={def.type} className="bank-group">
            <div className="bank-group__header">
              <span>{def.label}</span>
              <button type="button" onClick={() => createBank(def.type)} title="new bank of this type">
                + bank
              </button>
            </div>
            {list.length === 0 ? <div className="bank-row bank-row--empty">none yet</div> : null}
            {list.map((bank) => {
              const used = usage.get(bank.id) ?? 0;
              const isEditing = editing?.id === bank.id;
              return (
                <div key={bank.id} className="bank-row">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editing.draft}
                      onChange={(e) => setEditing({ id: bank.id, draft: e.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button type="button" className="bank-row__name" title="rename" onClick={() => setEditing({ id: bank.id, draft: bank.name })}>
                      {bank.name}
                    </button>
                  )}
                  <span className="bank-row__meta">
                    {bank.notes.length}n · {bank.loopLength}b{used ? ` · ${used} inst` : ""}
                  </span>
                  <span className="bank-row__actions">
                    <button type="button" disabled={!editor} title="new instance using this bank" onClick={() => editor && createInstance(editor, def.type, bank.id)}>
                      + inst
                    </button>
                    <button type="button" title="duplicate" onClick={() => duplicateBank(bank.id)}>
                      dup
                    </button>
                    <button
                      type="button"
                      title={used ? "in use by an instance" : "delete"}
                      disabled={used > 0}
                      onClick={() => {
                        if (window.confirm(`Delete bank "${bank.name}"?`)) deleteBank(bank.id);
                      }}
                    >
                      ×
                    </button>
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}
    </aside>
  );
}
