//! Portable path canonicalization.
//!
//! On Windows `std::fs::canonicalize` returns verbatim paths (`\\?\C:\...`).
//! Module resolvers and users treat those as foreign: rolldown parses
//! `\\?\C:\x.ts` as a bare specifier, and diagnostics show the prefix. Return
//! the ordinary drive (`C:\...`) or UNC (`\\server\share\...`) form instead.
//! macOS and Linux behavior is exactly `std::fs::canonicalize`.
use std::io;
use std::path::{Path, PathBuf};

pub fn canonicalize(path: impl AsRef<Path>) -> io::Result<PathBuf> {
    std::fs::canonicalize(path).map(simplify)
}

#[cfg(windows)]
pub fn simplify(path: PathBuf) -> PathBuf {
    let Some(text) = path.to_str() else { return path };
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        // Only drive-letter forms; leave volume GUID and device paths verbatim.
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return PathBuf::from(rest);
        }
    }
    path
}

#[cfg(not(windows))]
pub fn simplify(path: PathBuf) -> PathBuf {
    path
}

#[cfg(all(test, windows))]
mod tests {
    use super::simplify;
    use std::path::PathBuf;
    #[test]
    fn strips_verbatim_prefixes() {
        assert_eq!(simplify(PathBuf::from(r"\\?\C:\a\b.ts")), PathBuf::from(r"C:\a\b.ts"));
        assert_eq!(simplify(PathBuf::from(r"\\?\UNC\srv\share\a")), PathBuf::from(r"\\srv\share\a"));
        assert_eq!(simplify(PathBuf::from(r"\\?\Volume{x}\a")), PathBuf::from(r"\\?\Volume{x}\a"));
        assert_eq!(simplify(PathBuf::from(r"C:\a")), PathBuf::from(r"C:\a"));
    }
}
