export interface ParameterChange {
  id: number
  value: number
}
export interface ParametersChangeDetail {
  changes: ParameterChange[]
}
export interface PresetChangeDetail {
  preset: string
  values: Record<string, number>
}
export interface SixSinesEditorEventMap extends HTMLElementEventMap {
  'parameters-change': CustomEvent<ParametersChangeDetail>
  'preset-change': CustomEvent<PresetChangeDetail>
}
export declare class SixSinesEditorElement extends HTMLElement {
  /** Factory asset base, including trailing slash. Defaults beside the module. */
  presetBaseUrl: string
  getPreset(): Uint8Array
  getParameterValues(): Record<string, number>
  /** Silent hydration; clears undo history. Invalid XML throws without mutation. */
  loadPreset(input: string | Uint8Array): void
  /** Silent native-value updates; no undo snapshots. Unknown/nonfinite values ignored. */
  setParameters(changes: ParameterChange[]): void
  addEventListener<K extends keyof SixSinesEditorEventMap>(
    type: K,
    listener: (this: SixSinesEditorElement, event: SixSinesEditorEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void
}
export declare function registerSixSinesEditor(): CustomElementConstructor
declare global {
  interface HTMLElementTagNameMap {
    'six-sines-editor': SixSinesEditorElement
  }
}
