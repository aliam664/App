//! Content library — port of `src/lib/library.js`.
//!
//! Scans `content/cars` and `content/tracks`, extracts metadata and preview
//! paths, and manages a safe soft-delete trash store. It only writes to the
//! game folder when the user explicitly deletes or restores an item.

use crate::util::{copy_dir_all, lexical_normalize, now_iso, read_json_or, safe_leaf, write_json_atomic};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const CAR_PREVIEW_CANDIDATES: &[&str] = &[
    "ui/preview.png", "ui/preview.jpg", "ui/preview.jpeg",
    "ui/preview_light.png", "ui/preview_light.jpg", "ui/preview_light.jpeg",
    "ui/preview_2.png", "ui/preview_2.jpg", "ui/preview_2.jpeg",
    "preview.png", "preview.jpg", "preview.jpeg", "ui/ui_preview.jpg",
];

pub const TRACK_PREVIEW_CANDIDATES: &[&str] = &[
    "ui/preview.png", "ui/preview.jpg", "ui/preview.jpeg",
    "ui/preview_light.png", "ui/preview_light.jpg", "ui/preview_light.jpeg",
    "preview.png", "preview.jpg", "preview.jpeg", "ui/ui_preview.jpg",
    "ui/preview_2.png", "ui/preview_2.jpg", "ui/preview_2.jpeg",
];

static KNOWN_DLC_PREFIXES: &[&str] = &["bm_", "am_", "truck_", "kart_", "mclaren_", "lotus_", "gtr_", "csr_", "dr_"];

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

fn read_json_silent(file: &Path) -> Option<Value> {
    let text = fs::read_to_string(file).ok()?;
    serde_json::from_str(&text).ok()
}

fn ui_value(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Object(m)) => {
            let keys = ["en", "EN", "English", "en-US", "ENGLISH", "italian", "it", "zh", "ko", "jp", "ru", "fr", "de", "es"];
            let pick = keys.iter().find_map(|k| m.get(*k)).or_else(|| m.values().next());
            match pick {
                Some(Value::String(s)) => s.trim().to_string(),
                Some(other) if !other.is_null() => other.to_string().trim_matches('"').to_string(),
                _ => String::new(),
            }
        }
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string().trim_matches('"').to_string(),
    }
}

fn number_or_unit(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Object(m)) => {
            for (k, val) in m {
                match val {
                    Value::Number(n) => return format!("{n}{k}"),
                    Value::String(s) => return format!("{s}{k}"),
                    _ => {}
                }
            }
            ui_value(v)
        }
        Some(other) => other.to_string(),
    }
}

fn get<'a>(obj: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    let m = obj.as_object()?;
    keys.iter().find_map(|k| m.get(*k)).filter(|v| !v.is_null())
}

fn list_content_folders(root: &Path) -> Vec<String> {
    let Ok(rd) = fs::read_dir(root) else { return vec![] };
    let mut out: Vec<String> = rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).map(|e| e.file_name().to_string_lossy().to_string()).collect();
    out.sort();
    out
}

pub fn resolve_safe_path(base: &Path, rel: &str, allow_root: bool) -> Option<PathBuf> {
    if rel.is_empty() {
        return None;
    }
    let resolved = lexical_normalize(&base.join(rel));
    let base_n = lexical_normalize(base);
    if resolved == base_n {
        return if allow_root { Some(resolved) } else { None };
    }
    if resolved.starts_with(&base_n) {
        Some(resolved)
    } else {
        None
    }
}

/* ------------------------------------------------------------------ */
/*  Folder stats                                                       */
/* ------------------------------------------------------------------ */

struct Stats {
    size_bytes: u64,
    file_count: u64,
    modified_at: Option<String>,
}

fn folder_stats(dir: &Path) -> Stats {
    let modified_at = fs::metadata(dir).ok().and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    let mut size_bytes = 0u64;
    let mut file_count = 0u64;
    for e in walkdir::WalkDir::new(dir).max_depth(13).into_iter().flatten() {
        if e.file_type().is_file() {
            size_bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            file_count += 1;
        }
    }
    Stats { size_bytes, file_count, modified_at }
}

