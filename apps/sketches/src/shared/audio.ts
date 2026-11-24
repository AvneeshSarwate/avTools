let context: AudioContext | null = null;

/** The page's AudioContext; call from a user gesture at least once so it resumes. */
export function audioContext(): AudioContext {
  context ??= new AudioContext({ latencyHint: "interactive" });
  if (context.state !== "running") void context.resume().catch((error) => console.error("[audio]", error));
  return context;
}
