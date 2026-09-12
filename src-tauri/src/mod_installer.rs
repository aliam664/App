//! Drag-and-drop mod installer — port of `src/lib/modInstaller.js`.
//!
//! 1. Lists the contents of a dropped source (ZIP / RAR / folder).
//! 2. Detects what is inside — car, track, skin, app, pp-filter, font,
//!    weather, driver, or a generic "mirror" of the AC root.
//! 3. Reads metadata (ui_car.json / ui_track.json / ui_skin.json) and
//!    extracts a small preview thumbnail.
//! 4. Builds an install plan against the game folder with conflict analysis.
//! 5. Executes the plan with per-file backup and progress events.
//!
//! Analysis never writes to the game folder; only `execute_install` does.

use crate::archive::{self, Entry, RarErrorKind};
use crate::util::{ext_lower, folder_size, leaf, norm_rel, now_millis, parent_of, safe_rel, segments};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const PREVIEW_MAX_RAW: usize = 2 * 1024 * 1024;
const MAX_DEPTH: usize = 24;
const CONTENT_TYPES: &[&str] = &["car", "track", "skin", "app", "ppfilter", "font", "weather", "driver", "mirror"];
const MIRROR_ROOTS: &[&str] = &["content", "system", "apps", "extension", "fonts", "driver", "weather", "texture"];

/* ------------------------------------------------------------------ */
/*  Source detection                                                   */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub kind: String, // folder | archive | unsupported | unknown | missing | invalid
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

pub fn detect_source_kind(source_path: &str) -> Source {
    let label = Path::new(source_path).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    if source_path.is_empty() {
        return Source { kind: "invalid".into(), archive_type: None, format: None, path: None, label, size_bytes: None };
    }
    let p = Path::new(source_path);
    let Ok(md) = fs::metadata(p) else {
        return Source { kind: "missing".into(), archive_type: None, format: None, path: None, label, size_bytes: None };
    };
    if md.is_dir() {
        return Source { kind: "folder".into(), archive_type: None, format: None, path: Some(source_path.into()), label, size_bytes: Some(folder_size(p)) };
    }
    let ext = ext_lower(p);
    match ext.as_str() {
        ".zip" => Source { kind: "archive".into(), archive_type: Some("zip".into()), format: None, path: Some(source_path.into()), label, size_bytes: Some(md.len()) },
        ".rar" | ".cbr" => Source { kind: "archive".into(), archive_type: Some("rar".into()), format: None, path: Some(source_path.into()), label, size_bytes: Some(md.len()) },
        ".7z" => Source { kind: "unsupported".into(), archive_type: None, format: Some("7z".into()), path: Some(source_path.into()), label, size_bytes: None },
        _ => Source { kind: "unknown".into(), archive_type: None, format: None, path: Some(source_path.into()), label, size_bytes: Some(md.len()) },
    }
}

impl Source {
    fn is_rar(&self) -> bool {
        self.kind == "archive" && self.archive_type.as_deref() == Some("rar")
    }
    fn is_zip(&self) -> bool {
        self.kind == "archive" && self.archive_type.as_deref() == Some("zip")
    }
    fn path(&self) -> &Path {
        Path::new(self.path.as_deref().unwrap_or(""))
    }
}

/* ------------------------------------------------------------------ */
/*  Entry listing                                                      */
/* ------------------------------------------------------------------ */

pub fn list_folder_entries(dir: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    for e in walkdir::WalkDir::new(dir).min_depth(1).max_depth(MAX_DEPTH + 1).into_iter().flatten() {
        let rel = match e.path().strip_prefix(dir) {
            Ok(r) => norm_rel(&r.to_string_lossy()),
            Err(_) => continue,
        };
        if e.file_type().is_dir() {
            out.push(Entry { path: rel, is_dir: true, size: 0 });
        } else if e.file_type().is_file() {
            out.push(Entry { path: rel, is_dir: false, size: e.metadata().map(|m| m.len()).unwrap_or(0) });
        }
    }
    out
}

fn list_source_entries(source: &Source) -> archive::Result<Vec<Entry>> {
    if source.kind == "folder" {
        return Ok(list_folder_entries(source.path()));
    }
    if source.is_zip() {
        return archive::list_zip_entries(source.path());
    }
    if source.is_rar() {
        return Ok(archive::probe_rar(source.path(), None)?.entries);
    }
    Ok(vec![])
}

/* ------------------------------------------------------------------ */
/*  Virtual tree + detection                                           */
/* ------------------------------------------------------------------ */

struct Tree {
    dirs: BTreeSet<String>,
    files: BTreeSet<String>,
    file_size: HashMap<String, u64>,
}