/* ------------------------------------------------------------------ */
/*  Preview / skins / layouts                                          */
/* ------------------------------------------------------------------ */

struct Preview {
    primary: Option<String>,
    variants: Vec<String>,
}

fn find_preview(base: &Path, is_car: bool) -> Preview {
    let cands = if is_car { CAR_PREVIEW_CANDIDATES } else { TRACK_PREVIEW_CANDIDATES };
    let found: Vec<String> = cands.iter().filter(|rel| base.join(rel).is_file()).map(|s| s.to_string()).collect();
    Preview { primary: found.first().cloned(), variants: found }
}

fn find_car_skins(car_dir: &Path) -> Vec<String> {
    list_content_folders(&car_dir.join("skins"))
}

fn find_car_preview(car_dir: &Path) -> Preview {
    let direct = find_preview(car_dir, true);
    if direct.primary.is_some() {
        return direct;
    }
    for skin in find_car_skins(car_dir) {
        let found = find_preview(&car_dir.join("skins").join(&skin), true);
        if found.primary.is_some() {
            return Preview {
                primary: found.primary.map(|p| format!("skins/{skin}/{p}")),
                variants: found.variants.iter().map(|v| format!("skins/{skin}/{v}")).collect(),
            };
        }
    }
    direct
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub folder: String,
    pub name: String,
    pub country: String,
    pub city: String,
    pub length: String,
    pub has_info: bool,
    pub preview: Option<String>,
}

fn find_track_layouts(track_dir: &Path) -> Vec<Layout> {
    let ui_dir = track_dir.join("ui");
    let mut out = Vec::new();
    for folder in list_content_folders(&ui_dir) {
        let lower = folder.to_lowercase();
        let is_layout = lower.starts_with("layout_") && lower["layout_".len()..].chars().all(|c| c.is_ascii_digit()) && lower.len() > "layout_".len();
        if !is_layout {
            continue;
        }
        let dir = ui_dir.join(&folder);
        let ui = read_json_silent(&dir.join("ui_track.json")).unwrap_or(Value::Null);
        let im = read_json_silent(&dir.join("im.ini"));
        let name = ui_value(get(&ui, &["name"]));
        out.push(Layout {
            name: if name.is_empty() { folder.clone() } else { name },
            country: ui_value(get(&ui, &["country"])),
            city: ui_value(get(&ui, &["city"])),
            length: number_or_unit(get(&ui, &["length"])),
            has_info: im.is_some(),
            preview: find_preview(&dir, false).primary,
            folder,
        });
    }
    out.sort_by(|a, b| a.folder.cmp(&b.folder));
    out
}

/* ------------------------------------------------------------------ */
/*  Classification                                                     */
/* ------------------------------------------------------------------ */

pub struct Class {
    pub is_kunos: bool,
    pub is_dlc: bool,
    pub is_mod: bool,
    pub origin: &'static str,
}

pub fn classify_content(folder: &str) -> Class {
    let lower = folder.to_lowercase();
    let is_kunos = lower.starts_with("ks_");
    let is_dlc = !is_kunos && KNOWN_DLC_PREFIXES.iter().any(|p| lower.starts_with(p));
    let is_mod = !is_kunos && !is_dlc;
    Class { is_kunos, is_dlc, is_mod, origin: if is_kunos { "kunos" } else if is_dlc { "dlc" } else { "mod" } }
}

/* ------------------------------------------------------------------ */
/*  Scanning                                                           */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
    pub folder: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryResult {
    pub game_root: Option<String>,
    pub content_root: Option<String>,
    pub cars: Vec<Value>,
    pub tracks: Vec<Value>,
    pub errors: Vec<String>,
}

