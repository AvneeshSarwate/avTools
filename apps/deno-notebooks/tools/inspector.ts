/**
 * Scene Inspector — convenience function for opening the inspector from notebooks.
 *
 * Usage:
 * ```typescript
 * import { openInspector } from "@/tools/inspector.ts"
 * await openInspector()
 * ```
 */

import { getInspectorServer, type InspectorServerOptions } from "@avtools/ui-bridge"

/**
 * Open the Scene Inspector in a browser window.
 *
 * The inspector shows all registered UI objects (piano rolls, animation editors,
 * tweakpane panels) in a unified interface. Objects are registered automatically
 * when you call `showBound()` or `pane.show()`.
 *
 * @returns The URL of the inspector server
 */
export async function openInspector(options?: InspectorServerOptions): Promise<string> {
  const server = getInspectorServer({
    openBrowser: true,
    staticDir: new URL("../../../apps/scene-inspector/dist", import.meta.url).pathname,
    ...options,
  })
  return await server.start()
}

export { getInspectorRegistry, getInspectorServer } from "@avtools/ui-bridge"
