// Page boot parameters: URL query params, or — only when the URL carries no
// query string at all — the defaults a bake stamps into its copied index.html
// (`window.livecodeBootDefaults`). A static demo thus opens correctly at its
// bare root URL, while any explicit query string configures the page entirely
// by itself: the two-tab baked form (`?serverBaseUrl=none&sync=broadcast&
// actions=broadcast`) must not inherit `engine=inprocess` from the defaults,
// or the UI tab would contend for the engine lock with the engine tab.

declare global {
  interface Window {
    livecodeBootDefaults?: Record<string, string>;
  }
}

export function readBootParam(name: string): string | null {
  const query = new URLSearchParams(window.location.search);
  if ([...query.keys()].length > 0) return query.get(name);
  const fromDefaults = window.livecodeBootDefaults?.[name];
  return typeof fromDefaults === "string" ? fromDefaults : null;
}
