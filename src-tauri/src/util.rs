//! Small shared helpers: path safety, JSON files, byte formatting.
//!
//! Everything in here is deliberately dependency-light and pure so it can be
//! unit-tested without a Tauri runtime.

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Normalise an archive-relative path: forward slashes, no duplicate or
/// leading/trailing separators. Mirrors `normRel()` from the JS core.
pub fn norm_rel(p: &str) -> String {
    let replaced = p.replace('\\', "/");
    let mut out = String::with_capacity(replaced.len());
    let mut prev_slash = false;
    for ch in replaced.chars() {
        if ch == '/' {
            if prev_slash {
                continue;
            }
            prev_slash = true;
        } else {
            prev_slash = false;
        }
        out.push(ch);
    }
    out.trim_matches('/').to_string()
}

/// A relative path that can never escape its root (no "..", not absolute,
/// not empty). Mirrors `safeRel()`.
pub fn safe_rel(p: &str) -> Option<String> {
    let rel = norm_rel(p);
    if rel.is_empty() || rel == "." || rel.contains("..") {
        return None;
    }
    // Reject Windows drive letters / absolute roots that survived norm_rel.
    if rel.starts_with('/') || rel.chars().nth(1) == Some(':') {
        return None;
    }
    Some(rel)
}

/// Last path segment of a normalised relative path.
pub fn leaf(p: &str) -> String {
    norm_rel(p).rsplit('/').next().unwrap_or("").to_string()
}

/// Parent of a normalised relative path ("" for a top-level entry).
pub fn parent_of(p: &str) -> String {
    let n = norm_rel(p);
    match n.rfind('/') {
        Some(i) => n[..i].to_string(),
        None => String::new(),
    }
}

/// Non-empty path segments.
pub fn segments(p: &str) -> Vec<String> {
    norm_rel(p)
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// `true` when `target` is inside (or equal to) `base`, evaluated lexically
/// after normalisation. Mirrors `isWithin()`.
pub fn is_within(base: &Path, target: &Path) -> bool {
    let base = lexical_normalize(base);
    let target = lexical_normalize(target);
    target.starts_with(&base)
}

/// Resolve `relative` inside `root`, returning `None` if it escapes.
pub fn resolve_inside(root: &Path, relative: &str) -> Option<PathBuf> {
    let abs = lexical_normalize(&root.join(relative));
    if is_within(root, &abs) {
        Some(abs)
    } else {
        None
    }
}

/// Lexically normalise a path (collapse `.` / `..`) without touching the FS.
pub fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Relative path (forward slashes) from `base` to `target`, or `None` when
/// `target` is not inside `base`.
pub fn rel_from(base: &Path, target: &Path) -> Option<String> {
    let base = lexical_normalize(base);
    let target = lexical_normalize(target);
    let rel = target.strip_prefix(&base).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// Sanitise a folder leaf so it is safe to use as a file-system name.
pub fn safe_leaf(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "item".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Read a JSON file, returning `fallback` on any error.
pub fn read_json_or<T: DeserializeOwned>(file: &Path, fallback: T) -> T {
    match fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

/// Write pretty JSON atomically (write temp, then rename).
pub fn write_json_atomic<T: Serialize>(file: &Path, data: &T) -> std::io::Result<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = file.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    fs::write(&tmp, text)?;
    // On Windows rename fails if the destination exists.
    if file.exists() {
        let _ = fs::remove_file(file);
    }
    fs::rename(&tmp, file)
}

/// Recursive size of a directory (best-effort, silently skips errors).
pub fn folder_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    for entry in walkdir::WalkDir::new(dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(md) = entry.metadata() {
                total += md.len();
            }
        }
    }
    total
}

/// Copy a directory tree recursively (`fs::cp` equivalent).
pub fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

/// ISO-8601 UTC timestamp (matches `new Date().toISOString()`).
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Milliseconds since the Unix epoch (matches `Date.now()`).
pub fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Extension in lower-case, with the leading dot (e.g. ".zip"), or "".
pub fn ext_lower(p: &Path) -> String {
    p.extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

/// MIME type guess for common image extensions.
pub fn image_mime(ext: &str) -> &'static str {
    match ext {
        ".jpg" | ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        _ => "image/png",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_and_safe_rel() {
        assert_eq!(norm_rel("a\\b//c/"), "a/b/c");
        assert_eq!(norm_rel("/x/y"), "x/y");
        assert_eq!(safe_rel("../x"), None);
        assert_eq!(safe_rel("a/../b"), None);
        assert_eq!(safe_rel("."), None);
        assert_eq!(safe_rel(""), None);
        assert_eq!(safe_rel("ok/file.txt").as_deref(), Some("ok/file.txt"));
    }

    #[test]
    fn leaf_parent_segments() {
        assert_eq!(leaf("a/b/c"), "c");
        assert_eq!(parent_of("a/b/c"), "a/b");
        assert_eq!(parent_of("a"), "");
        assert_eq!(segments("a//b/"), vec!["a", "b"]);
    }

    #[test]
    fn within_and_resolve() {
        let root = Path::new("/game");
        assert!(is_within(root, Path::new("/game/content")));
        assert!(is_within(root, Path::new("/game")));
        assert!(!is_within(root, Path::new("/gamer")));
        assert!(resolve_inside(root, "../etc").is_none());
        assert_eq!(resolve_inside(root, "system/cfg").unwrap(), PathBuf::from("/game/system/cfg"));
        assert_eq!(resolve_inside(root, "").unwrap(), PathBuf::from("/game"));
    }

    #[test]
    fn safe_leaf_cleans() {
        assert_eq!(safe_leaf("my car!"), "my_car");
        assert_eq!(safe_leaf("___"), "item");
    }
}
