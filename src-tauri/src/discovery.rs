//! Read-only discovery. A candidate is never selected until valid_game accepts it.
use serde_json::{json, Value};
use std::{collections::BTreeSet, env, fs, path::PathBuf};
fn strings(text: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '"' { continue; }
        let mut value = String::new();
        while let Some(c) = chars.next() {
            match c { '"' => break, '\\' => { if let Some(c) = chars.next() { value.push(c); } }, _ => value.push(c) }
        }
        values.push(value);
    }
    values
}
fn read(path: &std::path::Path) -> String {
    if fs::metadata(path).map(|m| m.len() <= 2_000_000).unwrap_or(false) {
        fs::read_to_string(path).unwrap_or_default()
    } else { String::new() }
}
#[cfg(windows)]
fn registry(key: &str, name: &str) -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("reg.exe").args(["query",key,"/v",name])
        .creation_flags(0x08000000).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find_map(|l| l.split_once("REG_SZ").map(|(_,v)| PathBuf::from(v.trim())))
}
pub fn discover(saved: &[String]) -> Value {
    let mut steam = BTreeSet::new();
    for key in ["PROGRAMFILES(X86)", "PROGRAMFILES", "ProgramFiles(x86)"] {
        if let Some(p) = env::var_os(key) { steam.insert(PathBuf::from(p).join("Steam")); }
    }
    #[cfg(windows)] {
        for key in ["HKCU\\Software\\Valve\\Steam", "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam"] {
            for name in ["SteamPath", "InstallPath"] { if let Some(p) = registry(key,name) { steam.insert(p); } }
        }
    }
    if let Some(home) = env::var_os("HOME") { steam.insert(PathBuf::from(home).join(".steam/steam")); }
    let mut libraries = steam.clone();
    for root in steam {
        let tokens = strings(&read(&root.join("steamapps/libraryfolders.vdf")));
        for pair in tokens.windows(2) {
            if pair[0].eq_ignore_ascii_case("path") || pair[0].chars().all(|c| c.is_ascii_digit()) {
                let p = PathBuf::from(&pair[1]);
                if p.is_absolute() && p.join("steamapps").is_dir() { libraries.insert(p); }
            }
        }
    }
    let mut candidates: BTreeSet<PathBuf> = saved.iter().map(PathBuf::from).collect();
    for library in &libraries {
        let tokens = strings(&read(&library.join("steamapps/appmanifest_244210.acf")));
        for pair in tokens.windows(2) {
            if pair[0] == "installdir" && crate::security::relative_path(&pair[1]).is_ok() {
                candidates.insert(library.join("steamapps/common").join(&pair[1]));
            }
        }
        candidates.insert(library.join("steamapps/common/assettocorsa"));
    }
    let games: BTreeSet<String> = candidates.iter().filter_map(|p| crate::valid_game(&p.to_string_lossy()).ok())
        .map(|p|p.to_string_lossy().into_owned()).collect();
    let mut documents = BTreeSet::new();
    for key in ["USERPROFILE", "OneDrive", "OneDriveConsumer", "HOME"] {
        if let Some(p) = env::var_os(key) { documents.insert(PathBuf::from(p).join("Documents/Assetto Corsa")); }
    }
    #[cfg(windows)] if let Some(p) = registry("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders", "Personal") { documents.insert(p.join("Assetto Corsa")); }
    let mut cm: BTreeSet<PathBuf> = games.iter().map(|p|PathBuf::from(p).join("Content Manager.exe")).collect();
    if let Some(p) = env::var_os("USERPROFILE") { cm.insert(PathBuf::from(p).join("Desktop/Content Manager.exe")); }
    let cm_data = env::var_os("LOCALAPPDATA").map(PathBuf::from).map(|p|p.join("AcTools Content Manager")).filter(|p|p.is_dir());
    json!({"games":games,"steam_libraries":libraries.iter().filter(|p|p.is_dir()).collect::<Vec<_>>(),
        "documents":documents.iter().filter(|p|p.is_dir()).collect::<Vec<_>>(),
        "content_managers":cm.iter().filter(|p|p.is_file()).collect::<Vec<_>>(), "content_manager_data":cm_data})
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn parses_vdf_escapes() {
        assert_eq!(strings(r#""path" "D:\\SteamLibrary" "installdir" "assettocorsa""#), vec!["path", "D:\\SteamLibrary", "installdir", "assettocorsa"]);
    }
}
