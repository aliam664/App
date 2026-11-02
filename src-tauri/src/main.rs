#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod installer;
mod content;
mod discovery;
mod quarantine;
mod jobs;
mod security;
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
}
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let file = data_dir(app)?.join("settings.json");
    if !file.exists() {
        return Ok(Settings::default());
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
#[tauri::command]
fn set_game_path(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    let root = valid_game(&path)?;
    installer::recover(&root)?;
    let canonical = root.to_string_lossy().into_owned();
    let mut current=settings(&app)?;
    current.game_path=canonical.clone();
    if !current.game_paths.contains(&canonical) {current.game_paths.push(canonical.clone());}
    security::atomic_write(&data_dir(&app)?.join("settings.json"),&serde_json::to_vec(&current).map_err(|e|e.to_string())?)?;
    Ok(json!({"path":canonical}))
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
async fn discover_paths(app: tauri::AppHandle) -> Result<Value,String> {
    let s=settings(&app)?;
    tauri::async_runtime::spawn_blocking(move || discovery::discover(&s.game_paths)).await.map_err(|e|e.to_string())
}
#[tauri::command]
fn set_autoscan(app: tauri::AppHandle, enabled:bool) -> Result<(),String> {
    let mut s=settings(&app)?;s.autoscan=enabled;
    security::atomic_write(&data_dir(&app)?.join("settings.json"),&serde_json::to_vec(&s).map_err(|e|e.to_string())?)
}
#[tauri::command]
async fn scan_content(app: tauri::AppHandle, force:bool) -> Result<content::Snapshot,String> {
    let root=valid_game(&settings(&app)?.game_path)?;let cache=data_dir(&app)?.join("library-cache");
    tauri::async_runtime::spawn_blocking(move || content::scan(&root,&cache,force)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn content_image(app: tauri::AppHandle, path:String) -> Result<String,String> {
    let root=valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || content::image(&root,&path)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn deletion_preview(app: tauri::AppHandle, path:String) -> Result<Value,String> {
    let root=valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || quarantine::preview(&root,&path)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn quarantine_files(app: tauri::AppHandle,id:String,selected:Vec<String>,acknowledge_external:bool) -> Result<Value,String> {
    let root=valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || quarantine::apply(&root,&id,&selected,acknowledge_external)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn list_quarantine(app: tauri::AppHandle) -> Result<Value,String> {
    let root=valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || quarantine::list(&root)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn restore_quarantine(app: tauri::AppHandle,id:String) -> Result<Value,String> {
    let root=valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || quarantine::restore(&root,&id)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn control_job(package_id:String,action:String,preview_id:Option<String>) -> Result<Value,String> {
    jobs::control(&package_id,&action,preview_id.as_deref())
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
    let root = valid_game(&settings(&app)?.game_path)?;
    tauri::async_runtime::spawn_blocking(move || installer::install(&app, &root, packages))
        .await
        .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .manage(IdentityLock::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            device_identity,
            sign_challenge,
            get_settings,
            set_game_path,
            installed_packages,
            control_job,
            discover_paths, set_autoscan, scan_content, content_image, deletion_preview, quarantine_files, list_quarantine, restore_quarantine,
            verify_offline_grant,
            recover_installations,
            install_plan
        ])
        .run(tauri::generate_context!())
        .expect("UHM desktop runtime failed");
}
