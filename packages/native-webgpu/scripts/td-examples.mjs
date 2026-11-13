// Example projects shipped in the release ZIP (both platforms), beside Plugins/:
//   avtools-td-<platform>/Examples/<name>/...
// Each example's startup script finds Plugins/ beside or above it (find_plugin in
// its project_start.py), so no plugin copies are needed. Only git-tracked files are
// copied, so local build caches never reach a release. Examples must be
// self-contained (own tsconfig/sdk if TypeScript) and need no Node or repo paths.
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, relative, dirname} from 'node:path';

export const examples = [
  {name: 'native', source: 'apps/td-projects/native', include: ['project.toe', 'README.md', 'tsconfig.json', 'sdk', 'sketches'],
   summary: 'TypeScript project: two TOP sketches (p5gpu) and two CHOP sketches, each built inside TD from its own .ts entry. Open the folder in VS Code and edit.'},
  {name: 'sketch', source: 'packages/native-webgpu/native/td/example', include: ['Sketch.toe', 'TimeContext.toe', 'sketch.js', 'TimeContext.js', 'README.md'],
   summary: 'Smallest TOP examples: a p5gpu sketch, and TimeContext animation loops (JavaScript, no build step).'},
  {name: 'channels', source: 'packages/native-webgpu/native/td/chop-example', include: ['Channels.toe', 'README.md'],
   summary: 'CHOP examples: generated and pass-through channels.'},
  {name: 'execution-modes', source: 'packages/native-webgpu/native/td/execution-mode-example', include: ['ExecutionModes.toe', 'channels.js', 'README.md'],
   summary: 'How CHOP execution modes (immediate vs. buffered) affect latency and timing.'},
  {name: 'logging', source: 'packages/native-webgpu/native/td/logging-example', include: ['Logging.toe', 'sketch.js', 'channels.js', 'README.md'],
   summary: 'console.log levels and the Info DAT Logs view for a TOP and a CHOP.'},
];

export function copyExamples(repo, releaseDir) {
  const destination = resolve(releaseDir, 'Examples');
  mkdirSync(destination, {recursive: true});
  for (const example of examples) {
    const tracked = execFileSync('git', ['ls-files', '-z', '--', ...example.include.map(entry => `${example.source}/${entry}`)],
      {cwd: repo, encoding: 'utf8'}).split('\0').filter(Boolean);
    if (!tracked.some(file => file.endsWith('.toe'))) throw new Error(`Example ${example.name} has no tracked .toe`);
    for (const file of tracked) {
      const target = resolve(destination, example.name, relative(example.source, file));
      mkdirSync(dirname(target), {recursive: true});
      cpSync(resolve(repo, file), target);
    }
  }
  writeFileSync(resolve(destination, 'README.md'), `# avTools example projects

Open any \`.toe\` below in TouchDesigner. Keep this \`Examples\` folder next to the
\`Plugins\` folder from the same download: each example finds the plugins in a
\`Plugins\` folder beside or above it, so nothing needs configuring.

${examples.map(e => `- **${e.name}/**: ${e.summary}`).join('\n')}

More examples are generated for you: on any avTools TOP or CHOP, press **Build →
Create Template Project**. The template's \`examples/\` folder covers parameters
(controls declared in TypeScript), OSC/UDP and files, MIDI, WebSockets, the browser
canvas, TimeContext timing and TOP inputs, with a README describing the full API.

To use an example as the start of your own project, copy its folder together with
the \`Plugins\` folder (or put \`Plugins\` in a parent folder) and save under a new name.
`);
  return examples.map(e => e.name);
}
