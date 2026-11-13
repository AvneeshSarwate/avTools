// Shared best-effort filesystem helpers for the livecode visualizer server.

/**
 * Recursively remove a path, swallowing NotFound and never throwing. Any other
 * error is logged via console.warn (with the optional label for context) so a
 * failed cleanup can never crash the server or a spawned helper process.
 */
export async function removePathBestEffort(
  path: string,
  label?: string,
): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    const suffix = label ? ` (${label})` : "";
    console.warn(
      `[livecode] failed to remove path${suffix}: ${path}`,
      error,
    );
  }
}
