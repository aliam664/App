//! UHM Pack Installer — Tauri backend.
//!
//! This module is the equivalent of the old Electron `main.js`: it wires the
//! IPC commands the webview calls (`window.uhm.*` → `invoke`) to the pure
//! Rust cores in the sibling modules.

mod archive;
mod catalog;
mod hardware;
mod installer;
mod library;
mod mod_installer;
mod preview;
mod profile;
mod util;

use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/* ------------------------------------------------------------------ */
/*  App state                                                          */
/* ------------------------------------------------------------------ */

pub struct AppState {
    user_data_dir: PathBuf,
    resource_root: PathBuf,
    install_cancelled: Arc<AtomicBool>,
    mod_install_cancelled: Arc<AtomicBool>,
    /// Set while a pack install or a drag-and-drop install is running. Both
    /// operations share one cancel flag each, so a second concurrent run
    /// would reset the first run's flag and interleave its progress events;
    /// refuse to start instead.
    operation_busy: Arc<AtomicBool>,
    cached_specs: std::sync::Mutex<Option<Value>>,
}

/// RAII guard for `operation_busy` — releases the flag on every exit path.
struct OperationGuard(Arc<AtomicBool>);
impl OperationGuard {
    fn acquire(flag: &Arc<AtomicBool>) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Self(flag.clone()))
    }
}
impl Drop for OperationGuard {
    fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); }
}

impl AppState {
    fn settings_path(&self) -> PathBuf { self.user_data_dir.join("settings.json") }
    fn manifest_path(&self) -> PathBuf { self.user_data_dir.join("manifest.json") }
    fn backups_dir(&self) -> PathBuf { self.user_data_dir.join("backups") }
    fn trash_path(&self) -> PathBuf { self.user_data_dir.join("trash.json") }
    fn trash_dir(&self) -> PathBuf { self.user_data_dir.join("trash") }
    fn mods_dir(&self) -> PathBuf { self.resource_root.join("mods") }
}

fn ensure_user_data_files(state: &AppState, version: &str) {
    let _ = std::fs::create_dir_all(&state.user_data_dir);
    let _ = std::fs::create_dir_all(state.backups_dir());
    let _ = std::fs::create_dir_all(state.trash_dir());
    if !state.settings_path().exists() {
        let _ = util::write_json_atomic(&state.settings_path(), &json!({ "language": "fa", "theme": "night", "gamePath": null }));
    }
    if !state.manifest_path().exists() {
        let _ = util::write_json_atomic(&state.manifest_path(), &json!({
            "appVersion": version, "gamePath": null, "systemTier": null, "lastInstallDate": null, "mods": {}
        }));
    }
}

fn empty_obj() -> Value { Value::Object(Default::default()) }

/* ------------------------------------------------------------------ */
/*  Window controls                                                    */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn window_minimize(window: Window) { let _ = window.minimize(); }

#[tauri::command]
fn window_toggle_maximize(window: Window) {
    if window.is_maximized().unwrap_or(false) { let _ = window.unmaximize(); } else { let _ = window.maximize(); }
}

#[tauri::command]
fn window_close(window: Window) { let _ = window.close(); }

#[tauri::command]
fn window_start_drag(window: Window) { let _ = window.start_dragging(); }

/* ------------------------------------------------------------------ */
/*  Settings / manifest                                                */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn settings_get(state: State<AppState>) -> Value { util::read_json_or(&state.settings_path(), empty_obj()) }

#[tauri::command]
fn settings_set(state: State<AppState>, partial: Option<Value>) -> Value {
    let mut current = util::read_json_or(&state.settings_path(), empty_obj());
    if let (Some(cur), Some(Value::Object(p))) = (current.as_object_mut(), partial) {
        for (k, v) in p { cur.insert(k, v); }
    }
    let _ = util::write_json_atomic(&state.settings_path(), &current);
    current
}

#[tauri::command]
fn manifest_get(state: State<AppState>) -> Value { util::read_json_or(&state.manifest_path(), empty_obj()) }

#[tauri::command]
fn manifest_save(state: State<AppState>, data: Value) -> bool { util::write_json_atomic(&state.manifest_path(), &data).is_ok() }

/* ------------------------------------------------------------------ */
/*  Game path                                                          */
/* ------------------------------------------------------------------ */

