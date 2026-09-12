//! Tier-pack installer core — port of `src/lib/installer.js`.
//!
//! Copies bundled mod folders (or extracts bundled archives) into the game
//! directory with per-file backups, emitting progress after every mod.

use crate::archive;
use crate::util::{ext_lower, is_within, rel_from, resolve_inside};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFile {
    pub file: String,
    pub dest: String,
    pub existed: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSpec {
    pub id: Option<String>,
    #[serde(default)]
    pub dest: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub tier: Option<String>,
    /// `overwrite === false` means "keep the user's existing files".
    #[serde(default)]
    pub overwrite: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModResult {
    pub id: String,
    pub tier: Option<String>,
    pub status: String,
    pub installed_files: Vec<InstalledFile>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub done: usize,
    pub total: usize,
    #[serde(rename = "mod")]
    pub mod_result: ModResult,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub success: bool,
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub mods: Vec<ModResult>,
}

pub struct InstallOptions<'a> {
    pub game_path: &'a str,
    pub mods: &'a [ModSpec],
    pub assets_mod_dir: &'a Path,
    pub backups_dir: &'a Path,
    pub tier: Option<&'a str>,
    pub on_progress: &'a dyn Fn(InstallProgress),
    pub is_cancelled: &'a dyn Fn() -> bool,
}

fn backup_path_for(backups_dir: &Path, mod_id: &str, rel: &str) -> PathBuf {
    backups_dir.join(mod_id).join("backup").join(format!("{rel}.bak"))
}

fn copy_with_backup(
    src: &Path,
    dest: &Path,
    rel: &str,
    mod_id: &str,
    backups_dir: &Path,
    records: &mut Vec<InstalledFile>,
) -> std::io::Result<()> {
    let existed = dest.exists();
    let mut backup = None;
    if existed {
        let b = backup_path_for(backups_dir, mod_id, rel);
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
    records.push(InstalledFile {
        file: rel.to_string(),
        dest: dest.to_string_lossy().to_string(),
        existed,
        backup_path: backup,
    });
    Ok(())
}

pub fn copy_directory_contents(
    source_dir: &Path,
    dest_root: &Path,
    mod_id: &str,
    backups_dir: &Path,
    records: &mut Vec<InstalledFile>,
) -> std::io::Result<()> {
    for entry in walkdir::WalkDir::new(source_dir).min_depth(1).into_iter().flatten() {
        let rel = match rel_from(source_dir, entry.path()) {
            Some(r) => r,
            None => continue,
        };
        let dest = dest_root.join(&rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest)?;
        } else if entry.file_type().is_file() {
            copy_with_backup(entry.path(), &dest, &rel, mod_id, backups_dir, records)?;
        }
    }
    Ok(())
}

/// Extract an archive straight into `dest_root`, backing up every existing
/// file first. Uses a temp staging dir so the backup logic stays uniform.
pub fn extract_archive(
    source: &Path,
    dest_root: &Path,
    mod_id: &str,
    backups_dir: &Path,
    records: &mut Vec<InstalledFile>,
) -> Result<(), String> {
    let staging = std::env::temp_dir().join(format!("uhm-pack-{}-{}", mod_id, crate::util::now_millis()));
    let ext = ext_lower(source);
    let extracted = match ext.as_str() {
        ".zip" => archive::extract_zip_to(source, &staging),
        ".rar" | ".cbr" => archive::extract_rar_to(source, &staging, None),
        _ => return Ok(()),
    };
    let result = match extracted {
        Ok(()) => copy_directory_contents(&staging, dest_root, mod_id, backups_dir, records).map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    };
    let _ = fs::remove_dir_all(&staging);
    result
}

pub const TIER_IDS: [&str; 5] = ["low", "medium", "high", "veryhigh", "ultra"];

/// Resolve which folders inside `mod-files/<mod>/` feed a given tier.
///
/// Layout A (same files for every tier):
///     mod-files/<mod>/**            → everything is copied
///
/// Layout B (per-tier files):
///     mod-files/<mod>/common/**     → copied for every tier (optional)
///     mod-files/<mod>/<tier>/**     → copied only for that tier
///     (loose files directly in <mod>/ are still copied for every tier)
///
/// Returned in copy order; later folders overwrite earlier ones, so the tier
/// folder always wins over `common`.
pub fn resolve_mod_sources(mod_dir: &Path, tier: Option<&str>) -> Vec<PathBuf> {
    let tiered = mod_dir.join("common").is_dir() || TIER_IDS.iter().any(|t| mod_dir.join(t).is_dir());
    if !tiered {
        return vec![mod_dir.to_path_buf()];
    }
    let mut out = vec![mod_dir.to_path_buf()]; // loose root files (tier dirs skipped in copy)
    if mod_dir.join("common").is_dir() {
        out.push(mod_dir.join("common"));
    }
    if let Some(t) = tier {
        if mod_dir.join(t).is_dir() {
            out.push(mod_dir.join(t));
        }
    }
    out
}

fn is_tier_layout_dir(name: &str) -> bool {
    name == "common" || TIER_IDS.contains(&name)
}

/// Like `copy_directory_contents` but skips the `common/` and `<tier>/`
/// sub-folders (used for the root of a per-tier mod folder).
fn copy_root_loose_files(
    source_dir: &Path,
    dest_root: &Path,
    mod_id: &str,
    backups_dir: &Path,
    records: &mut Vec<InstalledFile>,
) -> std::io::Result<()> {
    for entry in walkdir::WalkDir::new(source_dir)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !(e.depth() == 1 && e.file_type().is_dir() && is_tier_layout_dir(&e.file_name().to_string_lossy())))
        .flatten()
    {
        let rel = match rel_from(source_dir, entry.path()) {
            Some(r) => r,
            None => continue,
        };
        let dest = dest_root.join(&rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest)?;
        } else if entry.file_type().is_file() {
            copy_with_backup(entry.path(), &dest, &rel, mod_id, backups_dir, records)?;
        }
    }
    Ok(())
}