fn scan_cars(game: &Path, on_progress: &dyn Fn(ScanProgress)) -> Vec<Value> {
    let cars_root = game.join("content").join("cars");
    let folders = list_content_folders(&cars_root);
    let total = folders.len();
    let mut out = Vec::with_capacity(total);
    for (i, folder) in folders.iter().enumerate() {
        let car_dir = cars_root.join(folder);
        let ui_path = car_dir.join("ui").join("ui_car.json");
        let ui = read_json_silent(&ui_path).unwrap_or(Value::Null);
        let car_json = read_json_silent(&car_dir.join("data").join("car.json")).unwrap_or(Value::Null);
        let specs = get(&ui, &["specs", "Specs"]).cloned().unwrap_or(Value::Null);
        let power = number_or_unit(get(&specs, &["power", "hp", "POWER", "HP"]));
        let weight = number_or_unit(get(&specs, &["weight", "mass", "WEIGHT"]));
        let torque = number_or_unit(get(&specs, &["torque", "NM", "Nm"]));
        let top_speed = number_or_unit(get(&specs, &["topSpeed", "topspeed", "top speed"]));
        let mut name = ui_value(get(&ui, &["name"]));
        if name.is_empty() { name = ui_value(get(&car_json, &["name"])); }
        if name.is_empty() { name = folder.clone(); }
        let mut brand = ui_value(get(&ui, &["brand"]));
        if brand.is_empty() { brand = ui_value(get(&car_json, &["brand"])); }
        let klass = { let k = ui_value(get(&ui, &["class", "_class", "carClass"])); if k.is_empty() { ui_value(get(&car_json, &["class"])) } else { k } };
        let year = { let y = number_or_unit(get(&ui, &["year"])); if y.is_empty() { number_or_unit(get(&car_json, &["year"])) } else { y } };
        let country = { let c = ui_value(get(&ui, &["country"])); if c.is_empty() { ui_value(get(&car_json, &["country"])) } else { c } };
        let description = { let d = ui_value(get(&ui, &["description"])); if d.is_empty() { ui_value(get(&car_json, &["description"])) } else { d } };

        let preview = find_car_preview(&car_dir);
        let stats = folder_stats(&car_dir);
        let skins = find_car_skins(&car_dir);
        let cls = classify_content(folder);

        out.push(serde_json::json!({
            "type": "car",
            "id": format!("car:{folder}"),
            "folder": folder,
            "name": name,
            "brand": brand,
            "klass": klass,
            "year": year,
            "country": country,
            "description": description,
            "specs": { "power": power, "torque": torque, "weight": weight, "topSpeed": top_speed },
            "hasSpecs": !(power.is_empty() && torque.is_empty() && weight.is_empty() && top_speed.is_empty()),
            "uiPath": ui_path.to_string_lossy().replace('\\', "/"),
            "hasUi": ui_path.exists(),
            "preview": preview.primary.as_ref().map(|p| format!("content/cars/{folder}/{p}")),
            "previewVariants": preview.variants,
            "hasPreview": preview.primary.is_some(),
            "isKunos": cls.is_kunos, "isDlc": cls.is_dlc, "isMod": cls.is_mod, "origin": cls.origin,
            "skinCount": skins.len(),
            "skins": skins.iter().take(20).collect::<Vec<_>>(),
            "hasData": car_dir.join("data").exists(),
            "hasSound": car_dir.join("sfx").exists(),
            "hasCamera": car_dir.join("cameras").exists(),
            "sizeBytes": stats.size_bytes,
            "fileCount": stats.file_count,
            "modifiedAt": stats.modified_at,
        }));
        on_progress(ScanProgress { phase: "cars", done: i + 1, total, folder: folder.clone() });
    }
    out.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
    out
}

