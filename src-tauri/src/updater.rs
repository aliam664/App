//! Signed, version-bound application updates; never uses a license signing key.
use crate::security::{atomic_write, safe_target};
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{Emitter, Wry};
use tauri_plugin_updater::{Update, UpdaterExt};
const MAX_BYTES: u64 = 128 * 1024 * 1024;
const FEED: &str = "https://github.com/aliam664/App/releases/latest/download/latest.json";
#[derive(Clone, Serialize)]
pub struct Status {
    phase: String,
    current_version: String,
    available_version: Option<String>,
    downloaded: u64,
    total: Option<u64>,
    error: Option<String>,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            current_version: env!("CARGO_PKG_VERSION").into(),
            available_version: None,
            downloaded: 0,
            total: None,
            error: None,
        }
    }
}
struct Ready {
    update: Update,
    bytes: Vec<u8>,
}
static STATUS: OnceLock<Mutex<Status>> = OnceLock::new();
static READY: OnceLock<Mutex<Option<Ready>>> = OnceLock::new();
fn state() -> &'static Mutex<Status> {
    STATUS.get_or_init(Default::default)
}
fn ready() -> &'static Mutex<Option<Ready>> {
    READY.get_or_init(Default::default)
}
pub fn status() -> Result<Status, String> {
    state()
        .lock()
        .map(|s| s.clone())
        .map_err(|_| "Update state unavailable".into())
}
fn phase(value: &str) {
    if let Ok(mut s) = state().lock() {
        s.phase = value.into();
        s.error = None;
    }
}
fn error(value: String) {
    if let Ok(mut s) = state().lock() {
        if s.phase != "ready" {
            s.phase = "error".into();
        }
        // Avoid echoing signed URLs, filesystem paths or headers into the webview.
        s.error = Some(value);
    }
}
fn directory(app: &tauri::AppHandle<Wry>) -> Result<PathBuf, String> {
    let data = crate::data_dir(app)?;
    let dir = safe_target(&data, "updater")?;
    fs::create_dir_all(&dir).map_err(|_| "Cannot create update cache")?;
    Ok(dir)
}
fn validate_download(version: &str, url: &url::Url) -> Result<(), String> {
    let expected=format!("https://github.com/aliam664/App/releases/download/uhm-launcher-v{version}/UHM-Launcher-{version}-x64-setup.exe");
    if url.as_str() != expected || !url.username().is_empty() || url.password().is_some() {
        return Err("Update download is not an approved release artifact".into());
    }
    Ok(())
}
fn cached(dir: &Path) -> Result<Vec<u8>, String> {
    let file = safe_target(dir, "installer.exe")?;
    let mut reader = fs::File::open(file).map_err(|_| "Cached update unavailable")?;
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read cached update")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Update exceeds cache limit".into());
    }
    Ok(bytes)
}
fn stage(dir: &Path, update: Update, bytes: Vec<u8>) -> Result<(), String> {
    validate_download(&update.version, &update.download_url)?;
    update
        .verify(&bytes)
        .map_err(|_| "Update signature or signed version is invalid")?;
    atomic_write(&safe_target(dir, "installer.exe")?, &bytes)?;
    atomic_write(
        &safe_target(dir, "release.json")?,
        &serde_json::to_vec(&update.raw_json).map_err(|_| "Invalid update metadata")?,
    )?;
    if let Ok(mut s) = state().lock() {
        s.phase = "ready".into();
        s.available_version = Some(update.version.clone());
        s.downloaded = bytes.len() as u64;
        s.total = Some(bytes.len() as u64);
        s.error = None;
    }
    *ready().lock().map_err(|_| "Update state unavailable")? = Some(Ready { update, bytes });
    Ok(())
}
fn fetch_update(update: &Update, dir: &Path) -> Result<Vec<u8>, String> {
    validate_download(&update.version, &update.download_url)?;
    if fs2::available_space(dir).map_err(|_| "Cannot check update cache space")? < MAX_BYTES * 2 {
        return Err("Insufficient space for application update".into());
    }
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let u = attempt.url();
            if attempt.previous().len() > 5
                || u.scheme() != "https"
                || !u.username().is_empty()
                || u.password().is_some()
                || !matches!(
                    u.host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.error("Unapproved update redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "Cannot initialize secure updater")?;
    let mut response = client
        .get(update.download_url.clone())
        .send()
        .map_err(|_| "Update download failed; retrying later")?
        .error_for_status()
        .map_err(|_| "Update artifact is unavailable")?;
    let total = response.content_length();
    if total.is_some_and(|n| n > MAX_BYTES) {
        return Err("Update exceeds download limit".into());
    }
    if let Ok(mut s) = state().lock() {
        s.phase = "downloading".into();
        s.available_version = Some(update.version.clone());
        s.downloaded = 0;
        s.total = total;
        s.error = None;
    }
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = response
            .read(&mut buffer)
            .map_err(|_| "Update download interrupted; retrying later")?;
        if n == 0 {
            break;
        }
        if bytes.len() as u64 + n as u64 > MAX_BYTES {
            return Err("Update exceeds download limit".into());
        }
        bytes.extend_from_slice(&buffer[..n]);
        if let Ok(mut s) = state().lock() {
            s.downloaded = bytes.len() as u64;
        }
    }
    if total.is_some_and(|n| n != bytes.len() as u64) {
        return Err("Incomplete update download".into());
    }
    update
        .verify(&bytes)
        .map_err(|_| "Update signature or signed version is invalid")?;
    Ok(bytes)
}
#[cfg(windows)]
fn game_running() -> Result<bool, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE {
            return Err("Cannot verify that the game is closed".into());
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(handle, &mut entry) == 0 {
            CloseHandle(handle);
            return Err("Cannot inspect running applications".into());
        }
        loop {
            let len = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            if is_game_process(&String::from_utf16_lossy(&entry.szExeFile[..len])) {
                CloseHandle(handle);
                return Ok(true);
            }
            if Process32NextW(handle, &mut entry) == 0 {
                let e = GetLastError();
                CloseHandle(handle);
                return if e == ERROR_NO_MORE_FILES {
                    Ok(false)
                } else {
                    Err("Cannot inspect running applications".into())
                };
            }
        }
    }
}
#[cfg(not(windows))]
fn game_running() -> Result<bool, String> {
    Err("Automatic app installation is Windows-only".into())
}
fn is_game_process(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "acs.exe" | "acs_x86.exe" | "assettocorsa.exe"
    )
}
fn install_ready(restart: bool) -> Result<bool, String> {
    let _exclusive = crate::lifecycle::update()?;
    if game_running()? {
        return Err("Close Assetto Corsa before the launcher update can install".into());
    }
    let mut pending = ready().lock().map_err(|_| "Update state unavailable")?;
    let Some(p) = pending.as_ref() else {
        return Ok(false);
    };
    phase("installing");
    // The plugin re-verifies the signed version and bytes immediately before executing NSIS.
    crate::lifecycle::mark_exiting();
    if p.update
        .clone()
        .restart_after_install(restart)
        .install(&p.bytes)
        .is_err()
    {
        crate::lifecycle::resume_after_failed_install();
        return Err("Could not launch the signed application installer".into());
    }
    *pending = None;
    Ok(true)
}
/// Return true when the caller must prevent ordinary window close.
pub fn closing(app: tauri::AppHandle<Wry>) -> bool {
    let Ok(exclusive) = crate::lifecycle::update() else {
        error("Finish or cancel the active content operation before closing".into());
        let _ = app.emit(
            "launcher:close-blocked",
            "ابتدا عملیات نصب، بازیابی یا دانلود فعال را تمام یا لغو کنید.",
        );
        return true;
    };
    if !ready().lock().map(|r| r.is_some()).unwrap_or(false) {
        crate::lifecycle::mark_exiting();
        return false;
    }
    drop(exclusive);
    std::thread::spawn(move || match install_ready(false) {
        Ok(true) => {}
        Err(e) => {
            error(e);
            if let Ok(_exclusive) = crate::lifecycle::update() {
                crate::lifecycle::mark_exiting();
                app.exit(0);
            } else {
                let _ = app.emit(
                    "launcher:close-blocked",
                    "عملیات محتوا هنوز فعال است؛ پس از پایان یا لغو آن برنامه را ببندید.",
                );
            }
        }
        Ok(false) => {
            if let Ok(_exclusive) = crate::lifecycle::update() {
                crate::lifecycle::mark_exiting();
                app.exit(0);
            }
        }
    });
    true
}
fn check(app: &tauri::AppHandle<Wry>, restore: bool) -> Result<(), String> {
    let dir = directory(app)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![FEED.parse().map_err(|_| "Invalid update feed")?])
        .map_err(|_| "Invalid update feed")?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Updater configuration is invalid")?;
    if restore {
        let meta = safe_target(&dir, "release.json")?;
        if meta.exists() {
            let result = (|| {
                let mut raw = Vec::new();
                fs::File::open(&meta)
                    .map_err(|_| "Cannot read cached update metadata")?
                    .take(65537)
                    .read_to_end(&mut raw)
                    .map_err(|_| "Cannot read cached update metadata")?;
                if raw.len() > 65536 {
                    return Err("Cached update metadata exceeds limit".into());
                }
                let value =
                    serde_json::from_slice(&raw).map_err(|_| "Invalid cached update metadata")?;
                if let Some(update) = updater
                    .restore_update(value)
                    .map_err(|_| "Invalid cached update")?
                {
                    stage(&dir, update, cached(&dir)?)?;
                    // Installing here is allowed only on the next app start, not at an arbitrary idle moment.
                    let _ = install_ready(true);
                } else {
                    return Err("Cached version is already installed".into());
                }
                Ok::<(), String>(())
            })();
            if result.is_err() {
                // Remove only the two bounded cache files, never app settings or license data.
                let _ = fs::remove_file(meta);
                let _ = fs::remove_file(safe_target(&dir, "installer.exe")?);
            }
        }
    }
    if ready().lock().map(|r| r.is_none()).unwrap_or(false) {
        phase("checking");
    }
    let available = tauri::async_runtime::block_on(updater.check())
        .map_err(|_| "Update check unavailable; retrying automatically later")?;
    if let Some(update) = available {
        if ready()
            .lock()
            .map(|r| {
                r.as_ref()
                    .is_some_and(|p| p.update.version == update.version)
            })
            .unwrap_or(false)
        {
            return Ok(());
        }
        let bytes = fetch_update(&update, &dir)?;
        stage(&dir, update, bytes)?;
    } else if ready().lock().map(|r| r.is_none()).unwrap_or(false) {
        phase("current");
    }
    Ok(())
}
pub fn start(app: tauri::AppHandle<Wry>) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        let mut restore = true;
        loop {
            if let Err(e) = check(&app, restore) {
                error(e);
            }
            restore = false;
            std::thread::sleep(Duration::from_secs(6 * 60 * 60));
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}
#[cfg(test)]
mod tests {
    use super::*;
    fn verifier() -> (
        tauri::App<tauri::test::MockRuntime>,
        tauri_plugin_updater::Updater,
    ) {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({
                "pubkey":include_str!("../tests/fixtures/updater-public.txt").trim(),
                "requireSignedVersion":true,
            }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target("windows-x86_64")
            .endpoints(vec!["https://example.invalid/never-requested"
                .parse()
                .unwrap()])
            .unwrap()
            .version_comparator(|_, _| true)
            .build()
            .unwrap();
        (app, updater)
    }
    fn fixture_manifest(version: &str) -> serde_json::Value {
        serde_json::json!({"version":version,"platforms":{"windows-x86_64":{
            "url":"https://github.com/aliam664/App/releases/download/uhm-launcher-v0.1.0/UHM-Launcher-0.1.0-x64-setup.exe",
            "signature":include_str!("../tests/fixtures/updater-payload.txt.sig").trim(),
        }}})
    }
    #[test]
    fn actual_plugin_verifies_crypto_and_rejects_modified_payload_or_relabelled_version() {
        let (_app, updater) = verifier();
        let update = updater
            .restore_update(fixture_manifest("0.1.0"))
            .unwrap()
            .unwrap();
        let bytes = include_bytes!("../tests/fixtures/updater-payload.txt");
        update
            .verify(bytes)
            .expect("Actual signed fixture must verify byte-for-byte on Windows");
        let mut changed = bytes.to_vec();
        changed[0] ^= 1;
        assert!(update.verify(&changed).is_err());
        let relabelled = updater
            .restore_update(fixture_manifest("99.0.0"))
            .unwrap()
            .unwrap();
        assert!(relabelled.verify(bytes).is_err());
    }
    #[test]
    fn app_update_artifact_is_confined_to_exact_https_release_version() {
        let version = "1.2.3";
        let good="https://github.com/aliam664/App/releases/download/uhm-launcher-v1.2.3/UHM-Launcher-1.2.3-x64-setup.exe";
        assert!(validate_download(version, &good.parse().unwrap()).is_ok());
        for url in [
            good.replace("https:", "http:"),
            good.replace("aliam664/App", "attacker/App"),
            format!("{good}?x=1"),
            good.replace("1.2.3-x64", "1.2.2-x64"),
        ] {
            assert!(validate_download(version, &url.parse().unwrap()).is_err());
        }
    }
    #[test]
    fn only_assetto_corsa_processes_defer_app_install() {
        assert!(is_game_process("ACS.EXE"));
        assert!(is_game_process("acs_x86.exe"));
        assert!(!is_game_process("steam.exe"));
        assert!(!is_game_process("Content Manager.exe"));
    }
}