fn build_tree(entries: &[Entry]) -> Tree {
    let mut t = Tree { dirs: BTreeSet::new(), files: BTreeSet::new(), file_size: HashMap::new() };
    for e in entries {
        let p = norm_rel(&e.path);
        if p.is_empty() {
            continue;
        }
        if e.is_dir {
            t.dirs.insert(p);
        } else {
            // Implicit parent dirs (many archives omit directory entries).
            let mut cur = parent_of(&p);
            while !cur.is_empty() && t.dirs.insert(cur.clone()) {
                cur = parent_of(&cur);
            }
            t.file_size.insert(p.clone(), e.size);
            t.files.insert(p);
        }
    }
    t
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanFile {
    pub rel: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub source_root: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub car: Option<String>,
    pub files: Vec<PlanFile>,
    // hydrated
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_data_url: Option<String>,
    // plan
    pub target_dir: Option<String>,
    pub target_relative: String,
    pub file_count: usize,
    pub size_bytes: u64,
    pub status: String,
    pub overwrite_count: usize,
    pub add_count: usize,
}

pub fn is_car_dir(dirs: &BTreeSet<String>, files: &BTreeSet<String>, d: &str) -> bool {
    files.contains(&format!("{d}/ui/ui_car.json"))
        || (dirs.contains(&format!("{d}/data")) && dirs.contains(&format!("{d}/skins")))
        || files.contains(&format!("{d}/data.acd"))
}

pub fn is_track_dir(_dirs: &BTreeSet<String>, files: &BTreeSet<String>, d: &str) -> bool {
    files.contains(&format!("{d}/ui/ui_track.json"))
        || files.contains(&format!("{d}/models.ini"))
        || files.contains(&format!("{d}/data/models.ini"))
        || files.contains(&format!("{d}/surfaces.ini"))
}

pub fn is_skin_dir(_dirs: &BTreeSet<String>, files: &BTreeSet<String>, d: &str) -> bool {
    files.contains(&format!("{d}/livery.png"))
        || files.contains(&format!("{d}/livery.dds"))
        || files.contains(&format!("{d}/livery.jpg"))
        || files.contains(&format!("{d}/ui_skin.json"))
}

pub struct Detected {
    pub items: Vec<Item>,
    pub warnings: Vec<String>,
    #[allow(dead_code)]
    pub root: Option<String>,
}

pub fn detect_mods(entries: &[Entry]) -> Detected {
    let tree = build_tree(entries);
    let mut items: Vec<Item> = Vec::new();
    let mut warnings = Vec::new();

    // Find the "content" root (mirrors the AC install root).
    let content_dir = tree.dirs.iter().find(|d| *d == "content" || d.ends_with("/content")).cloned();
    let base: String = match &content_dir {
        Some(c) if c != "content" => c[..c.len() - "content".len()].to_string(),
        _ => String::new(),
    };
    let norm = |p: &str| -> String {
        if !base.is_empty() && p.starts_with(&base) {
            p[base.len()..].to_string()
        } else {
            p.to_string()
        }
    };
    let ndirs: BTreeSet<String> = tree.dirs.iter().map(|d| norm(d)).filter(|s| !s.is_empty()).collect();
    let nfiles: BTreeSet<String> = tree.files.iter().map(|d| norm(d)).filter(|s| !s.is_empty()).collect();
    let size_of = |f: &str| -> u64 {
        let full = if base.is_empty() { f.to_string() } else { format!("{base}{f}") };
        *tree.file_size.get(&full).or_else(|| tree.file_size.get(f)).unwrap_or(&0)
    };
    let has = |p: &str| ndirs.contains(p);
    let child_dirs = |parent: &str| -> Vec<String> { ndirs.iter().filter(|d| parent_of(d) == parent).cloned().collect() };
    let top_level: Vec<String> = ndirs.iter().filter(|d| segments(d).len() == 1).cloned().collect();

    let mut claimed: HashSet<String> = HashSet::new();
    let mut pp_files: Vec<String> = Vec::new();
    let mut mirrored: Vec<String> = Vec::new();

    macro_rules! add {
        ($item:expr) => {{
            let it: Item = $item;
            claimed.insert(norm_rel(&it.source_root));
            items.push(it);
        }};
    }
    let mk = |kind: &str, root: &str, name: String| Item { kind: kind.into(), source_root: root.into(), name, ..Default::default() };

    // --- Cars ---
    let cars_root = if has("content/cars") { Some("content/cars") } else if has("cars") { Some("cars") } else { None };
    let car_candidates = match cars_root { Some(r) => child_dirs(r), None => top_level.clone() };
    for d in car_candidates {
        if is_car_dir(&ndirs, &nfiles, &d) {
            add!(mk("car", &d, leaf(&d)));
        }
    }

    // --- Tracks ---
    let tracks_root = if has("content/tracks") { Some("content/tracks") } else if has("tracks") { Some("tracks") } else { None };
    let track_candidates = match tracks_root { Some(r) => child_dirs(r), None => top_level.clone() };
    for d in track_candidates {
        if is_track_dir(&ndirs, &nfiles, &d) {
            add!(mk("track", &d, leaf(&d)));
        }
    }

    // --- Skins (standalone: not already inside a detected car) ---
    for d in ndirs.iter() {
        let segs = segments(d);
        if segs.len() < 2 || segs[segs.len() - 2] != "skins" {
            continue;
        }
        let car_name = if segs.len() >= 3 { segs[segs.len() - 3].clone() } else { String::new() };
        if !is_skin_dir(&ndirs, &nfiles, d) {
            continue;
        }
        let inside_car = items.iter().any(|it| it.kind == "car" && d.starts_with(&format!("{}/", it.source_root)));
        if inside_car {
            continue;
        }
        let mut it = mk("skin", d, leaf(d));
        it.car = Some(car_name);
        add!(it);
    }

    // --- Apps (apps/python/<name>) ---
    for ar in ["apps/python", "content/apps/python"].iter().filter(|r| has(r)) {
        for d in child_dirs(ar) {
            add!(mk("app", &d, leaf(&d)));
        }
    }

    // --- PP filters ---
    let pp_roots: Vec<&str> = ["system/cfg/ppfilters", "ppfilters"].into_iter().filter(|r| has(r)).collect();
    for f in nfiles.iter() {
        for pr in &pp_roots {
            if f.starts_with(&format!("{pr}/")) && f.ends_with(".ini") {
                pp_files.push(f.clone());
            }
        }
    }
    if pp_roots.is_empty() {
        for f in nfiles.iter() {
            if segments(f).len() == 1 && f.to_lowercase().ends_with(".ini") {
                pp_files.push(f.clone());
            }
        }
    }
    if !pp_files.is_empty() {
        let root = pp_roots.first().copied().unwrap_or("");
        let names: Vec<String> = pp_files.iter().map(|f| leaf(f)).collect();
        let name = if names.len() == 1 { names[0].clone() } else { let l = leaf(root); if l.is_empty() { "ppfilter".into() } else { l } };
        add!(mk("ppfilter", root, name));
    }

    // --- Fonts / weather / driver ---
    let simple: [(&str, &str, &str); 3] = [("content/fonts", "fonts", "font"), ("content/weather", "weather", "weather"), ("content/driver", "driver", "driver")];
    for (a, b, kind) in simple {
        let root = if has(a) { Some(a) } else if has(b) { Some(b) } else { None };
        if let Some(r) = root {
            for d in child_dirs(r) {
                add!(mk(kind, &d, leaf(&d)));
            }
        }
    }

    // --- Generic mirror: remaining files under a recognizable AC root ---
    for f in nfiles.iter() {
        let segs = segments(f);
        let Some(top) = segs.first() else { continue };
        if !MIRROR_ROOTS.contains(&top.as_str()) {
            continue;
        }
        if claimed.iter().any(|c| f == c || f.starts_with(&format!("{c}/"))) {
            continue;
        }
        mirrored.push(f.clone());
    }
    if !mirrored.is_empty() {
        add!(mk("mirror", "", "mirror".into()));
    }

    if items.is_empty() {
        warnings.push("NOTHING_DETECTED".into());
    }

    // Post-process: attach file lists.
    for it in items.iter_mut() {
        if it.kind == "ppfilter" {
            let b = if it.source_root.is_empty() { String::new() } else { format!("{}/", it.source_root) };
            it.files = pp_files.iter().map(|f| PlanFile { rel: if b.is_empty() { f.clone() } else { f[b.len()..].to_string() }, size: size_of(f) }).collect();
            continue;
        }
        if it.kind == "mirror" {
            it.files = mirrored.iter().map(|f| PlanFile { rel: f.clone(), size: size_of(f) }).collect();
            continue;
        }
        let prefix = format!("{}/", it.source_root);
        it.files = nfiles.iter().filter(|f| f.starts_with(&prefix)).map(|f| PlanFile { rel: f[prefix.len()..].to_string(), size: size_of(f) }).collect();
    }

    // Detection ran on wrapper-stripped paths, but `source_root` is later
    // joined onto the *real* archive/folder root (staging dir, RAR entry
    // names, ui_car.json lookups). Re-attach the wrapper so a mod packed as
    // `Some Mod v1/content/cars/x` resolves to actual files.
    if !base.is_empty() {
        let wrapper = base.trim_end_matches('/');
        for it in items.iter_mut() {
            it.source_root = if it.source_root.is_empty() { wrapper.to_string() } else { format!("{wrapper}/{}", it.source_root) };
        }
    }

    Detected { items, warnings, root: if base.is_empty() { None } else { Some(base) } }
}

/* ------------------------------------------------------------------ */
/*  Metadata + preview                                                 */
/* ------------------------------------------------------------------ */

fn read_source_file(source: &Source, rel: &str) -> Option<Vec<u8>> {
    if source.kind == "folder" {
        return fs::read(source.path().join(rel)).ok();
    }
    if source.is_zip() {
        return archive::read_zip_file(source.path(), rel);
    }
    None // rar handled separately (batched)
}

fn pick_meta(obj: &Option<Value>, keys: &[&str]) -> Option<String> {
    let obj = obj.as_ref()?.as_object()?;
    for k in keys {
        match obj.get(*k) {
            Some(Value::String(s)) if !s.trim().is_empty() => return Some(s.trim().to_string()),
            Some(Value::Object(m)) => {
                let pick = ["en", "EN", "English", "en-US"].iter().find_map(|kk| m.get(*kk)).or_else(|| m.values().next());
                if let Some(Value::String(s)) = pick {
                    if !s.trim().is_empty() {
                        return Some(s.trim().to_string());
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn preview_candidates(kind: &str) -> &'static [&'static str] {
    match kind {
        "car" | "track" => &["ui/preview.jpg", "ui/preview.png", "ui/preview.jpeg", "ui/preview_light.jpg", "ui/preview_light.png"],
        "skin" => &["preview.jpg", "preview.png", "preview.jpeg", "livery.png"],
        _ => &[],
    }
}

fn meta_rel(it: &Item) -> Option<String> {
    match it.kind.as_str() {
        "car" => Some(format!("{}/ui/ui_car.json", it.source_root)),
        "track" => Some(format!("{}/ui/ui_track.json", it.source_root)),
        "skin" => Some(format!("{}/ui_skin.json", it.source_root)),
        _ => None,
    }
}

fn hydrate_items(source: &Source, mut items: Vec<Item>, password: Option<&str>) -> Vec<Item> {
    let mut rar_bufs: HashMap<String, Vec<u8>> = HashMap::new();
    if source.is_rar() {
        let mut rels = Vec::new();
        for it in &items {
            if let Some(m) = meta_rel(it) {
                rels.push(m);
            }
            for c in preview_candidates(&it.kind) {
                rels.push(format!("{}/{}", it.source_root, c));
            }
        }
        rar_bufs = archive::read_rar_files(source.path(), &rels, password);
    }
    let fetch = |rel: &str| -> Option<Vec<u8>> {
        if source.is_rar() {
            rar_bufs.get(&norm_rel(rel)).cloned()
        } else {
            read_source_file(source, rel)
        }
    };

    for it in items.iter_mut() {
        let meta: Option<Value> = meta_rel(it).and_then(|r| fetch(&r)).and_then(|b| serde_json::from_slice(&b).ok());
        match it.kind.as_str() {
            "car" => {
                it.display_name = pick_meta(&meta, &["name", "Name"]).unwrap_or_else(|| it.name.clone());
                it.brand = pick_meta(&meta, &["brand", "Brand"]);
                it.description = pick_meta(&meta, &["description", "Description"]);
                it.author = pick_meta(&meta, &["author", "Author"]);
                it.version = pick_meta(&meta, &["version", "Version"]);
            }
            "track" => {
                it.display_name = pick_meta(&meta, &["name", "Name"]).unwrap_or_else(|| it.name.clone());
                it.country = pick_meta(&meta, &["country", "Country"]);
                it.description = pick_meta(&meta, &["description", "Description"]);
                it.author = pick_meta(&meta, &["author", "Author"]);
                it.version = pick_meta(&meta, &["version", "Version"]);
            }
            "skin" => {
                it.display_name = pick_meta(&meta, &["name", "Name", "skinname", "SkinName"]).unwrap_or_else(|| it.name.clone());
                it.author = pick_meta(&meta, &["author", "Author"]);
                it.description = pick_meta(&meta, &["description", "Description"]);
            }
            _ => it.display_name = it.name.clone(),
        }

        it.preview_data_url = None;
        for c in preview_candidates(&it.kind) {
            let full = format!("{}/{}", it.source_root, c);
            if let Some(buf) = fetch(&full) {
                if !buf.is_empty() && buf.len() <= PREVIEW_MAX_RAW {
                    it.preview_data_url = Some(crate::preview::thumbnail_data_url(&buf, crate::util::image_mime(&ext_lower(Path::new(c)))));
                    break;
                }
            }
        }
    }
    items
}

/* ------------------------------------------------------------------ */
/*  Install plan                                                       */
/* ------------------------------------------------------------------ */

pub fn target_for(game_path: &Path, kind: &str, name: &str, car: Option<&str>) -> Option<PathBuf> {
    Some(match kind {
        "car" => game_path.join("content").join("cars").join(name),
        "track" => game_path.join("content").join("tracks").join(name),
        "skin" => game_path.join("content").join("cars").join(car.unwrap_or("")).join("skins").join(name),
        "app" => game_path.join("apps").join("python").join(name),
        "ppfilter" => game_path.join("system").join("cfg").join("ppfilters"),
        "font" => game_path.join("content").join("fonts").join(name),
        "weather" => game_path.join("content").join("weather").join(name),
        "driver" => game_path.join("content").join("driver").join(name),
        "mirror" => game_path.to_path_buf(),
        _ => return None,
    })
}

pub fn target_relative(kind: &str, name: &str, car: Option<&str>) -> String {
    match kind {
        "car" => format!("content/cars/{name}"),
        "track" => format!("content/tracks/{name}"),
        "skin" => format!("content/cars/{}/skins/{name}", car.unwrap_or("")),
        "app" => format!("apps/python/{name}"),
        "ppfilter" => "system/cfg/ppfilters".into(),
        "font" => format!("content/fonts/{name}"),
        "weather" => format!("content/weather/{name}"),
        "driver" => format!("content/driver/{name}"),
        "mirror" => "<game root>".into(),
        _ => String::new(),
    }
}

fn list_disk_files(dir: &Path) -> HashSet<String> {
    let mut out = HashSet::new();
    for e in walkdir::WalkDir::new(dir).min_depth(1).max_depth(MAX_DEPTH + 1).into_iter().flatten() {
        if e.file_type().is_file() {
            if let Ok(r) = e.path().strip_prefix(dir) {
                out.insert(norm_rel(&r.to_string_lossy()));
            }
        }
    }
    out
}

pub fn build_plan(game_path: Option<&Path>, mut items: Vec<Item>) -> Vec<Item> {
    for it in items.iter_mut() {
        it.target_dir = game_path.and_then(|g| target_for(g, &it.kind, &it.name, it.car.as_deref())).map(|p| p.to_string_lossy().to_string());
        it.target_relative = target_relative(&it.kind, &it.name, it.car.as_deref());
        it.file_count = it.files.len();
        it.size_bytes = it.files.iter().map(|f| f.size).sum();
        it.status = "new".into();
        it.overwrite_count = 0;
        it.add_count = it.files.len();
        if let Some(td) = it.target_dir.as_deref().map(Path::new).filter(|p| p.exists()) {
            let existing = list_disk_files(td);
            let incoming: HashSet<String> = it.files.iter().map(|f| norm_rel(&f.rel)).collect();
            let overwrite = incoming.iter().filter(|r| existing.contains(*r)).count();
            let add = incoming.len() - overwrite;
            it.overwrite_count = overwrite;
            it.add_count = add;
            it.status = if overwrite == 0 && add == 0 { "same".into() } else { "update".into() };
        }
        if it.id.is_empty() {
            it.id = format!("{}:{}", it.kind, it.name);
        }
    }
    items
}

/* ------------------------------------------------------------------ */
/*  Sanitise renderer input                                            */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawItem {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub car: Option<String>,
    #[serde(default)]
    pub source_root: Option<String>,
    #[serde(default)]
    pub files: Vec<RawFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawFile {
    #[serde(default)]
    pub rel: Option<String>,
    #[serde(default)]
    pub size: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct SafeItem {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub car: Option<String>,
    pub source_root: String,
    pub files: Vec<PlanFile>,
}

fn clean_name(s: &str) -> String {
    let n: String = s.replace(['\\', '/'], "_").replace("..", "_");
    n.chars().take(120).collect()
}

pub fn sanitize_install_items(items: &[RawItem]) -> Vec<SafeItem> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for it in items {
        let Some(kind) = it.kind.as_deref().filter(|k| CONTENT_TYPES.contains(k)) else { continue };
        let name = { let n = clean_name(it.name.as_deref().unwrap_or("item")); if n.is_empty() { "item".to_string() } else { n } };
        let source_root = match it.source_root.as_deref().filter(|s| !s.is_empty()) {
            Some(sr) => match safe_rel(sr) { Some(s) => s, None => continue },
            None => String::new(),
        };
        let car = if kind == "skin" { Some(clean_name(it.car.as_deref().unwrap_or(""))) } else { None };
        let id: String = it.id.clone().unwrap_or_else(|| format!("{kind}:{name}")).chars().take(200).collect();
        if !seen.insert(id.clone()) {
            continue;
        }
        let files: Vec<PlanFile> = it.files.iter().filter_map(|f| safe_rel(f.rel.as_deref()?).map(|rel| PlanFile { rel, size: f.size.unwrap_or(0.0).max(0.0) as u64 })).collect();
        if files.is_empty() {
            continue;
        }
        out.push(SafeItem { id, kind: kind.into(), name, car, source_root, files });
    }
    out
}

/* ------------------------------------------------------------------ */
/*  Execution                                                          */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecFile {
    pub rel: String,
    pub dest: String,
    pub existed: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecItem {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    pub status: String,
    pub installed_files: Vec<ExecFile>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecProgress {
    pub done: usize,
    pub total: usize,
    pub item: ExecItem,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutcome {
    pub success: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub installed_count: usize,
    pub items: Vec<ExecItem>,
}

fn fail(error: &str) -> ExecOutcome {
    ExecOutcome { success: false, cancelled: false, error: Some(error.into()), installed_count: 0, items: vec![] }
}

fn extract_to_staging(source: &Source, staging: &Path, password: Option<&str>) -> archive::Result<Option<PathBuf>> {
    fs::create_dir_all(staging)?;
    if source.kind == "folder" {
        return Ok(Some(source.path().to_path_buf()));
    }
    if source.is_zip() {
        archive::extract_zip_to(source.path(), staging)?;
        return Ok(Some(staging.to_path_buf()));
    }
    if source.is_rar() {
        archive::extract_rar_to(source.path(), staging, password)?;
        return Ok(Some(staging.to_path_buf()));
    }
    Ok(None)
}

fn copy_with_backup(src: &Path, dest: &Path, game: &Path, backups_dir: &Path, id: &str) -> std::io::Result<(bool, Option<String>)> {
    let existed = dest.exists();
    let mut backup = None;
    if existed {
        let rel = crate::util::rel_from(game, dest).unwrap_or_else(|| dest.to_string_lossy().to_string());
        let b = backups_dir.join(id).join("backup").join(format!("{rel}.bak"));
        if let Some(p) = b.parent() {
            fs::create_dir_all(p)?;
        }
        fs::copy(dest, &b)?;
        backup = Some(b.to_string_lossy().to_string());
    }
    if let Some(p) = dest.parent() {
        fs::create_dir_all(p)?;
    }
    fs::copy(src, dest)?;
    Ok((existed, backup))
}

pub fn execute_install(
    source_path: &str,
    items: &[SafeItem],
    game_path: &str,
    backups_dir: &Path,
    password: Option<&str>,
    on_progress: &dyn Fn(ExecProgress),
    is_cancelled: &dyn Fn() -> bool,
) -> ExecOutcome {
    let game = Path::new(game_path);
    if game_path.is_empty() || !game.exists() {
        return fail("INVALID_GAME_PATH");
    }
    if items.is_empty() {
        return fail("NO_ITEMS");
    }
    let source = detect_source_kind(source_path);
    if source.kind != "folder" && source.kind != "archive" {
        return fail("BAD_SOURCE");
    }

    let staging_root = game.join(".uhm-staging").join(now_millis().to_string());
    let staging_base = match extract_to_staging(&source, &staging_root, password) {
        Ok(Some(p)) => p,
        Ok(None) => { let _ = fs::remove_dir_all(&staging_root); return fail("EXTRACT_FAILED"); }
        Err(e) => {
            let _ = fs::remove_dir_all(&staging_root);
            let pw_fail = matches!(e.rar_kind(), RarErrorKind::MissingPassword | RarErrorKind::BadPassword | RarErrorKind::BadData);
            return fail(if pw_fail { "PASSWORD_INCORRECT" } else { "EXTRACT_FAILED" });
        }
    };

    let total = items.len();
    let mut done = 0usize;
    let mut cancelled = false;
    let mut results: Vec<ExecItem> = Vec::with_capacity(total);

    for it in items {
        if is_cancelled() {
            cancelled = true;
            break;
        }
        done += 1;
        let mut result = ExecItem { id: it.id.clone(), kind: it.kind.clone(), name: it.name.clone(), status: "pending".into(), installed_files: vec![], error: None };
        on_progress(ExecProgress { done, total, item: result.clone(), stage: "start".into() });

        match target_for(game, &it.kind, &it.name, it.car.as_deref()) {
            None => {
                result.status = "error".into();
                result.error = Some("BAD_TARGET".into());
            }
            Some(target_dir) => {
                let src_root = if it.source_root.is_empty() { staging_base.clone() } else { staging_base.join(&it.source_root) };
                let mut err: Option<String> = None;
                for f in &it.files {
                    if is_cancelled() {
                        cancelled = true;
                        break;
                    }
                    let Some(rel) = safe_rel(&f.rel) else { continue };
                    let src_file = src_root.join(&rel);
                    let dest_file = target_dir.join(&rel);
                    if !src_file.exists() {
                        continue;
                    }
                    match copy_with_backup(&src_file, &dest_file, game, backups_dir, &it.id) {
                        Ok((existed, backup_path)) => result.installed_files.push(ExecFile { rel, dest: dest_file.to_string_lossy().to_string(), existed, backup_path }),
                        Err(e) => { err = Some(e.to_string()); break; }
                    }
                }
                if let Some(e) = err {
                    result.status = "error".into();
                    result.error = Some(e);
                } else if cancelled {
                    result.status = "skipped".into();
                } else if result.installed_files.is_empty() {
                    result.status = "error".into();
                    result.error = Some("FILES_MISSING".into());
                } else {
                    result.status = "installed".into();
                }
            }
        }
        on_progress(ExecProgress { done, total, item: result.clone(), stage: result.status.clone() });
        results.push(result);
    }

    let _ = fs::remove_dir_all(&staging_root);
    let _ = fs::remove_dir(game.join(".uhm-staging")); // only if empty

    let has_errors = results.iter().any(|r| r.status == "error");
    let installed_count = results.iter().filter(|r| r.status == "installed").count();
    ExecOutcome {
        success: !cancelled && !has_errors && installed_count > 0,
        cancelled,
        error: if cancelled { Some("CANCELLED".into()) } else if has_errors { Some("SOME_FAILED".into()) } else { None },
        installed_count,
        items: results,
    }
}

/* ------------------------------------------------------------------ */
/*  Public analysis API                                                */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub label: String,
    pub kind: String,
    pub archive_type: Option<String>,
    pub size_bytes: u64,
    pub entry_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encrypted: Option<String>,
    pub source: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<Item>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_items: Option<usize>,
}

fn analysis_err(error: &str, source: &Source) -> Analysis {
    Analysis { ok: false, error: Some(error.into()), format: None, encrypted: None, source: serde_json::to_value(source).unwrap_or(Value::Null), items: None, warnings: None, total_size: None, total_items: None }
}

pub fn analyze_source(source_path: &str, game_path: Option<&str>, password: Option<&str>) -> Analysis {
    let password = password.filter(|p| !p.is_empty());
    let source = detect_source_kind(source_path);
    match source.kind.as_str() {
        "invalid" | "missing" => {
            return Analysis { source: serde_json::json!({ "label": source.label }), ..analysis_err("SOURCE_MISSING", &source) };
        }
        "unsupported" => {
            let mut a = analysis_err("UNSUPPORTED_FORMAT", &source);
            a.format = source.format.clone();
            return a;
        }
        "unknown" => {
            let mut a = analysis_err("UNSUPPORTED_FORMAT", &source);
            let e = ext_lower(Path::new(source_path));
            a.format = Some(if e.is_empty() { "unknown".into() } else { e });
            return a;
        }
        _ => {}
    }

    let entries: Vec<Entry> = if source.is_rar() {
        match archive::probe_rar(source.path(), password) {
            Ok(meta) => {
                if meta.encrypted && password.is_none() {
                    let mut a = analysis_err("PASSWORD_REQUIRED", &source);
                    a.encrypted = Some(if meta.header_encrypted { "header".into() } else { "files".into() });
                    return a;
                }
                if meta.encrypted {
                    if let Some(pw) = password {
                        if !archive::verify_rar_password(source.path(), &meta.encrypted_files, pw) {
                            return analysis_err("PASSWORD_INCORRECT", &source);
                        }
                    }
                }
                meta.entries
            }
            Err(e) => {
                return match e.rar_kind() {
                    RarErrorKind::MissingPassword => { let mut a = analysis_err("PASSWORD_REQUIRED", &source); a.encrypted = Some("header".into()); a }
                    RarErrorKind::BadPassword | RarErrorKind::BadData => analysis_err(if password.is_some() { "PASSWORD_INCORRECT" } else { "READ_FAILED" }, &source),
                    RarErrorKind::Other => analysis_err("READ_FAILED", &source),
                };
            }
        }
    } else {
        match list_source_entries(&source) {
            Ok(e) => e,
            Err(_) => return analysis_err("READ_FAILED", &source),
        }
    };

    let detected = detect_mods(&entries);
    let items = hydrate_items(&source, detected.items, password);
    let items = build_plan(game_path.filter(|g| !g.is_empty()).map(Path::new), items);
    let total_size: u64 = items.iter().map(|i| i.size_bytes).sum();

    Analysis {
        ok: true,
        error: None,
        format: None,
        encrypted: None,
        source: serde_json::to_value(SourceSummary {
            label: source.label.clone(),
            kind: source.kind.clone(),
            archive_type: source.archive_type.clone(),
            size_bytes: source.size_bytes.unwrap_or(total_size),
            entry_count: entries.len(),
        }).unwrap_or(Value::Null),
        total_items: Some(items.len()),
        items: Some(items),
        warnings: Some(detected.warnings),
        total_size: Some(total_size),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, s: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }

    fn mixed_source(root: &Path) {
        write(&root.join("content/cars/my_car/ui/ui_car.json"), r#"{"name":"My Car","brand":"MyBrand"}"#);
        write(&root.join("content/cars/my_car/data.acd"), "ACD");
        write(&root.join("content/cars/my_car/skins/red/livery.png"), "png");
        write(&root.join("content/tracks/my_track/ui/ui_track.json"), r#"{"name":"My Track"}"#);
        write(&root.join("content/tracks/my_track/models.ini"), "[MODEL]");
        write(&root.join("content/cars/other_car/skins/blue/ui_skin.json"), r#"{"name":"Blue"}"#);
        write(&root.join("content/cars/other_car/skins/blue/livery.png"), "png");
        write(&root.join("apps/python/myapp/myapp.py"), "print(1)");
        write(&root.join("system/cfg/ppfilters/uhm_filter.ini"), "[FOG]");
        write(&root.join("content/fonts/myfont/myfont.txt"), "font");
    }

    #[test]
    fn detects_mixed_content() {
        let tmp = tempfile::tempdir().unwrap();
        mixed_source(tmp.path());
        let d = detect_mods(&list_folder_entries(tmp.path()));
        let kinds: Vec<(String, String)> = d.items.iter().map(|i| (i.kind.clone(), i.name.clone())).collect();
        assert!(kinds.contains(&("car".into(), "my_car".into())), "{kinds:?}");
        assert!(kinds.contains(&("track".into(), "my_track".into())));
        assert!(kinds.contains(&("skin".into(), "blue".into())));
        assert!(kinds.contains(&("app".into(), "myapp".into())));
        assert!(kinds.contains(&("ppfilter".into(), "uhm_filter.ini".into())));
        assert!(kinds.contains(&("font".into(), "myfont".into())));
        let skin = d.items.iter().find(|i| i.kind == "skin").unwrap();
        assert_eq!(skin.car.as_deref(), Some("other_car"));
        // red skin belongs to my_car and must NOT be a standalone item
        assert!(!d.items.iter().any(|i| i.kind == "skin" && i.name == "red"));
        let car = d.items.iter().find(|i| i.kind == "car").unwrap();
        assert_eq!(car.files.len(), 3);
        assert!(d.warnings.is_empty());
    }

    #[test]
    fn wrapper_folder_is_stripped() {
        let tmp = tempfile::tempdir().unwrap();
        write(&tmp.path().join("Some Mod v1/content/cars/x_car/data.acd"), "a");
        let d = detect_mods(&list_folder_entries(tmp.path()));
        assert_eq!(d.items[0].kind, "car");
        assert_eq!(d.items[0].source_root, "Some Mod v1/content/cars/x_car");
        assert_eq!(d.root.as_deref(), Some("Some Mod v1/"));
        assert_eq!(d.items[0].files.len(), 1);
    }

    /// A mod zipped inside a wrapper folder must analyze with metadata AND
    /// install to the real target — this is the most common real-world layout.
    #[test]
    fn wrapped_mod_installs_end_to_end() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let game = tmp.path().join("game");
        write(&src.join("Cool Pack v2/content/cars/w_car/ui/ui_car.json"), r#"{"name":"Wrapped Car"}"#);
        write(&src.join("Cool Pack v2/content/cars/w_car/data.acd"), "ACD");
        write(&game.join("content/cars/.keep"), "");

        let a = analyze_source(src.to_str().unwrap(), Some(game.to_str().unwrap()), None);
        assert!(a.ok, "{a:?}");
        let items = a.items.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].display_name, "Wrapped Car", "metadata must resolve through the wrapper");
        assert_eq!(items[0].target_relative, "content/cars/w_car");

        let raw: Vec<RawItem> = items.iter().map(|i| RawItem {
            id: Some(i.id.clone()), kind: Some(i.kind.clone()), name: Some(i.name.clone()), car: i.car.clone(),
            source_root: Some(i.source_root.clone()), files: i.files.iter().map(|f| RawFile { rel: Some(f.rel.clone()), size: Some(f.size as f64) }).collect(),
        }).collect();
        let safe = sanitize_install_items(&raw);
        let backups = tmp.path().join("backups");
        let out = execute_install(src.to_str().unwrap(), &safe, game.to_str().unwrap(), &backups, None, &|_| {}, &|| false);
        assert!(out.success, "{out:?}");
        assert_eq!(fs::read_to_string(game.join("content/cars/w_car/data.acd")).unwrap(), "ACD");
        assert!(game.join("content/cars/w_car/ui/ui_car.json").exists());
    }

    #[test]
    fn analyze_plan_and_execute_with_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let game = tmp.path().join("game");
        mixed_source(&src);
        write(&game.join("content/cars/my_car/data.acd"), "OLD");

        let a = analyze_source(src.to_str().unwrap(), Some(game.to_str().unwrap()), None);
        assert!(a.ok, "{a:?}");
        let items = a.items.unwrap();
        let car = items.iter().find(|i| i.kind == "car").unwrap();
        assert_eq!(car.display_name, "My Car");
        assert_eq!(car.brand.as_deref(), Some("MyBrand"));
        assert_eq!(car.status, "update");
        assert_eq!(car.overwrite_count, 1);
        assert_eq!(car.add_count, 2);
        assert_eq!(car.target_relative, "content/cars/my_car");

        let raw: Vec<RawItem> = items.iter().map(|i| RawItem {
            id: Some(i.id.clone()), kind: Some(i.kind.clone()), name: Some(i.name.clone()), car: i.car.clone(),
            source_root: Some(i.source_root.clone()), files: i.files.iter().map(|f| RawFile { rel: Some(f.rel.clone()), size: Some(f.size as f64) }).collect(),
        }).collect();
        let safe = sanitize_install_items(&raw);
        assert_eq!(safe.len(), items.len());
        let out = execute_install(src.to_str().unwrap(), &safe, game.to_str().unwrap(), &tmp.path().join("backups"), None, &|_| {}, &|| false);
        assert!(out.success, "{out:?}");
        assert_eq!(fs::read_to_string(game.join("content/cars/my_car/data.acd")).unwrap(), "ACD");
        assert!(game.join("apps/python/myapp/myapp.py").exists());
        assert!(game.join("system/cfg/ppfilters/uhm_filter.ini").exists());
        assert!(game.join("content/cars/other_car/skins/blue/livery.png").exists());
        assert!(!game.join(".uhm-staging").exists());
        let car_r = out.items.iter().find(|i| i.kind == "car").unwrap();
        assert!(car_r.installed_files.iter().any(|f| f.existed && f.backup_path.is_some()));
    }

    #[test]
    fn sanitize_rejects_traversal() {
        let raw = vec![
            RawItem { id: None, kind: Some("car".into()), name: Some("../../evil".into()), car: None, source_root: Some("../x".into()), files: vec![RawFile { rel: Some("a".into()), size: None }] },
            RawItem { id: None, kind: Some("car".into()), name: Some("ok".into()), car: None, source_root: None, files: vec![RawFile { rel: Some("../a".into()), size: None }, RawFile { rel: Some("b".into()), size: None }] },
            RawItem { id: None, kind: Some("hax".into()), name: Some("x".into()), car: None, source_root: None, files: vec![RawFile { rel: Some("a".into()), size: None }] },
        ];
        let safe = sanitize_install_items(&raw);
        assert_eq!(safe.len(), 1);
        assert_eq!(safe[0].name, "ok");
        assert_eq!(safe[0].files.len(), 1);
    }

    #[test]
    fn rar_password_flow() {
        let fx = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures");
        let a = analyze_source(fx.join("HeaderEnc1234.rar").to_str().unwrap(), None, None);
        assert_eq!(a.error.as_deref(), Some("PASSWORD_REQUIRED"));
        assert_eq!(a.encrypted.as_deref(), Some("header"));
        let a = analyze_source(fx.join("HeaderEnc1234.rar").to_str().unwrap(), None, Some("nope"));
        assert_eq!(a.error.as_deref(), Some("PASSWORD_INCORRECT"));
        let a = analyze_source(fx.join("FileEncByName.rar").to_str().unwrap(), None, None);
        assert_eq!(a.encrypted.as_deref(), Some("files"));
        let a = analyze_source(fx.join("FileEncByName.rar").to_str().unwrap(), None, Some("3Sec"));
        assert!(a.ok, "{a:?}"); // plain text files -> NOTHING_DETECTED but ok
        assert_eq!(a.warnings.unwrap(), vec!["NOTHING_DETECTED".to_string()]);
        let a = analyze_source(fx.join("nothing.7z").to_str().unwrap(), None, None);
        assert_eq!(a.error.as_deref(), Some("SOURCE_MISSING"));
    }
}
