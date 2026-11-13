import { requireNative, nativeDirectory } from './binding.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { HostTextEngine, type NativeEngine } from './text-core.ts';
const native = requireNative(`${nativeDirectory}avtools_text.node`) as { TextEngine: new () => NativeEngine };
export class NodeTextEngine extends HostTextEngine {
  constructor(fonts: URL | null = new URL('./fonts/', import.meta.url)) {
    super(new native.TextEngine());
    try {
      if (fonts) for (const name of readdirSync(fonts).filter(name => /\.(ttf|otf|woff2?)$/i.test(name)).sort((a,b) => a.localeCompare(b))) {
        if (!this.loadFontBytes(readFileSync(new URL(name, fonts)))) throw new Error(`Could not load font ${name}`);
      }
    } catch (error) { this.dispose(); throw error; }
  }
}
