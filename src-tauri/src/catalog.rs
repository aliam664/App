//! Catalog of bundled content: discovers `mods/addons/<id>/` folders, reads
//! their optional `mod.json`, and produces a preview thumbnail for the UI.
//!
//! `mod.json` (every field optional):
//! ```json
//! {
//!   "name": "Gas HUD"                      // or {"fa": "...", "en": "..."}
//!   "description": {"fa": "...", "en": "..."},
//!   "version": "1.2",
//!   "author": "UHM",
//!   "category": "hud",                     // free text, used as a chip
//!   "requires": ["csp"],                   // informational chips
//!   "order": 10,                           // sort key (lower = first)
//!   "recommendedTiers": ["high", "veryhigh", "ultra"],
//!   "preview": "preview.png"               // default: preview.png/jpg/webp
//! }
//! ```

use crate::installer::{ADDONS_DIR, ADDON_FILES_DIR};
use crate::preview;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonInfo {
    pub id: String,
    /// `{"fa": ..., "en": ...}` — always both keys present (fallbacks applied).
    pub name: Value,
    pub description: Value,
    pub version: Option<String>,
    pub author: Option<String>,
    pub category: Option<String>,
    pub requires: Vec<String>,
    pub recommended_tiers: Vec<String>,
    pub order: i64,
    pub file_count: u64,
    pub size_bytes: u64,
    /// `false` when `files/` is missing or empty → card shown as "no files".
    pub available: bool,
    pub has_meta: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_data_url: Option<String>,
    /// Top-level entries of `files/` (e.g. `apps/`, `extension/`) for display.
    pub top_level: Vec<String>,
}

