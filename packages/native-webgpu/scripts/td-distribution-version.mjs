import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, readlinkSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Hash paths, file contents, and symlink targets without following framework links.
// The generated version file is metadata, not part of the payload it describes.
export function distributionHash(directory) {
  const hash = createHash('sha256');
  function visit(relative = '') {
    for (const entry of readdirSync(resolve(directory, relative), {withFileTypes: true})
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path === 'version.json') continue;
      const absolute = resolve(directory, path);
      const kind = entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'link' : 'file';
      hash.update(JSON.stringify([kind, path]));
      if (entry.isDirectory()) visit(path);
      else if (entry.isSymbolicLink()) hash.update(JSON.stringify(readlinkSync(absolute)));
      else hash.update(createHash('sha256').update(readFileSync(absolute)).digest());
    }
  }
  visit();
  return hash.digest('hex');
}

export function writeDistributionVersion(stagedPlugins, currentPlugins) {
  const previousPath = resolve(currentPlugins, 'version.json');
  const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : null;
  if (previous && (previous.schema !== 1 || !Number.isSafeInteger(previous.version) ||
    previous.version < 1 || !/^[a-f0-9]{64}$/.test(previous.sha256))) {
    throw new Error(`Invalid distribution version: ${previousPath}`);
  }
  const sha256 = distributionHash(stagedPlugins);
  const version = previous ? previous.version + (previous.sha256 === sha256 ? 0 : 1) : 1;
  const manifest = {schema: 1, version, platform: 'macos-arm64', sha256};
  writeFileSync(resolve(stagedPlugins, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