fn has_ac_exe(dir: &Path) -> bool { dir.join("acs.exe").exists() || dir.join("assettocorsa.exe").exists() }

#[tauri::command]
async fn game_browse_path(app: AppHandle) -> Option<String> {
    let mut dlg = app.dialog().file().set_title("پوشه‌ی نصب Assetto Corsa را انتخاب کنید");
    if let Some(w) = app.get_webview_window("main") { dlg = dlg.set_parent(&w); }
    tauri::async_runtime::spawn_blocking(move || dlg.blocking_pick_folder()).await.ok().flatten()
        .and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn game_validate_path(game_path: Option<String>) -> Value {
    let Some(gp) = game_path.filter(|g| !g.is_empty()) else { return json!({ "valid": false, "reason": "EMPTY" }) };
    let p = Path::new(&gp);
    if !has_ac_exe(p) { return json!({ "valid": false, "reason": "NO_ACS_EXE" }); }
    if !p.join("content").exists() { return json!({ "valid": false, "reason": "NO_CONTENT_DIR" }); }
    json!({ "valid": true })
}

fn parse_steam_library_folders(vdf: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(vdf) else { return vec![] };
    let re = regex::Regex::new(r#""path"\s+"([^"]+)""#).unwrap();
    re.captures_iter(&text)
        .map(|c| PathBuf::from(c[1].replace("\\\\", "\\")).join("steamapps").join("common").join("assettocorsa"))
        .collect()
}

#[tauri::command]
async fn game_auto_detect() -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".into());
    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
    let steam_default = [
        Path::new(&pf86).join("Steam").join("steamapps").join("common").join("assettocorsa"),
        Path::new(&pf).join("Steam").join("steamapps").join("common").join("assettocorsa"),
        PathBuf::from("C:\\Steam\\steamapps\\common\\assettocorsa"),
    ];
    candidates.extend(steam_default.iter().cloned());
    for d in "DEFGHIJKLMNOPQRSTUVWXYZ".chars() {
        candidates.push(PathBuf::from(format!("{d}:\\SteamLibrary\\steamapps\\common\\assettocorsa")));
        candidates.push(PathBuf::from(format!("{d}:\\Steam\\steamapps\\common\\assettocorsa")));
        candidates.push(PathBuf::from(format!("{d}:\\Games\\Steam\\steamapps\\common\\assettocorsa")));
    }
    for base in &steam_default {
        if let Some(steamapps) = base.parent().and_then(|p| p.parent()) {
            candidates.extend(parse_steam_library_folders(&steamapps.join("libraryfolders.vdf")));
        }
    }
    for d in "CDEFGHIJKLMNOPQRSTUVWXYZ".chars() {
        for steel in ["Steam", "SteamLibrary", "Games\\Steam"] {
            candidates.extend(parse_steam_library_folders(&PathBuf::from(format!("{d}:\\{steel}\\steamapps\\libraryfolders.vdf"))));
        }
    }
    candidates.into_iter().find(|c| c.exists() && has_ac_exe(c)).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn game_check_base_mods(game_path: Option<String>) -> Value {
    let mut result = json!({
        "csp": { "found": false, "markers": [] },
        "pure": { "found": false, "markers": [] },
        "video": { "found": false, "markers": [] },
        "cspsettings": { "found": false, "markers": [] }
    });
    let Some(gp) = game_path.filter(|g| !g.is_empty()) else { return result };
    let g = Path::new(&gp);
    let csp = [g.join("extension/config/data_manifest.ini"), g.join("extension/config/data_manifest"), g.join("extension/dwrite.ini")];
    let pure = [g.join("extension/config-ext/Pure"), g.join("extension/config-ext/pure"), g.join("extension/pure"), g.join("extension/config/pure.ini")];
    for (key, markers) in [("csp", &csp[..]), ("pure", &pure[..])] {
        let found: Vec<String> = markers.iter().filter(|p| p.exists()).map(|p| p.to_string_lossy().to_string()).collect();
        result[key] = json!({ "found": !found.is_empty(), "markers": found });
    }
    // Video settings: the game ships system/cfg/video.ini by default, so a
    // marker here only means "a settings file exists to preserve", which is
    // exactly what the step-2 prompt asks about.
    let video = g.join("system/cfg/video.ini");
    result["video"] = if video.exists() {
        json!({ "found": true, "markers": [video.to_string_lossy().to_string()] })
    } else {
        json!({ "found": false, "markers": [] })
    };
    // CSP / Pure settings: any *.ini under extension/config(-ext) other than
    // the structural data_manifest.ini counts as user-tunable settings.
    let mut csp_setting_markers: Vec<String> = Vec::new();
    for sub in ["extension/config", "extension/config-ext"] {
        collect_ini_markers(&g.join(sub), &mut csp_setting_markers);
    }
    csp_setting_markers.sort();
    csp_setting_markers.truncate(12);
    result["cspsettings"] = json!({ "found": !csp_setting_markers.is_empty(), "markers": csp_setting_markers });
    // User-profile settings (Documents\Assetto Corsa\cfg) — the files the
    // game actually reads. Detected only; writing happens in profile_apply.
    result["profilevideo"] = json!({ "found": false, "markers": [] });
    result["profilecsp"] = json!({ "found": false, "markers": [] });
    if let Some(cfg) = profile::profile_cfg_dir() {
        let v = cfg.join("video.ini");
        if v.exists() {
            result["profilevideo"] = json!({ "found": true, "markers": [v.to_string_lossy().to_string()] });
        }
        let mut profile_markers: Vec<String> = Vec::new();
        collect_ini_markers(&cfg.join("extension"), &mut profile_markers);
        profile_markers.sort();
        profile_markers.truncate(12);
        result["profilecsp"] = json!({ "found": !profile_markers.is_empty(), "markers": profile_markers });
    }
    result
}

/// Collect `*.ini` files under `dir` (one level of sub-directories is enough
/// for CSP's layout), skipping the structural `data_manifest.ini`.
fn collect_ini_markers(dir: &Path, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let p = entry.path();
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Ok(sub) = std::fs::read_dir(&p) {
                for e2 in sub.flatten() {
                    let p2 = e2.path();
                    if is_settings_ini(&p2) { out.push(p2.to_string_lossy().to_string()); }
                }
            }
        } else if is_settings_ini(&p) {
            out.push(p.to_string_lossy().to_string());
        }
    }
}