pub fn install_mods(opts: InstallOptions<'_>) -> InstallOutcome {
    let game = Path::new(opts.game_path);
    if opts.game_path.is_empty() || !game.exists() {
        return InstallOutcome { success: false, error: Some("INVALID_GAME_PATH".into()), cancelled: false, mods: vec![] };
    }
    if opts.mods.is_empty() {
        return InstallOutcome { success: false, error: Some("NO_MODS".into()), cancelled: false, mods: vec![] };
    }

    let total = opts.mods.len();
    let mut done = 0usize;
    let mut results: Vec<ModResult> = Vec::with_capacity(total);

    for m in opts.mods {
        if (opts.is_cancelled)() {
            break;
        }
        let mod_id: String = m
            .id
            .clone()
            .unwrap_or_else(|| "unknown".into())
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        let tier = opts.tier.map(|t| t.to_string()).or_else(|| m.tier.clone());

        if m.overwrite == Some(false) {
            done += 1;
            let skipped = ModResult { id: mod_id, tier, status: "skipped".into(), installed_files: vec![], message: "SKIPPED_KEEP_EXISTING".into() };
            (opts.on_progress)(InstallProgress { done, total, mod_result: skipped.clone(), stage: "skipped".into(), message: None });
            results.push(skipped);
            continue;
        }

        done += 1;
        let source: PathBuf = match &m.source {
            Some(s) if !s.is_empty() => PathBuf::from(s),
            _ => opts.assets_mod_dir.join(&mod_id),
        };
        let mut res = ModResult { id: mod_id.clone(), tier, status: "pending".into(), installed_files: vec![], message: String::new() };

        let dest_root = match resolve_inside(game, m.dest.as_deref().unwrap_or("")) {
            Some(d) => d,
            None => {
                res.status = "error".into();
                res.message = "UNSAFE_DEST".into();
                (opts.on_progress)(InstallProgress { done, total, mod_result: res.clone(), stage: "error".into(), message: None });
                results.push(res);
                continue;
            }
        };

        if !source.exists() {
            res.status = "missing".into();
            res.message = "MISSING_FILES".into();
            (opts.on_progress)(InstallProgress { done, total, mod_result: res.clone(), stage: "missing".into(), message: None });
            results.push(res);
            continue;
        }

        (opts.on_progress)(InstallProgress { done, total, mod_result: res.clone(), stage: "start".into(), message: Some(String::new()) });

        let ext = ext_lower(&source);
        let is_archive = matches!(ext.as_str(), ".zip" | ".rar" | ".cbr");
        let outcome: Result<(), String> = if let Err(e) = fs::create_dir_all(&dest_root) {
            Err(e.to_string())
        } else if m.kind.as_deref() == Some("extract") && is_archive {
            extract_archive(&source, &dest_root, &mod_id, opts.backups_dir, &mut res.installed_files)
        } else if source.is_dir() {
            // Folder source: flat layout or per-tier layout (common/ + <tier>/).
            let sources = resolve_mod_sources(&source, res.tier.as_deref());
            let tiered = sources.len() > 1;
            let mut r = Ok(());
            for (i, dir) in sources.iter().enumerate() {
                r = if tiered && i == 0 {
                    copy_root_loose_files(dir, &dest_root, &mod_id, opts.backups_dir, &mut res.installed_files)
                } else {
                    copy_directory_contents(dir, &dest_root, &mod_id, opts.backups_dir, &mut res.installed_files)
                };
                if r.is_err() { break; }
            }
            r.map_err(|e| e.to_string())
        } else {
            copy_directory_contents(&source, &dest_root, &mod_id, opts.backups_dir, &mut res.installed_files).map_err(|e| e.to_string())
        };

        match outcome {
            Ok(()) if res.installed_files.is_empty() => {
                res.status = "missing".into();
                res.message = "MISSING_FILES".into();
                (opts.on_progress)(InstallProgress { done, total, mod_result: res.clone(), stage: "missing".into(), message: None });
            }
            Ok(()) => {
                res.status = "installed".into();
                res.message = format!("FILES_{}", res.installed_files.len());
                (opts.on_progress)(InstallProgress { done, total, mod_result: res.clone(), stage: "installed".into(), message: None });
            }
            Err(e) => {
                res.status = "error".into();
                res.message = e;
                (opts.on_progress)(InstallProgress { done, total, mod_result: res.clone(), stage: "error".into(), message: None });
            }
        }
        results.push(res);
    }

    let cancelled = (opts.is_cancelled)();
    let has_errors = results.iter().any(|r| r.status == "error");
    let has_installed = results.iter().any(|r| r.status == "installed");
    InstallOutcome { success: !cancelled && !has_errors && has_installed, cancelled, error: None, mods: results }
}

