// Shared GitHub Releases locations for the TouchDesigner plugin distribution.
// One rolling release (fixed tag) holds the latest ZIP for each platform; each
// platform replaces only its own asset, so mac and Windows can ship independently.
export const repository = 'AvneeshSarwate/avTools';
export const tag = 'td-plugins';
export const platform = process.platform === 'win32' ? 'windows-x64' : 'macos-arm64';
export const assetName = (name = platform) => `avtools-td-plugins-${name}.zip`;
export const downloadURL = (name = platform) => `https://github.com/${repository}/releases/download/${tag}/${assetName(name)}`;