/// `(file_count, total_bytes)` of every regular file under `dir`.
pub fn count_files(dir: &Path) -> (u64, u64) {
    if !dir.is_dir() {
        return (0, 0);
    }
    let mut n = 0u64;
    let mut bytes = 0u64;
    for e in walkdir::WalkDir::new(dir).min_depth(1).into_iter().flatten() {
        if e.file_type().is_file() {
            let name = e.file_name().to_string_lossy();
            if name == ".gitkeep" {
                continue;
            }
            n += 1;
            bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    (n, bytes)
}

/// Turn a folder id like `hud-gas_v2` into `Hud Gas V2`.
pub fn humanize_id(id: &str) -> String {
    id.split(|c: char| c == '-' || c == '_' || c == '.')
        .filter(|s| !s.is_empty())
        .map(|w| {
            let mut cs = w.chars();
            match cs.next() {
                Some(f) => f.to_uppercase().collect::<String>() + cs.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Normalise a `string | {lang: string}` field into `{"fa": .., "en": ..}`.
fn localized(v: Option<&Value>, fallback: &str) -> Value {
    let (fa, en) = match v {
        Some(Value::String(s)) if !s.trim().is_empty() => (s.clone(), s.clone()),
        Some(Value::Object(o)) => {
            let get = |k: &str| o.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
            let en = get("en");
            let fa = get("fa");
            let any = en.clone().or_else(|| fa.clone()).or_else(|| o.values().find_map(|x| x.as_str().map(str::to_string)));
            (
                fa.clone().or_else(|| any.clone()).unwrap_or_else(|| fallback.to_string()),
                en.or(any).unwrap_or_else(|| fallback.to_string()),
            )
        }
        _ => (fallback.to_string(), fallback.to_string()),
    };
    serde_json::json!({ "fa": fa, "en": en })
}

fn string_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        Some(Value::String(s)) => s.split(',').map(|x| x.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        _ => vec![],
    }
}

const PREVIEW_CANDIDATES: [&str; 5] = ["preview.png", "preview.jpg", "preview.jpeg", "preview.webp", "preview.gif"];

pub fn read_addon(dir: &Path) -> Option<AddonInfo> {
    if !dir.is_dir() {
        return None;
    }
    let id = dir.file_name()?.to_string_lossy().to_string();
    if id.starts_with('.') || id.starts_with('_') || crate::installer::sanitize_id(&id) != id {
        return None; // hidden/template or unsafe folder name → not an add-on
    }
    let meta_path = dir.join("mod.json");
    let has_meta = meta_path.is_file();
    let meta: Value = if has_meta {
        crate::util::read_json_or(&meta_path, Value::Null)
    } else {
        Value::Null
    };
    let obj = meta.as_object();
    let get = |k: &str| obj.and_then(|o| o.get(k));
    let fallback_name = humanize_id(&id);

    let files_dir = dir.join(ADDON_FILES_DIR);
    let (file_count, size_bytes) = count_files(&files_dir);
    let mut top_level: Vec<String> = std::fs::read_dir(&files_dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.file_name().to_string_lossy() != ".gitkeep")
                .map(|e| {
                    let n = e.file_name().to_string_lossy().to_string();
                    if e.path().is_dir() { format!("{n}/") } else { n }
                })
                .collect()
        })
        .unwrap_or_default();
    top_level.sort();

    // Preview: explicit `preview` key, else the first candidate that exists.
    let preview_rel = get("preview").and_then(Value::as_str).map(str::to_string);
    let preview_path = preview_rel
        .and_then(|r| crate::util::safe_rel(&r))
        .map(|r| dir.join(r))
        .filter(|p| p.is_file())
        .or_else(|| PREVIEW_CANDIDATES.iter().map(|c| dir.join(c)).find(|p| p.is_file()));
    let preview_data_url = preview_path.as_deref().and_then(preview::file_to_data_url);

    Some(AddonInfo {
        id,
        name: localized(get("name"), &fallback_name),
        description: localized(get("description"), ""),
        version: get("version").and_then(|v| match v {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        }),
        author: get("author").and_then(Value::as_str).map(str::to_string),
        category: get("category").and_then(Value::as_str).map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()),
        requires: string_list(get("requires")),
        recommended_tiers: string_list(get("recommendedTiers")).into_iter().filter(|t| crate::installer::is_valid_tier(t)).collect(),
        order: get("order").and_then(Value::as_i64).unwrap_or(1000),
        file_count,
        size_bytes,
        available: file_count > 0,
        has_meta,
        preview_data_url,
        top_level,
    })
}

pub fn list_addons(mods_dir: &Path) -> Vec<AddonInfo> {
    let root = mods_dir.join(ADDONS_DIR);
    let mut out: Vec<AddonInfo> = std::fs::read_dir(&root)
        .map(|rd| rd.flatten().filter_map(|e| read_addon(&e.path())).collect())
        .unwrap_or_default();
    out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.to_lowercase().cmp(&b.id.to_lowercase())));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, s: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }

    #[test]
    fn humanize() {
        assert_eq!(humanize_id("hud-gas_v2"), "Hud Gas V2");
        assert_eq!(humanize_id("srp"), "Srp");
    }

    #[test]
    fn addon_with_meta_and_without() {
        let tmp = tempfile::tempdir().unwrap();
        let mods = tmp.path().join("mods");
        write(&mods.join("addons/zz-nometa/files/apps/x.py"), "1");
        write(&mods.join("addons/hud-gas/mod.json"), r#"{
            "name": {"fa": "نمایشگر گاز", "en": "Gas HUD"},
            "description": "Shows throttle",
            "version": 1.5, "author": "UHM", "category": " HUD ",
            "requires": ["csp"], "recommendedTiers": ["ultra", "bogus"], "order": 1
        }"#);
        write(&mods.join("addons/hud-gas/files/apps/python/GasHUD/a.py"), "12345");
        write(&mods.join("addons/hud-gas/files/apps/python/GasHUD/.gitkeep"), "");
        write(&mods.join("addons/hud-gas/files/extension/x.ini"), "1");
        write(&mods.join("addons/.hidden/files/a"), "1");
        write(&mods.join("addons/_example-addon/files/a"), "1");
        write(&mods.join("addons/empty/preview.png"), "");
        write(&mods.join("addons/broken/mod.json"), "{ not json");
        write(&mods.join("addons/broken/files/a.txt"), "x");

        let list = list_addons(&mods);
        let ids: Vec<&str> = list.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["hud-gas", "broken", "empty", "zz-nometa"], "sorted by order then id, hidden and _template skipped");

        let g = &list[0];
        assert_eq!(g.name["fa"], "نمایشگر گاز");
        assert_eq!(g.name["en"], "Gas HUD");
        assert_eq!(g.description["fa"], "Shows throttle");
        assert_eq!(g.version.as_deref(), Some("1.5"));
        assert_eq!(g.category.as_deref(), Some("hud"));
        assert_eq!(g.requires, vec!["csp"]);
        assert_eq!(g.recommended_tiers, vec!["ultra"]);
        assert_eq!(g.file_count, 2);
        assert_eq!(g.size_bytes, 6);
        assert!(g.available && g.has_meta);
        assert_eq!(g.top_level, vec!["apps/", "extension/"]);
        assert!(g.preview_data_url.is_none());

        let n = list.iter().find(|a| a.id == "zz-nometa").unwrap();
        assert_eq!(n.name["en"], "Zz Nometa");
        assert!(!n.has_meta && n.available);
        assert_eq!(n.order, 1000);

        let e = list.iter().find(|a| a.id == "empty").unwrap();
        assert!(!e.available);
        assert!(e.preview_data_url.is_none(), "empty png must not crash");

        let b = list.iter().find(|a| a.id == "broken").unwrap();
        assert!(b.has_meta && b.available);
        assert_eq!(b.name["en"], "Broken", "invalid json falls back to folder name");
    }

    #[test]
    fn no_addons_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(list_addons(tmp.path()).is_empty());
        assert_eq!(count_files(&tmp.path().join("nope")), (0, 0));
    }
}