fn scan_tracks(game: &Path, on_progress: &dyn Fn(ScanProgress)) -> Vec<Value> {
    let root = game.join("content").join("tracks");
    let folders = list_content_folders(&root);
    let total = folders.len();
    let mut out = Vec::with_capacity(total);
    for (i, folder) in folders.iter().enumerate() {
        let dir = root.join(folder);
        let ui = read_json_silent(&dir.join("ui").join("ui_track.json"));
        let u = ui.clone().unwrap_or(Value::Null);
        let preview = find_preview(&dir, false);
        let stats = folder_stats(&dir);
        let layouts = find_track_layouts(&dir);
        let cls = classify_content(folder);
        let location = { let l = ui_value(get(&u, &["location"])); if l.is_empty() { ui_value(get(&u, &["region"])) } else { l } };
        out.push(serde_json::json!({
            "type": "track",
            "id": format!("track:{folder}"),
            "folder": folder,
            "name": ui_value(get(&u, &["name"])),
            "country": ui_value(get(&u, &["country"])),
            "city": ui_value(get(&u, &["city"])),
            "location": location,
            "length": number_or_unit(get(&u, &["length"])),
            "width": number_or_unit(get(&u, &["width"])),
            "description": ui_value(get(&u, &["description"])),
            "hasUi": ui.is_some(),
            "preview": preview.primary.as_ref().map(|p| format!("content/tracks/{folder}/{p}")),
            "previewVariants": preview.variants,
            "hasPreview": preview.primary.is_some(),
            "isKunos": cls.is_kunos, "isDlc": cls.is_dlc, "isMod": cls.is_mod, "origin": cls.origin,
            "layoutCount": layouts.len().max(1),
            "layouts": layouts,
            "hasModels": dir.join("models.ini").exists() || dir.join("data").join("models.ini").exists(),
            "sizeBytes": stats.size_bytes,
            "fileCount": stats.file_count,
            "modifiedAt": stats.modified_at,
        }));
        on_progress(ScanProgress { phase: "tracks", done: i + 1, total, folder: folder.clone() });
    }
    out.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
    out
}

pub fn scan_library(game_path: &str, on_progress: &dyn Fn(ScanProgress)) -> LibraryResult {
    let game = Path::new(game_path);
    if game_path.is_empty() || !game.exists() {
        return LibraryResult { game_root: None, content_root: None, cars: vec![], tracks: vec![], errors: vec!["GAME_PATH_MISSING".into()] };
    }
    LibraryResult {
        game_root: Some(game_path.to_string()),
        content_root: Some(game.join("content").to_string_lossy().to_string()),
        cars: scan_cars(game, on_progress),
        tracks: scan_tracks(game, on_progress),
        errors: vec![],
    }
}

