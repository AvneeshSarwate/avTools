import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {distributionHash, writeDistributionVersion} from '../scripts/td-distribution-version.mjs';

test('distribution numbers track payload changes and survive copying to a new location', () => {
  const root = mkdtempSync(join(tmpdir(), 'avtools-distribution-version-'));
  try {
    const staged = join(root, 'staged'), current = join(root, 'current');
    mkdirSync(join(staged, 'Framework/Versions/A'), {recursive: true});
    writeFileSync(join(staged, 'Framework/Versions/A/runtime'), 'binary one');
    symlinkSync('A', join(staged, 'Framework/Versions/Current'));
    const first = writeDistributionVersion(staged, current);
    assert.equal(first.version, 1);
    cpSync(staged, current, {recursive: true, verbatimSymlinks: true});
    assert.deepEqual(writeDistributionVersion(staged, current), first);
    assert.equal(distributionHash(current), first.sha256);

    writeFileSync(join(staged, 'Framework/Versions/A/runtime'), 'binary two');
    const second = writeDistributionVersion(staged, current);
    assert.equal(second.version, 2);
    assert.notEqual(second.sha256, first.sha256);
    rmSync(current, {recursive: true});
    cpSync(staged, current, {recursive: true, verbatimSymlinks: true});
    writeFileSync(join(staged, 'README.md'), 'Updated setup guide');
    assert.equal(writeDistributionVersion(staged, current).version, 3);

    // A damaged version file must not silently reset the release counter.
    writeFileSync(join(current, 'version.json'), '{"schema":1,"version":-1}');
    assert.throws(() => writeDistributionVersion(staged, current), /Invalid distribution version/);
    assert.equal(JSON.parse(readFileSync(join(staged, 'version.json'))).version, 3);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