fn is_settings_ini(p: &Path) -> bool {
    p.extension().map(|e| e.eq_ignore_ascii_case("ini")).unwrap_or(false)
        && p.file_name().map(|n| !n.eq_ignore_ascii_case("data_manifest.ini")).unwrap_or(false)
}

/* ------------------------------------------------------------------ */
/*  Tier-pack install / uninstall                                      */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallPayload {
    #[serde(default)] game_path: String,
    #[serde(default)] tier: Option<String>,
    #[serde(default)] mods: Vec<installer::ModSpec>,
}

#[tauri::command]
async fn install_run(app: AppHandle, state: State<'_, AppState>, payload: Option<InstallPayload>) -> Result<installer::InstallOutcome, String> {
    let payload = payload.unwrap_or(InstallPayload { game_path: String::new(), tier: None, mods: vec![] });
    let _guard = OperationGuard::acquire(&state.operation_busy)
        .ok_or_else(|| "BUSY".to_string())?;
    let flag = state.install_cancelled.clone();
    flag.store(false, Ordering::SeqCst);
    let mods_dir = state.mods_dir();
    let backups = state.backups_dir();
    let out = tauri::async_runtime::spawn_blocking(move || {
        let is_cancelled = || flag.load(Ordering::SeqCst);
        let on_progress = |p: installer::InstallProgress| { let _ = app.emit("install:progress", &p); };
        installer::install_mods(installer::InstallOptions {
            game_path: &payload.game_path, mods: &payload.mods, mods_dir: &mods_dir, backups_dir: &backups,
            tier: payload.tier.as_deref(), on_progress: &on_progress, is_cancelled: &is_cancelled,
        })
    }).await.map_err(|e| e.to_string())?;
    state.install_cancelled.store(false, Ordering::SeqCst);
    Ok(out)
}

#[tauri::command]
fn install_cancel(state: State<AppState>) -> bool { state.install_cancelled.store(true, Ordering::SeqCst); true }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfilePayload {
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    apply_video: bool,
    #[serde(default)]
    apply_csp: bool,
}

