// Verify the actual shipped executable works after relocation, without its build tree.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

test('distributed CLI checks standalone TOP/CHOP projects and preserves published code', t => {
  const temporary = mkdtempSync('/private/tmp/avtools-distributed-cli-');
  t.after(() => rmSync(temporary, {recursive: true, force: true}));
  const cli = resolve(temporary, 'avtools-build');
  copyFileSync(resolve(import.meta.dirname, '../../../apps/td-projects/Plugins/avtools-build'), cli);
  const env = {...process.env, PATH: '/usr/bin:/bin'};
  const project = resolve(temporary, 'project');
  execFileSync(cli, ['init', project], {env});

  const run = (command, entry, target) => {
    const result = spawnSync(cli, [command, resolve(project, entry), target], {env, encoding: 'utf8'});
    return {status: result.status, result: JSON.parse(result.stdout)};
  };
  for (const [entry, target] of [
    ['examples/background/main.ts', 'top'],
    ['examples/channels/main.ts', 'chop'],
    ['examples/canvas/picture.ts', 'top'],
  ]) {
    const check = run('check-file', entry, target);
    assert.equal(check.status, 0, JSON.stringify(check.result));
    assert.equal(check.result.state, 'ready');
  }
  assert.ok(!readdirSync(resolve(project, '.avtools'), {recursive: true}).some(p => p.endsWith('sketch.js')));
  const entry = 'examples/background/main.ts';
  const build = run('build-file', entry, 'top');
  assert.equal(build.status, 0);
  const output = build.result.changed.find(p => p.endsWith('/sketch.js'));
  const before = readFileSync(output, 'utf8');
  writeFileSync(resolve(project, entry), 'const value: number = "wrong"; export function draw() {}');
  const failed = run('check-file', entry, 'top');
  assert.notEqual(failed.status, 0);
  assert.equal(failed.result.state, 'error');
  assert.ok(failed.result.diagnostics.some(d => d.file.endsWith('main.ts') && d.line === 1));
  assert.equal(readFileSync(output, 'utf8'), before);
  writeFileSync(resolve(project, entry), 'export function draw() {}');
  assert.equal(run('check-file', entry, 'top').status, 0);
  assert.equal(readFileSync(output, 'utf8'), before);
});
