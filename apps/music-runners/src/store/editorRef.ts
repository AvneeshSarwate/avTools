import type { Editor } from "tldraw";

let current: Editor | null = null;

export function setEditor(editor: Editor | null): void {
  current = editor;
}

export function getEditor(): Editor | null {
  return current;
}

export function requireEditor(): Editor {
  if (!current) throw new Error("tldraw editor is not mounted yet");
  return current;
}