/// Apply the pack's profile-layer settings (Documents\Assetto Corsa\cfg):
/// merged video.ini + CSP/Pure setting overrides, with first-wins backups.
/// Recorded by the caller in the manifest so uninstall can revert them.
#[tauri::command]
async fn profile_apply(state: State<'_, AppState>, payload: Option<ProfilePayload>) -> Result<profile::ProfileOutcome, String> {
    let payload = payload.unwrap_or(ProfilePayload { tier: None, apply_video: false, apply_csp: false });
    let _guard = OperationGuard::acquire(&state.operation_busy)
        .ok_or_else(|| "BUSY".to_string())?;
    let mods_dir = state.mods_dir();
    let backups = state.backups_dir();
    let tier = payload.tier.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        profile::apply_profile(&mods_dir, &backups, &tier, payload.apply_video, payload.apply_csp)
    }).await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct UninstallPayload { #[serde(default)] files: Vec<installer::UninstallFile> }

#[tauri::command]
fn uninstall_run(payload: Option<UninstallPayload>) -> Vec<installer::UninstallResult> {
    installer::uninstall_files(&payload.map(|p| p.files).unwrap_or_default())
}

/// Which graphics tiers actually have files bundled (drives the UI badges).
#[tauri::command]
fn graphics_info(state: State<AppState>) -> Value {
    let mods_dir = state.mods_dir();
    let root = mods_dir.join(installer::GRAPHICS_DIR);
    let tiers: serde_json::Map<String, Value> = installer::TIER_IDS.iter().map(|t| {
        let dir = root.join(t);
        let (files, bytes) = catalog::count_files(&dir);
        (t.to_string(), json!({ "available": files > 0, "fileCount": files, "sizeBytes": bytes }))
    }).collect();
    let (cf, cb) = catalog::count_files(&root.join("common"));
    json!({ "tiers": tiers, "common": { "available": cf > 0, "fileCount": cf, "sizeBytes": cb } })
}

/// All bundled add-ons under `mods/addons/*` with metadata + preview thumbnail.
#[tauri::command]
async fn addons_list(state: State<'_, AppState>) -> Result<Vec<catalog::AddonInfo>, String> {
    let mods_dir = state.mods_dir();
    Ok(tauri::async_runtime::spawn_blocking(move || catalog::list_addons(&mods_dir)).await.map_err(|e| e.to_string())?)
}

/* ------------------------------------------------------------------ */
/*  Drag-and-drop mod install                                          */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzePayload { #[serde(default)] source_path: String, #[serde(default)] game_path: Option<String>, #[serde(default)] password: Option<String> }

#[tauri::command]
async fn mods_analyze(payload: AnalyzePayload) -> Result<mod_installer::Analysis, String> {
    if payload.source_path.is_empty() {
        return Ok(mod_installer::analyze_source("", None, None));
    }
    tauri::async_runtime::spawn_blocking(move || {
        mod_installer::analyze_source(&payload.source_path, payload.game_path.as_deref(), payload.password.as_deref())
    }).await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModInstallPayload {
    #[serde(default)] source_path: String,
    #[serde(default)] items: Vec<mod_installer::RawItem>,
    #[serde(default)] game_path: String,
    #[serde(default)] password: String,
}

#[tauri::command]
async fn mods_install(app: AppHandle, state: State<'_, AppState>, payload: ModInstallPayload) -> Result<mod_installer::ExecOutcome, String> {
    let flag = state.mod_install_cancelled.clone();
    flag.store(false, Ordering::SeqCst);
    let backups = state.backups_dir();
    let manifest_path = state.manifest_path();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let safe_items = mod_installer::sanitize_install_items(&payload.items);
        let on_progress = |p: mod_installer::ExecProgress| { let _ = app.emit("mods:install-progress", &p); };
        let is_cancelled = || flag.load(Ordering::SeqCst);
        let out = mod_installer::execute_install(&payload.source_path, &safe_items, &payload.game_path, &backups,
            if payload.password.is_empty() { None } else { Some(payload.password.as_str()) }, &on_progress, &is_cancelled);

        // Record every installed item in the manifest (partial installs stay auditable).
        let mut manifest = util::read_json_or(&manifest_path, empty_obj());
        if manifest.get("installs").map(|v| !v.is_array()).unwrap_or(true) { manifest["installs"] = json!([]); }
        let mut installs = manifest["installs"].as_array().cloned().unwrap_or_default();
        for r in out.items.iter().filter(|r| r.status == "installed") {
            installs.insert(0, json!({
                "id": format!("content:{}:{}", r.kind, r.name), "type": r.kind, "name": r.name,
                "installedAt": util::now_iso(),
                "files": r.installed_files.iter().map(|f| json!({ "rel": f.rel, "dest": f.dest, "backupPath": f.backup_path })).collect::<Vec<_>>(),
            }));
        }
        installs.truncate(200);
        manifest["installs"] = Value::Array(installs);
        let _ = util::write_json_atomic(&manifest_path, &manifest);
        out
    }).await.map_err(|e| e.to_string())?;
    state.mod_install_cancelled.store(false, Ordering::SeqCst);
    Ok(result)
}

#[tauri::command]
fn mods_cancel(state: State<AppState>) -> bool { state.mod_install_cancelled.store(true, Ordering::SeqCst); true }

#[tauri::command]
async fn mods_pick_file(app: AppHandle) -> Option<Vec<String>> {
    let mut dlg = app.dialog().file()
        .set_title("انتخاب فایل مود (ZIP / RAR)")
        .add_filter("Mod archives", &["zip", "rar", "7z", "cbr"])
        .add_filter("All files", &["*"]);
    if let Some(w) = app.get_webview_window("main") { dlg = dlg.set_parent(&w); }
    let files = tauri::async_runtime::spawn_blocking(move || dlg.blocking_pick_files()).await.ok().flatten()?;
    let out: Vec<String> = files.into_iter().filter_map(|f| f.into_path().ok()).map(|p| p.to_string_lossy().to_string()).collect();
    if out.is_empty() { None } else { Some(out) }
}

/* ------------------------------------------------------------------ */
/*  Content library                                                    */
/* ------------------------------------------------------------------ */

#[tauri::command]
async fn library_scan(app: AppHandle, game_path: Option<String>) -> Result<library::LibraryResult, String> {
    let gp = game_path.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        library::scan_library(&gp, &|p| { let _ = app.emit("library:scan-progress", &p); })
    }).await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewPayload { #[serde(default)] game_path: Option<String>, #[serde(default)] rel_path: Option<String> }

#[tauri::command]
async fn library_get_preview(payload: PreviewPayload) -> Option<String> {
    let gp = payload.game_path.filter(|g| !g.is_empty())?;
    let rel = payload.rel_path.filter(|r| !r.is_empty())?;
    let full = library::resolve_safe_path(Path::new(&gp), &rel, false)?;
    tauri::async_runtime::spawn_blocking(move || preview::file_to_data_url(&full)).await.ok().flatten()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentRef { #[serde(default)] game_path: Option<String>, #[serde(rename = "type", default)] kind: Option<String>, #[serde(default)] folder: Option<String> }

#[tauri::command]
fn library_reveal(app: AppHandle, payload: ContentRef) -> Value {
    let (Some(gp), Some(folder)) = (payload.game_path.filter(|g| !g.is_empty()), payload.folder.filter(|f| !f.is_empty())) else { return json!({ "success": false }) };
    if folder.contains("..") || Path::new(&folder).is_absolute() { return json!({ "success": false }); }
    let sub = if payload.kind.as_deref() == Some("track") { "tracks" } else { "cars" };
    let full = Path::new(&gp).join("content").join(sub).join(&folder);
    if !full.exists() { return json!({ "success": false }); }
    let ok = app.opener().reveal_item_in_dir(&full).is_ok() || app.opener().open_path(full.to_string_lossy().to_string(), None::<&str>).is_ok();
    json!({ "success": ok })
}

#[tauri::command]
async fn library_delete(state: State<'_, AppState>, payload: ContentRef) -> Result<library::OpResult, String> {
    let kind = if payload.kind.as_deref() == Some("track") { "track" } else { "car" }.to_string();
    let (tp, td) = (state.trash_path(), state.trash_dir());
    tauri::async_runtime::spawn_blocking(move || {
        library::move_to_trash(&payload.game_path.unwrap_or_default(), &kind, &payload.folder.unwrap_or_default(), &tp, &td)
    }).await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashRef { #[serde(default)] trash_id: String }

#[tauri::command]
async fn library_restore(state: State<'_, AppState>, payload: TrashRef) -> Result<library::OpResult, String> {
    let tp = state.trash_path();
    tauri::async_runtime::spawn_blocking(move || library::restore_trash_item(&tp, &payload.trash_id)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn library_purge(state: State<'_, AppState>, payload: TrashRef) -> Result<library::OpResult, String> {
    let tp = state.trash_path();
    tauri::async_runtime::spawn_blocking(move || library::permanently_delete_trash_item(&tp, &payload.trash_id)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn library_empty_trash(state: State<'_, AppState>) -> Result<library::OpResult, String> {
    let tp = state.trash_path();
    tauri::async_runtime::spawn_blocking(move || library::empty_trash(&tp)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn library_trash(state: State<AppState>) -> Vec<Value> { library::list_trash(&state.trash_path()) }

#[tauri::command]
fn library_preview_candidates(kind: Option<String>) -> Vec<&'static str> {
    if kind.as_deref() == Some("track") { library::TRACK_PREVIEW_CANDIDATES.to_vec() } else { library::CAR_PREVIEW_CANDIDATES.to_vec() }
}

/* ------------------------------------------------------------------ */
/*  Hardware                                                           */
/* ------------------------------------------------------------------ */

#[derive(Deserialize, Default)]
struct DetectOptions { #[serde(default)] force: bool }

#[tauri::command]
async fn system_detect_specs(state: State<'_, AppState>, options: Option<DetectOptions>) -> Result<Value, String> {
    let force = options.map(|o| o.force).unwrap_or(false);
    if !force {
        if let Some(c) = state.cached_specs.lock().map_err(|e| e.to_string())?.clone() { return Ok(c); }
    }
    let specs = tauri::async_runtime::spawn_blocking(hardware::detect_system_specs).await.map_err(|e| e.to_string())?;
    *state.cached_specs.lock().map_err(|e| e.to_string())? = Some(specs.clone());
    Ok(specs)
}

#[tauri::command]
fn system_suggest_tier(specs: Option<hardware::SpecsInput>) -> hardware::Suggestion {
    hardware::suggest_tier_from_specs(&specs.unwrap_or_default())
}

/* ------------------------------------------------------------------ */
/*  Shell / clipboard                                                  */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn shell_open_external(app: AppHandle, url: String) {
    if url.starts_with("https://") || url.starts_with("http://") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

#[tauri::command]
fn clipboard_write(app: AppHandle, text: Option<String>) -> bool {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text.unwrap_or_default()).is_ok()
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let user_data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("uhm-pack-installer"));
            // In a packaged build `mods/` lives next to the executable
            // (bundled as a resource); in dev it is the repository folder.
            let resource_root = app.path().resource_dir().ok()
                .filter(|r| r.join("mods").exists())
                .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("..").to_path_buf());
            let state = AppState {
                user_data_dir,
                resource_root,
                install_cancelled: Arc::new(AtomicBool::new(false)),
                mod_install_cancelled: Arc::new(AtomicBool::new(false)),
                operation_busy: Arc::new(AtomicBool::new(false)),
                cached_specs: std::sync::Mutex::new(None),
            };
            ensure_user_data_files(&state, app.package_info().version.to_string().as_str());
            app.manage(state);
            // Like Electron's `ready-to-show`: the frontend reveals the window
            // once it has rendered (tauri-bridge.js). This is only a safety net
            // so the app never stays invisible if that script fails.
            if let Some(w) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(2500));
                    if !w.is_visible().unwrap_or(true) { let _ = w.show(); }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_minimize, window_toggle_maximize, window_close, window_start_drag,
            settings_get, settings_set, manifest_get, manifest_save,
            game_browse_path, game_validate_path, game_auto_detect, game_check_base_mods,
            install_run, install_cancel, profile_apply, uninstall_run, graphics_info, addons_list,
            mods_analyze, mods_install, mods_cancel, mods_pick_file,
            library_scan, library_get_preview, library_reveal, library_delete, library_restore,
            library_purge, library_empty_trash, library_trash, library_preview_candidates,
            system_detect_specs, system_suggest_tier,
            shell_open_external, clipboard_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running UHM Pack Installer");
}