/* ------------------------------------------------------------------ */
/*  Uninstall                                                          */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallFile {
    pub dest: Option<String>,
    #[serde(default)]
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallResult {
    pub dest: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub fn uninstall_files(files: &[UninstallFile]) -> Vec<UninstallResult> {
    let mut out = Vec::new();
    for f in files {
        let Some(dest) = f.dest.as_deref().filter(|d| !d.is_empty()) else { continue };
        let dest_p = Path::new(dest);
        let backup = f.backup_path.as_deref().map(Path::new).filter(|b| b.exists());
        let r: std::io::Result<&str> = (|| {
            if let Some(b) = backup {
                if let Some(p) = dest_p.parent() {
                    fs::create_dir_all(p)?;
                }
                fs::copy(b, dest_p)?;
                fs::remove_file(b)?;
                Ok("restored")
            } else if dest_p.exists() {
                fs::remove_file(dest_p)?;
                Ok("deleted")
            } else {
                Ok("not_found")
            }
        })();
        match r {
            Ok(status) => out.push(UninstallResult { dest: dest.to_string(), status: status.into(), message: None }),
            Err(e) => out.push(UninstallResult { dest: dest.to_string(), status: "error".into(), message: Some(e.to_string()) }),
        }
    }
    out
}

#[allow(dead_code)]
pub fn is_inside(base: &Path, target: &Path) -> bool {
    is_within(base, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, s: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }

    #[test]
    fn install_copy_with_backup_then_uninstall() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        let assets = tmp.path().join("assets");
        let backups = tmp.path().join("backups");
        write(&game.join("system/cfg/video.ini"), "old");
        write(&assets.join("video/video.ini"), "new");
        write(&assets.join("video/sub/extra.ini"), "x");

        let mods = vec![ModSpec { id: Some("video".into()), dest: Some("system/cfg".into()), kind: Some("copy".into()), source: None, tier: None, overwrite: None }];
        let progress = std::cell::RefCell::new(Vec::new());
        let out = install_mods(InstallOptions {
            game_path: game.to_str().unwrap(),
            mods: &mods,
            assets_mod_dir: &assets,
            backups_dir: &backups,
            tier: Some("low"),
            on_progress: &|p| progress.borrow_mut().push(p.stage),
            is_cancelled: &|| false,
        });
        assert!(out.success, "{out:?}");
        assert_eq!(out.mods[0].status, "installed");
        assert_eq!(out.mods[0].installed_files.len(), 2);
        assert_eq!(fs::read_to_string(game.join("system/cfg/video.ini")).unwrap(), "new");
        let backed = out.mods[0].installed_files.iter().find(|f| f.file == "video.ini").unwrap();
        assert!(backed.existed && backed.backup_path.is_some());
        assert_eq!(progress.borrow().as_slice(), &["start".to_string(), "installed".to_string()]);

        let files: Vec<UninstallFile> = out.mods[0].installed_files.iter().map(|f| UninstallFile { dest: Some(f.dest.clone()), backup_path: f.backup_path.clone() }).collect();
        let res = uninstall_files(&files);
        assert!(res.iter().any(|r| r.status == "restored"));
        assert!(res.iter().any(|r| r.status == "deleted"));
        assert_eq!(fs::read_to_string(game.join("system/cfg/video.ini")).unwrap(), "old");
    }

    #[test]
    fn install_per_tier_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        let assets = tmp.path().join("assets");
        fs::create_dir_all(&game).unwrap();
        write(&assets.join("video/readme.txt"), "loose");
        write(&assets.join("video/common/shared.ini"), "shared");
        write(&assets.join("video/common/video.ini"), "common");
        write(&assets.join("video/ultra/video.ini"), "ultra");
        write(&assets.join("video/low/video.ini"), "low");

        let run = |tier: &str| {
            let mods = vec![ModSpec { id: Some("video".into()), dest: Some("system/cfg".into()), kind: None, source: None, tier: None, overwrite: None }];
            install_mods(InstallOptions {
                game_path: game.to_str().unwrap(), mods: &mods, assets_mod_dir: &assets,
                backups_dir: &tmp.path().join("b"), tier: Some(tier), on_progress: &|_| {}, is_cancelled: &|| false,
            })
        };
        let out = run("ultra");
        assert!(out.success, "{out:?}");
        assert_eq!(fs::read_to_string(game.join("system/cfg/video.ini")).unwrap(), "ultra");
        assert_eq!(fs::read_to_string(game.join("system/cfg/shared.ini")).unwrap(), "shared");
        assert_eq!(fs::read_to_string(game.join("system/cfg/readme.txt")).unwrap(), "loose");
        assert!(!game.join("system/cfg/ultra").exists(), "tier folder itself must not be copied");
        assert!(!game.join("system/cfg/common").exists());

        let out = run("low");
        assert!(out.success);
        assert_eq!(fs::read_to_string(game.join("system/cfg/video.ini")).unwrap(), "low");

        // Tier without its own folder falls back to common/ + loose files.
        let out = run("medium");
        assert!(out.success);
        assert_eq!(fs::read_to_string(game.join("system/cfg/video.ini")).unwrap(), "common");

        // Flat layout is untouched.
        assert_eq!(resolve_mod_sources(&assets.join("nothing"), Some("low")), vec![assets.join("nothing")]);
    }

    #[test]
    fn install_missing_unsafe_and_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        fs::create_dir_all(&game).unwrap();
        let mods = vec![
            ModSpec { id: Some("csp".into()), dest: None, kind: None, source: None, tier: None, overwrite: None },
            ModSpec { id: Some("hud".into()), dest: Some("../evil".into()), kind: None, source: None, tier: None, overwrite: None },
            ModSpec { id: Some("pure".into()), dest: None, kind: None, source: None, tier: None, overwrite: Some(false) },
        ];
        let out = install_mods(InstallOptions {
            game_path: game.to_str().unwrap(),
            mods: &mods,
            assets_mod_dir: &tmp.path().join("none"),
            backups_dir: &tmp.path().join("b"),
            tier: None,
            on_progress: &|_| {},
            is_cancelled: &|| false,
        });
        assert!(!out.success);
        assert_eq!(out.mods[0].status, "missing");
        assert_eq!(out.mods[1].status, "error");
        assert_eq!(out.mods[1].message, "UNSAFE_DEST");
        assert_eq!(out.mods[2].status, "skipped");
    }
}
