#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod content;
mod content_rules;
mod discovery;
mod installer;
mod jobs;
mod lifecycle;
mod quarantine;
mod security;
mod updater;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
#[derive(Default)]
struct IdentityLock(Mutex<()>);
#[derive(Default, Serialize, Deserialize)]
struct Settings {
    game_path: String,
    #[serde(default)]
    game_paths: Vec<String>,
    #[serde(default)]
    autoscan: bool,
    #[serde(default)]
    download_path: String,
    #[serde(default = "default_parallel")]
    parallel_downloads: usize,
}
fn default_parallel() -> usize {
    2
}
fn download_cache(_app: &tauri::AppHandle, s: &Settings) -> Result<PathBuf, String> {
    if s.download_path.is_empty() {
        return security::safe_target(
            &installer::control_dir(&valid_game(&s.game_path)?)?,
            "download-cache",
        );
    }
    let parent = Path::new(&s.download_path)
        .canonicalize()
        .map_err(|_| "Download directory does not exist")?;
    if !parent.is_dir() {
        return Err("Download directory is not a directory".into());
    }
    security::safe_target(&parent, "uhm-download-cache")
}
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let file = data_dir(app)?.join("settings.json");
    if !file.exists() {
        return Ok(Settings {
            parallel_downloads: default_parallel(),
            ..Settings::default()
        });
    }
    serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|_| "Settings are damaged".into())
}
fn valid_game(path: &str) -> Result<PathBuf, String> {
    let root = Path::new(path)
        .canonicalize()
        .map_err(|_| "Game directory does not exist")?;
    if !root.is_dir()
        || !security::safe_target(&root, "acs.exe")?.is_file()
        || !security::safe_target(&root, "content")?.is_dir()
    {
        return Err("Select the Assetto Corsa folder containing acs.exe and content".into());
    }
    Ok(root)
}
#[tauri::command]
fn device_identity(app: tauri::AppHandle, lock: State<IdentityLock>) -> Result<Value, String> {
    let _guard = lock.0.lock().map_err(|_| "Device key lock failed")?;
    security::identity(&data_dir(&app)?)
}
#[tauri::command]
fn sign_challenge(
    app: tauri::AppHandle,
    lock: State<IdentityLock>,
    nonce: String,
) -> Result<String, String> {
    let _guard = lock.0.lock().map_err(|_| "Device key lock failed")?;
    security::sign_nonce(&data_dir(&app)?, &nonce)
}
#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    settings(&app)
}
fn select_game_path(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    if jobs::active() {
        return Err("Wait for the active content operation before changing paths".into());
    }
    let root = valid_game(&path)?;
    installer::recover(&root)?;
    let canonical = root.to_string_lossy().into_owned();
    let mut current = settings(&app)?;
    current.game_path = canonical.clone();
    if !current.game_paths.contains(&canonical) {
        current.game_paths.push(canonical.clone());
    }
    security::atomic_write(
        &data_dir(&app)?.join("settings.json"),
        &serde_json::to_vec(&current).map_err(|e| e.to_string())?,
    )?;
    Ok(json!({"path":canonical}))
}
#[tauri::command]
async fn set_game_path(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || select_game_path(app, path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn installed_packages(app: tauri::AppHandle) -> Result<Value, String> {
    let s = settings(&app)?;
    if s.game_path.is_empty() {
        return Ok(json!({}));
    }
    serde_json::to_value(installer::library(&valid_game(&s.game_path)?)?).map_err(|e| e.to_string())
}
#[tauri::command]
async fn discover_paths(app: tauri::AppHandle) -> Result<Value, String> {
    let mut s = settings(&app)?;
    if !s.game_path.is_empty() && !s.game_paths.contains(&s.game_path) {
        s.game_paths.push(s.game_path.clone());
    }
    tauri::async_runtime::spawn_blocking(move || discovery::discover(&s.game_paths))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn set_autoscan(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut s = settings(&app)?;
    s.autoscan = enabled;
    security::atomic_write(
        &data_dir(&app)?.join("settings.json"),
        &serde_json::to_vec(&s).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
async fn scan_content(app: tauri::AppHandle, force: bool) -> Result<content::Snapshot, String> {
    let root = valid_game(&settings(&app)?.game_path)?;
    let cache = data_dir(&app)?.join("library-cache");
    tauri::async_runtime::spawn_blocking(move || content::scan(&root, &cache, force))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn content_image(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || content::image(&root, &path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn deletion_preview(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    let root = valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || quarantine::preview(&root, &path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn quarantine_files(
    app: tauri::AppHandle,
    id: String,
    selected: Vec<String>,
    acknowledge_external: bool,
) -> Result<Value, String> {
    let root = valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        quarantine::apply(&root, &id, &selected, acknowledge_external)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn list_quarantine(app: tauri::AppHandle) -> Result<Value, String> {
    let root = valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || quarantine::list(&root))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn restore_quarantine(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    let root = valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || quarantine::restore(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn control_job(
    package_id: String,
    action: String,
    preview_id: Option<String>,
) -> Result<Value, String> {
    jobs::control(&package_id, &action, preview_id.as_deref())
}
#[tauri::command]
fn set_download_preferences(
    app: tauri::AppHandle,
    path: String,
    parallel: usize,
) -> Result<(), String> {
    if jobs::active() {
        return Err("Wait for the active content operation before changing paths".into());
    }
    if !(1..=4).contains(&parallel) {
        return Err("Choose between one and four transfers".into());
    }
    let mut s = settings(&app)?;
    if !path.is_empty() {
        let p = Path::new(&path)
            .canonicalize()
            .map_err(|_| "Download directory does not exist")?;
        if !p.is_dir() {
            return Err("Select a directory".into());
        }
        s.download_path = p.to_string_lossy().into_owned();
    } else {
        s.download_path = String::new();
    }
    s.parallel_downloads = parallel;
    let cache = download_cache(&app, &s)?;
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    security::atomic_write(
        &data_dir(&app)?.join("settings.json"),
        &serde_json::to_vec(&s).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
async fn download_cache_status(app: tauri::AppHandle, clear: bool) -> Result<Value, String> {
    let s = settings(&app)?;
    let root = valid_game(&s.game_path)?;
    let cache = download_cache(&app, &s)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let _lock = installer::content_lock(&root)?;
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(security::safe_target(&cache, "cache.lock")?)
            .map_err(|e| e.to_string())?;
        fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| "Download cache is in use")?;
        let mut bytes = 0u64;
        let mut files = 0usize;
        for e in fs::read_dir(&cache).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            let name = e.file_name().to_string_lossy().into_owned();
            let Some(hash) = name.strip_suffix(".part") else {
                continue;
            };
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                continue;
            }
            let p = security::safe_target(&cache, &name)?;
            let m = fs::metadata(&p).map_err(|e| e.to_string())?;
            if m.is_file() {
                bytes = bytes.saturating_add(m.len());
                files += 1;
                if clear {
                    fs::remove_file(p).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(json!({"bytes":bytes,"files":files,"cleared":clear,"path":cache}))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn verified_grant(app: &tauri::AppHandle, grant: &str) -> Result<Value, String> {
    let payload = security::verify(grant, "uhm-offline+jwt")?;
    if payload["device_thumbprint"].as_str() != Some(&security::device_thumb(&data_dir(app)?)?) {
        return Err("This offline grant belongs to another device".into());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "System clock is invalid")?
        .as_secs();
    if payload["offline_until"].as_u64().unwrap_or(0) / 1000 < now {
        return Err("Offline permission expired; renew online".into());
    }
    let clock = data_dir(app)?.join("last-clock.json");
    if clock.exists() {
        let previous: u64 = serde_json::from_slice(&fs::read(&clock).map_err(|e| e.to_string())?)
            .map_err(|_| "Clock state is damaged")?;
        if previous > now + 300 {
            return Err("System clock moved backwards; reconnect and correct the clock".into());
        }
    }
    security::atomic_write(
        &clock,
        &serde_json::to_vec(&now).map_err(|e| e.to_string())?,
    )?;
    Ok(payload)
}
#[tauri::command]
fn verify_offline_grant(app: tauri::AppHandle, grant: String) -> Result<Value, String> {
    verified_grant(&app, &grant)
}
#[tauri::command]
async fn recover_installations(app: tauri::AppHandle) -> Result<usize, String> {
    let root = valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || installer::recover(&root))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn install_plan(
    app: tauri::AppHandle,
    token: String,
    grant: String,
) -> Result<Value, String> {
    let g = verified_grant(&app, &grant)?;
    let plan = security::verify(&token, "uhm-plan+jwt")?;
    if plan["license_id"] != g["license_id"] || plan["device_thumbprint"] != g["device_thumbprint"]
    {
        return Err("Installation authorization does not match this device/license".into());
    }
    let packages: Vec<installer::Package> =
        serde_json::from_value(plan["packages"].clone()).map_err(|_| "Invalid install plan")?;
    if packages.is_empty() || packages.len() > 30 {
        return Err("Invalid number of packages".into());
    }
    let s = settings(&app)?;
    let root = valid_game(&s.game_path)?;
    let cache = download_cache(&app, &s)?;
    let scan_cache = data_dir(&app)?.join("library-cache");
    tauri::async_runtime::spawn_blocking(move || {
        let result = installer::install(&app, &root, packages, &cache, s.parallel_downloads);
        content::invalidate(&root, &scan_cache);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn updater_status() -> Result<updater::Status, String> {
    updater::status()
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(IdentityLock::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            updater::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if updater::closing(window.app_handle().clone()) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            updater_status,
            device_identity,
            sign_challenge,
            get_settings,
            set_game_path,
            installed_packages,
            control_job,
            set_download_preferences,
            download_cache_status,
            discover_paths,
            set_autoscan,
            scan_content,
            content_image,
            deletion_preview,
            quarantine_files,
            list_quarantine,
            restore_quarantine,
            verify_offline_grant,
            recover_installations,
            install_plan
        ])
        .run(tauri::generate_context!())
        .expect("UHM desktop runtime failed");
}
