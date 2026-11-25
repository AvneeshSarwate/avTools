let context: AudioContext | null = null;

/**
 * The page's AudioContext. It may be made before any user gesture (it starts
 * suspended, which lets audio engines load early); `resume` (the default)
 * starts it, which browsers allow only from a gesture, at least the first time.
 */
export function audioContext({ resume = true } = {}): AudioContext {
  context ??= new AudioContext({ latencyHint: "interactive" });
  if (resume && context.state !== "running") void context.resume().catch((error) => console.error("[audio]", error));
  return context;
}

/**
 * Seconds from a sound being made to it leaving the speakers (0 when the
 * browser does not say). Drawing this far behind the audio clock lines the
 * picture up with what is heard.
 */
export function outputDelay(): number {
  if (!context || context.state !== "running") return 0;
  const output = (context as AudioContext & { outputLatency?: number }).outputLatency;
  return (Number.isFinite(output) ? output! : 0) + (Number.isFinite(context.baseLatency) ? context.baseLatency : 0);
}
