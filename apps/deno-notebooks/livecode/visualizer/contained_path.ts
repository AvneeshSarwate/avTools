import { isAbsolute, join, normalize, relative } from "jsr:@std/path@1";

/** Resolve one URL path below a root, rejecting malformed or escaping input. */
export function resolveContainedUrlPath(
  root: string,
  encodedRelativePath: string,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedRelativePath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || isAbsolute(decoded)) return null;

  const normalizedRoot = normalize(root);
  const candidate = normalize(join(normalizedRoot, decoded));
  const fromRoot = relative(normalizedRoot, candidate);
  if (isAbsolute(fromRoot) || /^\.\.(?:[\\/]|$)/.test(fromRoot)) return null;
  return candidate;
}