/* ------------------------------------------------------------------ */
/*  Trash                                                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub folder: String,
    pub original_path: String,
    pub trash_path: String,
    pub deleted_at: String,
    #[serde(default)]
    pub is_kunos: bool,
    #[serde(default)]
    pub is_dlc: bool,
    #[serde(default)]
    pub is_mod: bool,
    #[serde(default)]
    pub origin: Option<String>,
}

fn load_trash(trash_path: &Path) -> Vec<TrashEntry> {
    read_json_or(trash_path, Vec::new())
}

fn save_trash(trash_path: &Path, list: &[TrashEntry]) -> std::io::Result<()> {
    write_json_atomic(trash_path, &list)
}

fn trash_timestamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn content_root_for(game: &Path, kind: &str) -> Option<PathBuf> {
    match kind {
        "car" => Some(game.join("content").join("cars")),
        "track" => Some(game.join("content").join("tracks")),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trash_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trash_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<Vec<String>>,
}

fn err(e: impl Into<String>) -> OpResult {
    OpResult { success: false, error: Some(e.into()), ..Default::default() }
}

pub fn move_to_trash(game_path: &str, kind: &str, folder: &str, trash_path: &Path, trash_dir: &Path) -> OpResult {
    let game = Path::new(game_path);
    let Some(content_root) = (if game_path.is_empty() { None } else { content_root_for(game, kind) }) else { return err("INVALID_TYPE") };
    if folder.is_empty() || folder.contains("..") || Path::new(folder).is_absolute() || folder.contains(['/', '\\']) {
        return err("INVALID_FOLDER");
    }
    let source = content_root.join(folder);
    if !source.exists() {
        return err("NOT_FOUND");
    }
    let stamp = trash_timestamp();
    let id = format!("{stamp}_{}", safe_leaf(folder));
    let trash_root = trash_dir.join(&id);
    let moved: std::io::Result<()> = (|| {
        fs::create_dir_all(trash_dir)?;
        copy_dir_all(&source, &trash_root)?;
        fs::remove_dir_all(&source)
    })();
    if let Err(e) = moved {
        return err(e.to_string());
    }
    let cls = classify_content(folder);
    let mut trash = load_trash(trash_path);
    trash.insert(0, TrashEntry {
        id: id.clone(),
        kind: kind.into(),
        folder: folder.into(),
        original_path: source.to_string_lossy().to_string(),
        trash_path: trash_root.to_string_lossy().to_string(),
        deleted_at: now_iso(),
        is_kunos: cls.is_kunos,
        is_dlc: cls.is_dlc,
        is_mod: cls.is_mod,
        origin: Some(cls.origin.into()),
    });
    if let Err(e) = save_trash(trash_path, &trash) {
        return err(e.to_string());
    }
    OpResult { success: true, trash_id: Some(id), trash_path: Some(trash_root.to_string_lossy().to_string()), ..Default::default() }
}

pub fn restore_trash_item(trash_path: &Path, trash_id: &str) -> OpResult {
    let trash = load_trash(trash_path);
    let Some(entry) = trash.iter().find(|t| t.id == trash_id).cloned() else { return err("NOT_FOUND") };
    let src = Path::new(&entry.trash_path);
    if !entry.trash_path.is_empty() && !src.exists() {
        return err("TRASH_MISSING");
    }
    let target = PathBuf::from(&entry.original_path);
    let mut conflict: Option<String> = None;
    let r: std::io::Result<()> = (|| {
        if let Some(p) = target.parent() {
            fs::create_dir_all(p)?;
        }
        if target.exists() {
            let c = PathBuf::from(format!("{}.trash-conflict-{}", target.to_string_lossy(), crate::util::now_millis()));
            copy_dir_all(&target, &c)?;
            fs::remove_dir_all(&target)?;
            conflict = Some(c.to_string_lossy().to_string());
        }
        copy_dir_all(src, &target)?;
        fs::remove_dir_all(src)?;
        let rest: Vec<TrashEntry> = trash.into_iter().filter(|t| t.id != trash_id).collect();
        save_trash(trash_path, &rest)
    })();
    match r {
        Ok(()) => OpResult { success: true, conflict_path: conflict, ..Default::default() },
        Err(e) => err(e.to_string()),
    }
}

pub fn permanently_delete_trash_item(trash_path: &Path, trash_id: &str) -> OpResult {
    let trash = load_trash(trash_path);
    let Some(entry) = trash.iter().find(|t| t.id == trash_id).cloned() else {
        return OpResult { success: false, error: Some("NOT_FOUND".into()), deleted: Some(vec![]), ..Default::default() };
    };
    let p = Path::new(&entry.trash_path);
    if !entry.trash_path.is_empty() && p.exists() {
        if let Err(e) = fs::remove_dir_all(p) {
            return OpResult { success: false, error: Some(e.to_string()), deleted: Some(vec![]), ..Default::default() };
        }
    }
    let rest: Vec<TrashEntry> = trash.into_iter().filter(|t| t.id != trash_id).collect();
    let _ = save_trash(trash_path, &rest);
    OpResult { success: true, deleted: Some(vec![entry.folder]), ..Default::default() }
}

pub fn empty_trash(trash_path: &Path) -> OpResult {
    let trash = load_trash(trash_path);
    let mut deleted = Vec::new();
    let mut error = None;
    for e in &trash {
        let p = Path::new(&e.trash_path);
        if !e.trash_path.is_empty() && p.exists() {
            if let Err(er) = fs::remove_dir_all(p) {
                error = Some(er.to_string());
                continue;
            }
        }
        deleted.push(e.folder.clone());
    }
    let _ = save_trash(trash_path, &[]);
    OpResult { success: true, deleted: Some(deleted), error, ..Default::default() }
}

pub fn list_trash(trash_path: &Path) -> Vec<Value> {
    load_trash(trash_path)
        .into_iter()
        .map(|t| {
            let origin = t.origin.clone().unwrap_or_else(|| if t.is_kunos { "kunos".into() } else if t.is_dlc { "dlc".into() } else { "mod".into() });
            serde_json::json!({
                "id": t.id, "type": t.kind, "folder": t.folder,
                "originalPath": t.original_path, "trashPath": t.trash_path, "deletedAt": t.deleted_at,
                "isKunos": t.is_kunos, "isDlc": t.is_dlc, "isMod": t.is_mod, "origin": origin,
                "existsOnDisk": !t.trash_path.is_empty() && Path::new(&t.trash_path).exists(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, s: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }

    #[test]
    fn scan_cars_and_tracks() {
        let tmp = tempfile::tempdir().unwrap();
        let g = tmp.path();
        write(&g.join("content/cars/ks_abarth/ui/ui_car.json"), r#"{"name":"Abarth 500","brand":"Abarth","specs":{"power":"135bhp"},"year":2008}"#);
        write(&g.join("content/cars/ks_abarth/skins/red/preview.jpg"), "x");
        write(&g.join("content/cars/ks_abarth/data/car.json"), "{}");
        write(&g.join("content/cars/mod_car/ui/ui_car.json"), r#"{"name":{"en":"Mod Car"}}"#);
        write(&g.join("content/tracks/my_track/ui/layout_1/ui_track.json"), r#"{"name":"Layout A","length":"5km"}"#);
        write(&g.join("content/tracks/my_track/ui/ui_track.json"), r#"{"name":"My Track","country":"Italy"}"#);
        write(&g.join("content/tracks/my_track/models.ini"), "");
        let r = scan_library(g.to_str().unwrap(), &|_| {});
        assert_eq!(r.cars.len(), 2);
        let abarth = r.cars.iter().find(|c| c["folder"] == "ks_abarth").unwrap();
        assert_eq!(abarth["name"], "Abarth 500");
        assert_eq!(abarth["isKunos"], true);
        assert_eq!(abarth["hasSpecs"], true);
        assert_eq!(abarth["year"], "2008");
        assert_eq!(abarth["preview"], "content/cars/ks_abarth/skins/red/preview.jpg");
        assert_eq!(abarth["skinCount"], 1);
        let modc = r.cars.iter().find(|c| c["folder"] == "mod_car").unwrap();
        assert_eq!(modc["name"], "Mod Car");
        assert_eq!(modc["origin"], "mod");
        let t = &r.tracks[0];
        assert_eq!(t["name"], "My Track");
        assert_eq!(t["layoutCount"], 1);
        assert_eq!(t["layouts"][0]["name"], "Layout A");
        assert_eq!(t["hasModels"], true);
    }

    #[test]
    fn trash_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let g = tmp.path().join("game");
        let trash_json = tmp.path().join("trash.json");
        let trash_dir = tmp.path().join("trash");
        write(&g.join("content/cars/my_car/data.acd"), "d");

        assert_eq!(move_to_trash(g.to_str().unwrap(), "car", "../x", &trash_json, &trash_dir).error.as_deref(), Some("INVALID_FOLDER"));
        assert_eq!(move_to_trash(g.to_str().unwrap(), "car", "nope", &trash_json, &trash_dir).error.as_deref(), Some("NOT_FOUND"));
        let r = move_to_trash(g.to_str().unwrap(), "car", "my_car", &trash_json, &trash_dir);
        assert!(r.success, "{r:?}");
        assert!(!g.join("content/cars/my_car").exists());
        let list = list_trash(&trash_json);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["existsOnDisk"], true);
        let id = r.trash_id.unwrap();

        // conflict on restore
        write(&g.join("content/cars/my_car/new.txt"), "n");
        let r = restore_trash_item(&trash_json, &id);
        assert!(r.success && r.conflict_path.is_some());
        assert!(g.join("content/cars/my_car/data.acd").exists());
        assert!(list_trash(&trash_json).is_empty());

        let r = move_to_trash(g.to_str().unwrap(), "car", "my_car", &trash_json, &trash_dir);
        let id = r.trash_id.unwrap();
        let r = permanently_delete_trash_item(&trash_json, &id);
        assert!(r.success);
        assert!(list_trash(&trash_json).is_empty());
        assert!(empty_trash(&trash_json).success);
    }

    #[test]
    fn safe_path() {
        let base = Path::new("/g");
        assert!(resolve_safe_path(base, "content/x.png", false).is_some());
        assert!(resolve_safe_path(base, "../x.png", false).is_none());
        assert!(resolve_safe_path(base, ".", false).is_none());
        assert!(resolve_safe_path(base, ".", true).is_some());
    }
}
