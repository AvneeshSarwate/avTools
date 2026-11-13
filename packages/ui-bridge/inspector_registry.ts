/**
 * InspectorRegistry — singleton registry that tracks all registered UI objects
 * across all adapters (piano roll, animation editor, tweakpane).
 *
 * Each adapter registers entries when bound objects are created, and removes
 * them when destroyed. The inspector UI subscribes to changes.
 */

// === Type Definitions ===

export type ComponentType = 'piano-roll' | 'animation-editor' | 'tweakpane'

export interface RegistryEntry {
  /** Unique name for this entry (e.g. "melody", "My Controls") */
  name: string
  /** Which component type */
  componentType: ComponentType
  /**
   * The base URL of the component's bridge server.
   * The inspector will request session creation through the InspectorServer,
   * which delegates to the adapter's session factory.
   */
  bridgeBaseUrl: string
  /** Timestamp when this entry was registered */
  registeredAt: number
}

// === Registry Messages (sent over inspector WebSocket) ===

export type RegistryMessage =
  | { type: 'registrySnapshot'; entries: RegistryEntry[] }
  | { type: 'entryAdded'; entry: RegistryEntry }
  | { type: 'entryRemoved'; name: string }
  | { type: 'entryUpdated'; entry: RegistryEntry }

// === InspectorRegistry Class ===

export class InspectorRegistry {
  private entries = new Map<string, RegistryEntry>()
  private listeners = new Set<(msg: RegistryMessage) => void>()

  register(entry: RegistryEntry): void {
    const existing = this.entries.has(entry.name)
    this.entries.set(entry.name, entry)
    this.broadcast(existing
      ? { type: 'entryUpdated', entry }
      : { type: 'entryAdded', entry }
    )
  }

  unregister(name: string): void {
    if (this.entries.delete(name)) {
      this.broadcast({ type: 'entryRemoved', name })
    }
  }

  getAll(): RegistryEntry[] {
    return Array.from(this.entries.values())
  }

  get(name: string): RegistryEntry | undefined {
    return this.entries.get(name)
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /** Subscribe to registry changes. Returns unsubscribe function. */
  subscribe(listener: (msg: RegistryMessage) => void): () => void {
    this.listeners.add(listener)
    listener({ type: 'registrySnapshot', entries: this.getAll() })
    return () => this.listeners.delete(listener)
  }

  private broadcast(msg: RegistryMessage): void {
    for (const listener of this.listeners) {
      try { listener(msg) } catch (e) {
        console.error('[InspectorRegistry] Listener error:', e)
      }
    }
  }

  clear(): void {
    const names = [...this.entries.keys()]
    this.entries.clear()
    for (const name of names) {
      this.broadcast({ type: 'entryRemoved', name })
    }
  }
}

// === Singleton ===

const REGISTRY_GLOBAL_KEY = '__inspectorRegistry__'

export function getInspectorRegistry(): InspectorRegistry {
  const g = globalThis as Record<string, unknown>
  if (!g[REGISTRY_GLOBAL_KEY]) {
    g[REGISTRY_GLOBAL_KEY] = new InspectorRegistry()
  }
  return g[REGISTRY_GLOBAL_KEY] as InspectorRegistry
}
