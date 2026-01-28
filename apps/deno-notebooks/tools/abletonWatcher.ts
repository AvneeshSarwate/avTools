import { parseAbletonLiveSetDetailed } from "./alsParsing.ts";
import type { AbletonClip } from "@agentcombine/music-types";

export type AbletonClipLookup = {
  clipsByName: Map<string, AbletonClip>;
  clipsByPosition: Map<string, AbletonClip>;
  clip: (nameOrTrack: string | number, clipSlotNum?: number) => AbletonClip | null;
  listClips: () => string[];
};

function buildLookup(
  clipsByName: Map<string, AbletonClip>,
  clipsByPosition: Map<string, AbletonClip>,
): AbletonClipLookup {
  return {
    clipsByName,
    clipsByPosition,
    clip: (nameOrTrack: string | number, clipSlotNum?: number) => {
      if (typeof nameOrTrack === "string") {
        return clipsByName.get(nameOrTrack) ?? null;
      }
      if (typeof clipSlotNum === "number") {
        const key = `${nameOrTrack}-${clipSlotNum}`;
        return clipsByPosition.get(key) ?? null;
      }
      return null;
    },
    listClips: () => [...clipsByName.keys()].sort(),
  };
}

export class AbletonWatcher {
  #path: string;
  #clipsByName = new Map<string, AbletonClip>();
  #clipsByPosition = new Map<string, AbletonClip>();
  #watcher: Deno.FsWatcher | null = null;
  #updateCallbacks = new Set<() => void>();
  #debounceTimer: number | null = null;
  #isWatching = false;
  #isParsing = false;
  #pendingParse = false;

  constructor(alsPath: string) {
    this.#path = alsPath;
    this.refresh();
    this.#startWatching();
  }

  static async read(alsPath: string): Promise<AbletonClipLookup> {
    const parsed = await parseAbletonLiveSetDetailed(alsPath);
    return buildLookup(parsed.byName, parsed.byPosition);
  }

  get path() {
    return this.#path;
  }

  get isWatching() {
    return this.#isWatching;
  }

  clip(nameOrTrack: string | number, clipSlotNum?: number): AbletonClip | null {
    if (typeof nameOrTrack === "string") {
      return this.#clipsByName.get(nameOrTrack) ?? null;
    }
    if (typeof clipSlotNum === "number") {
      const key = `${nameOrTrack}-${clipSlotNum}`;
      return this.#clipsByPosition.get(key) ?? null;
    }
    return null;
  }

  listClips(): string[] {
    return [...this.#clipsByName.keys()].sort();
  }

  async refresh(): Promise<void> {
    await this.#parseAndStore();
  }

  onUpdate(callback: () => void): () => void {
    this.#updateCallbacks.add(callback);
    return () => this.#updateCallbacks.delete(callback);
  }

  dispose(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#watcher) {
      this.#watcher.close();
      this.#watcher = null;
    }
    this.#updateCallbacks.clear();
    this.#isWatching = false;
  }

  async #parseAndStore(): Promise<void> {
    if (this.#isParsing) {
      this.#pendingParse = true;
      return;
    }
    this.#isParsing = true;
    try {
      const parsed = await parseAbletonLiveSetDetailed(this.#path);
      this.#clipsByName = parsed.byName;
      this.#clipsByPosition = parsed.byPosition;
      this.#updateCallbacks.forEach((cb) => cb());
    } catch (err) {
      console.error("[AbletonWatcher] Failed to parse ALS:", err);
    } finally {
      this.#isParsing = false;
      if (this.#pendingParse) {
        this.#pendingParse = false;
        this.#parseAndStore();
      }
    }
  }

  #startWatching() {
    try {
      this.#watcher = Deno.watchFs(this.#path);
      this.#isWatching = true;
      this.#watchLoop();
    } catch (err) {
      console.error("[AbletonWatcher] Failed to watch ALS file:", err);
    }
  }

  async #watchLoop() {
    if (!this.#watcher) return;
    for await (const event of this.#watcher) {
      if (event.kind !== "modify" && event.kind !== "create") continue;
      if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
      this.#debounceTimer = setTimeout(() => {
        this.#debounceTimer = null;
        this.#parseAndStore();
      }, 150);
    }
  }
}
