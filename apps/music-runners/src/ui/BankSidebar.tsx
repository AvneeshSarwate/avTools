import { useState } from "react";
import { type Editor, useValue } from "tldraw";
import { Button, TextField } from "./controls/controls";
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
        <Button icon="chevronRight" quiet onClick={() => setCollapsed(false)} title="show banks" />
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
        <span className="ui-caption">banks</span>
        <Button icon="chevronLeft" quiet onClick={() => setCollapsed(true)} title="hide banks" />
      </div>
      {RUNNERS.map((def) => {
        const list = Object.values(banks)
          .filter((bank) => bank.runnerType === def.type)
          .sort((a, b) => a.createdAt - b.createdAt);
        return (
          <section key={def.type} className="bank-group">
            <div className="bank-group__header">
              <span className="ui-caption">{def.label}</span>
              <Button icon="plus" quiet onClick={() => createBank(def.type)} title={`new ${def.label} bank`} />
            </div>
            {list.length === 0 ? <div className="bank-row bank-row--empty">no banks yet</div> : null}
            {list.map((bank) => {
              const used = usage.get(bank.id) ?? 0;
              const isEditing = editing?.id === bank.id;
              return (
                <div key={bank.id} className="bank-row">
                  {isEditing ? (
                    <TextField
                      autoFocus
                      value={editing.draft}
                      onChange={(draft) => setEditing({ id: bank.id, draft })}
                      onCommit={commitRename}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <span
                      className="bank-row__name"
                      title="double-click to rename"
                      onDoubleClick={() => setEditing({ id: bank.id, draft: bank.name })}
                    >
                      {bank.name}
                    </span>
                  )}
                  {isEditing ? null : (
                    <>
                      <span className="bank-row__meta" title={`${bank.notes.length} notes · ${bank.loopLength} beats · ${used} instances`}>
                        {bank.notes.length}n · {bank.loopLength}b{used ? ` · ${used}×` : ""}
                      </span>
                      <span className="bank-row__actions">
                        <Button icon="plus" quiet disabled={!editor} title="new instance using this bank" onClick={() => editor && createInstance(editor, def.type, bank.id)} />
                        <Button icon="copy" quiet title="duplicate bank" onClick={() => duplicateBank(bank.id)} />
                        <Button
                          icon="close"
                          quiet
                          title={used ? "in use by an instance" : "delete bank"}
                          disabled={used > 0}
                          onClick={() => {
                            if (window.confirm(`Delete bank "${bank.name}"?`)) deleteBank(bank.id);
                          }}
                        />
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </aside>
  );
}
