// fast_sleep.ts
type Strategy = "default" | "yield" | "spin";

function dylibUrl(): URL {
  const base = new URL("../native/fastsleep/target/release/", import.meta.url);

  // Cargo output names differ slightly on Windows; try both.
  const os = Deno.build.os;
  const candidates =
    os === "windows"
      ? ["fastsleep.dll", "libfastsleep.dll"]
      : os === "darwin"
      ? ["libfastsleep.dylib"]
      : ["libfastsleep.so"];

  for (const name of candidates) {
    const u = new URL(name, base);
    try {
      // probe by attempting to open then immediately close
      const t = Deno.dlopen(u, { fast_sleep_us: { parameters: ["u32"], result: "void" } } as const);
      t.close();
      return u;
    } catch {
      // try next
    }
  }
  throw new Error(
    `Could not find native fastsleep library in ${base.toString()} (tried ${candidates.join(", ")})`,
  );
}

const lib = Deno.dlopen(dylibUrl(), {
  fast_sleep_init: { parameters: ["u32", "u32"], result: "i32" },
  fast_sleep_us: {
    parameters: ["u32"],
    result: "void",
    nonblocking: true, // runs on blocking thread; returns Promise<undefined> :contentReference[oaicite:2]{index=2}
  },
} as const);

function strategyToInt(s: Strategy): number {
  switch (s) {
    case "default":
      return 0;
    case "yield":
      return 1;
    case "spin":
      return 2;
  }
}

/** Optional one-time config. Call early (before fastSleep). */
export function configureFastSleep(
  opts: { nativeAccuracyUs?: number; strategy?: Strategy } = {},
) {
  const nativeAccuracyUs = Math.max(0, Math.floor(opts.nativeAccuracyUs ?? 200));
  const strategy = strategyToInt(opts.strategy ?? "default");
  const rc = lib.symbols.fast_sleep_init(nativeAccuracyUs >>> 0, strategy);
  if (rc === -1) throw new Error("fast_sleep_init: invalid strategy");
  // rc=1 just means it was already initialized; ignore.
}

/** Sleep for microseconds (Promise-based, nonblocking FFI). */
export function fastSleepUs(us: number): Promise<void> {
  if (!Number.isFinite(us)) us = 0;
  us = Math.max(0, Math.floor(us));
  const clamped = Math.min(us, 0xFFFF_FFFF);
  // nonblocking:true => returns Promise resolving to result (void -> undefined)
  return lib.symbols.fast_sleep_us(clamped >>> 0) as unknown as Promise<void>;
}

/** Sleep for milliseconds (fractional ms allowed). */
export function fastSleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms)) ms = 0;
  const us = ms <= 0 ? 0 : Math.floor(ms * 1000);
  return fastSleepUs(us);
}

// Simple setTimeout-like wrapper.
// Note: clearFastTimeout prevents the callback from running, but cannot cancel the in-flight native sleep.
let nextId = 1;
const pending = new Map<number, { canceled: boolean; cb: () => void }>();

export function setFastTimeout(cb: () => void, ms: number): number {
  const id = nextId++;
  pending.set(id, { canceled: false, cb });

  fastSleep(ms).then(() => {
    const rec = pending.get(id);
    if (!rec || rec.canceled) return;
    pending.delete(id);
    rec.cb();
  });

  return id;
}

export function clearFastTimeout(id: number) {
  const rec = pending.get(id);
  if (rec) rec.canceled = true;
  pending.delete(id);
}
