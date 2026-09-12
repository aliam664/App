//! Pack installer core.
//!
//! Two kinds of bundled content live under the app's `mods/` resource dir:
//!
//! ```text
//! mods/
//! ├── graphics/                 the 5-tier graphics pack
//! │   ├── common/               optional — installed for every tier
//! │   └── low|medium|high|veryhigh|ultra/
//! │       └── <mirror of the game folder>
//! └── addons/                   any number of optional add-ons
//!     └── <id>/
//!         ├── mod.json          optional metadata (name/description/…)
//!         ├── preview.png       card image shown in the app
//!         └── files/            <mirror of the game folder>
//! ```
//!
//! Every source folder is a *mirror* of the game directory: whatever is inside
//! is copied 1:1 onto the game root, with a per-file backup of anything that
//! already existed so the operation can be reverted later.

use crate::util::{is_within, rel_from, resolve_inside};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const TIER_IDS: [&str; 5] = ["low", "medium", "high", "veryhigh", "ultra"];
pub const GRAPHICS_DIR: &str = "graphics";
pub const ADDONS_DIR: &str = "addons";
pub const ADDON_FILES_DIR: &str = "files";
pub const GRAPHICS_MOD_ID: &str = "graphics";

/* ------------------------------------------------------------------ */
/*  Wire types (camelCase — consumed directly by the webview)          */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFile {
    pub file: String,
    pub dest: String,
    pub existed: bool,
    pub backup_path: Option<String>,
}

/// One unit of work in an install plan.
///
/// * `id == "graphics"` → the tier pack (`tier` selects the folder)
/// * anything else      → an add-on id under `mods/addons/`
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSpec {
    pub id: Option<String>,
    #[serde(default)]
    pub tier: Option<String>,
    /// Relative destination inside the game folder ("" = game root).
    #[serde(default)]
    pub dest: Option<String>,
    /// `false` = "keep the user's existing files" → skipped.
    #[serde(default)]
    pub overwrite: Option<bool>,
    /// Top-level relative paths that must NOT be touched (e.g. keep the
    /// user's own CSP: `["extension", "dwrite.dll"]`).
    #[serde(default)]
    pub exclude: Vec<String>,
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
    /// File-level progress inside the current mod (for the live bar).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_done: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_total: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
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
    /// The bundled `mods/` directory.
    pub mods_dir: &'a Path,
    pub backups_dir: &'a Path,
    pub tier: Option<&'a str>,
    pub on_progress: &'a dyn Fn(InstallProgress),
    pub is_cancelled: &'a dyn Fn() -> bool,
}

/* ------------------------------------------------------------------ */
/*  Source resolution                                                  */
/* ------------------------------------------------------------------ */

pub fn is_valid_tier(t: &str) -> bool {
    TIER_IDS.contains(&t)
}

/// Folders (in copy order) that make up the graphics pack for `tier`.
/// Later folders overwrite earlier ones, so `<tier>/` beats `common/`.
pub fn graphics_sources(mods_dir: &Path, tier: &str) -> Vec<PathBuf> {
    let root = mods_dir.join(GRAPHICS_DIR);
    let mut out = Vec::new();
    if root.join("common").is_dir() {
        out.push(root.join("common"));
    }
    if is_valid_tier(tier) && root.join(tier).is_dir() {
        out.push(root.join(tier));
    }
    out
}

/// `mods/addons/<id>/files` for a sanitised add-on id.
pub fn addon_files_dir(mods_dir: &Path, id: &str) -> Option<PathBuf> {
    let clean = sanitize_id(id);
    if clean.is_empty() {
        return None;
    }
    Some(mods_dir.join(ADDONS_DIR).join(clean).join(ADDON_FILES_DIR))
}

pub fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.')
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

/* ------------------------------------------------------------------ */
/*  File operations                                                    */
/* ------------------------------------------------------------------ */

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
        // Only the FIRST backup of a file is the user's original; never let
        // a re-install overwrite it with our own previous copy.
        if !b.exists() {
            fs::copy(dest, &b)?;
        }
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

fn is_excluded(rel: &str, exclude: &[String]) -> bool {
    let rel_l = rel.to_ascii_lowercase();
    exclude.iter().any(|e| {
        let e = crate::util::norm_rel(e).to_ascii_lowercase();
        !e.is_empty() && (rel_l == e || rel_l.starts_with(&format!("{e}/")))
    })
}

/// Collect `(absolute source, relative path)` pairs of every regular file in
/// `source_dir`, honouring `exclude`. Files from later dirs replace earlier
/// ones with the same relative path.
fn collect_files(sources: &[PathBuf], exclude: &[String]) -> Vec<(PathBuf, String)> {
    let mut map: std::collections::BTreeMap<String, PathBuf> = std::collections::BTreeMap::new();
    for dir in sources {
        for entry in walkdir::WalkDir::new(dir).min_depth(1).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = rel_from(dir, entry.path()) else { continue };
            if is_ignored_file(&rel) || is_excluded(&rel, exclude) {
                continue;
            }
            map.insert(rel, entry.path().to_path_buf());
        }
    }
    map.into_iter().map(|(rel, src)| (src, rel)).collect()
}

/// Housekeeping files that must never land in the game folder.
fn is_ignored_file(rel: &str) -> bool {
    let leaf = rel.rsplit('/').next().unwrap_or(rel);
    matches!(leaf, ".gitkeep" | ".DS_Store" | "Thumbs.db" | "desktop.ini")
}

/// Copy every file of `sources` onto `dest_root`, reporting per-file progress.
#[allow(clippy::too_many_arguments)]
fn copy_sources(
    sources: &[PathBuf],
    dest_root: &Path,
    mod_id: &str,
    exclude: &[String],
    backups_dir: &Path,
    records: &mut Vec<InstalledFile>,
    mut on_file: impl FnMut(usize, usize, &str),
    is_cancelled: &dyn Fn() -> bool,
) -> Result<bool, String> {
    let files = collect_files(sources, exclude);
    let total = files.len();
    for (i, (src, rel)) in files.iter().enumerate() {
        if is_cancelled() {
            return Ok(false);
        }
        let dest = dest_root.join(rel);
        if !is_within(dest_root, &dest) {
            continue;
        }
        on_file(i + 1, total, rel);
        copy_with_backup(src, &dest, rel, mod_id, backups_dir, records).map_err(|e| format!("{rel}: {e}"))?;
    }
    Ok(true)
}

/* ------------------------------------------------------------------ */
/*  Install                                                            */
/* ------------------------------------------------------------------ */

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
    let mut was_cancelled = false;

    let emit = |done: usize, res: &ModResult, stage: &str| {
        (opts.on_progress)(InstallProgress {
            done, total, mod_result: res.clone(), stage: stage.into(), message: None,
            file_done: None, file_total: None, current_file: None,
        });
    };

    for m in opts.mods {
        if (opts.is_cancelled)() {
            was_cancelled = true;
            break;
        }
        let mod_id = sanitize_id(m.id.as_deref().unwrap_or("unknown"));
        let tier = opts.tier.map(str::to_string).or_else(|| m.tier.clone());
        done += 1;
        let mut res = ModResult { id: mod_id.clone(), tier: tier.clone(), status: "pending".into(), installed_files: vec![], message: String::new() };

        if m.overwrite == Some(false) {
            res.status = "skipped".into();
            res.message = "SKIPPED_KEEP_EXISTING".into();
            emit(done, &res, "skipped");
            results.push(res);
            continue;
        }

        // Where do the files come from?
        let sources: Vec<PathBuf> = if mod_id == GRAPHICS_MOD_ID {
            match tier.as_deref().filter(|t| is_valid_tier(t)) {
                Some(t) => graphics_sources(opts.mods_dir, t),
                None => {
                    res.status = "error".into();
                    res.message = "INVALID_TIER".into();
                    emit(done, &res, "error");
                    results.push(res);
                    continue;
                }
            }
        } else {
            addon_files_dir(opts.mods_dir, &mod_id).filter(|d| d.is_dir()).into_iter().collect()
        };

        let dest_root = match resolve_inside(game, m.dest.as_deref().unwrap_or("")) {
            Some(d) => d,
            None => {
                res.status = "error".into();
                res.message = "UNSAFE_DEST".into();
                emit(done, &res, "error");
                results.push(res);
                continue;
            }
        };

        if sources.is_empty() {
            res.status = "missing".into();
            res.message = "MISSING_FILES".into();
            emit(done, &res, "missing");
            results.push(res);
            continue;
        }

        emit(done, &res, "start");

        let outcome = fs::create_dir_all(&dest_root).map_err(|e| e.to_string()).and_then(|_| {
            let progress_res = res.clone();
            copy_sources(
                &sources, &dest_root, &mod_id, &m.exclude, opts.backups_dir, &mut res.installed_files,
                |fd, ft, rel| {
                    (opts.on_progress)(InstallProgress {
                        done, total, mod_result: progress_res.clone(), stage: "file".into(), message: None,
                        file_done: Some(fd), file_total: Some(ft), current_file: Some(rel.to_string()),
                    });
                },
                opts.is_cancelled,
            )
        });

        match outcome {
            Ok(false) => {
                // Cancelled mid-way: keep what was copied so it can be reverted.
                was_cancelled = true;
                res.status = "error".into();
                res.message = "CANCELLED".into();
                emit(done, &res, "error");
                results.push(res);
                break;
            }
            Ok(true) if res.installed_files.is_empty() => {
                res.status = "missing".into();
                res.message = "MISSING_FILES".into();
                emit(done, &res, "missing");
            }
            Ok(true) => {
                res.status = "installed".into();
                res.message = format!("FILES_{}", res.installed_files.len());
                emit(done, &res, "installed");
            }
            Err(e) => {
                res.status = "error".into();
                res.message = e;
                emit(done, &res, "error");
            }
        }
        results.push(res);
    }

    let cancelled = was_cancelled || (opts.is_cancelled)();
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

/// Revert installed files: restore the backup when there is one, otherwise
/// delete the file we created. Empty directories left behind are pruned.
pub fn uninstall_files(files: &[UninstallFile]) -> Vec<UninstallResult> {
    let mut out = Vec::new();
    let mut touched_dirs: Vec<PathBuf> = Vec::new();
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
                if let Some(p) = dest_p.parent() {
                    touched_dirs.push(p.to_path_buf());
                }
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
    // Prune now-empty directories (deepest first) so uninstalling an add-on
    // does not leave an empty `apps/python/<x>/` skeleton behind.
    touched_dirs.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    touched_dirs.dedup();
    for d in touched_dirs {
        let mut cur = Some(d);
        while let Some(p) = cur {
            // Pattern-guard bindings are immutable, so check emptiness first.
            let is_empty = match fs::read_dir(&p) {
                Ok(mut it) => it.next().is_none(),
                Err(_) => false,
            };
            if !is_empty || fs::remove_dir(&p).is_err() {
                break;
            }
            cur = p.parent().map(Path::to_path_buf);
        }
    }
    out
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, s: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }

    fn spec(id: &str) -> ModSpec {
        ModSpec { id: Some(id.into()), tier: None, dest: None, overwrite: None, exclude: vec![] }
    }

    struct Env {
        _tmp: tempfile::TempDir,
        game: PathBuf,
        mods: PathBuf,
        backups: PathBuf,
    }

    fn env() -> Env {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        let mods = tmp.path().join("mods");
        let backups = tmp.path().join("backups");
        fs::create_dir_all(&game).unwrap();
        Env { game, mods, backups, _tmp: tmp }
    }

    fn run(e: &Env, mods: &[ModSpec], tier: Option<&str>, log: &std::cell::RefCell<Vec<InstallProgress>>) -> InstallOutcome {
        install_mods(InstallOptions {
            game_path: e.game.to_str().unwrap(),
            mods,
            mods_dir: &e.mods,
            backups_dir: &e.backups,
            tier,
            on_progress: &|p| log.borrow_mut().push(p),
            is_cancelled: &|| false,
        })
    }

    #[test]
    fn graphics_pack_tier_overrides_common_and_backs_up() {
        let e = env();
        write(&e.game.join("system/cfg/video.ini"), "user-original");
        write(&e.mods.join("graphics/common/extension/config/shared.ini"), "shared");
        write(&e.mods.join("graphics/common/system/cfg/video.ini"), "common");
        write(&e.mods.join("graphics/ultra/system/cfg/video.ini"), "ultra");
        write(&e.mods.join("graphics/ultra/.gitkeep"), "");
        write(&e.mods.join("graphics/low/system/cfg/video.ini"), "low");

        let log = std::cell::RefCell::new(vec![]);
        let out = run(&e, &[spec("graphics")], Some("ultra"), &log);
        assert!(out.success, "{out:?}");
        let g = &out.mods[0];
        assert_eq!(g.status, "installed");
        assert_eq!(g.installed_files.len(), 2, "gitkeep must be ignored: {:?}", g.installed_files);
        assert_eq!(fs::read_to_string(e.game.join("system/cfg/video.ini")).unwrap(), "ultra");
        assert_eq!(fs::read_to_string(e.game.join("extension/config/shared.ini")).unwrap(), "shared");
        let v = g.installed_files.iter().find(|f| f.file == "system/cfg/video.ini").unwrap();
        assert!(v.existed);
        assert_eq!(fs::read_to_string(v.backup_path.as_ref().unwrap()).unwrap(), "user-original");

        // File-level progress was reported.
        let stages: Vec<String> = log.borrow().iter().map(|p| p.stage.clone()).collect();
        assert_eq!(stages.first().map(String::as_str), Some("start"));
        assert!(stages.iter().any(|s| s == "file"));
        assert_eq!(stages.last().map(String::as_str), Some("installed"));

        // Re-install with another tier must NOT clobber the original backup.
        let out2 = run(&e, &[spec("graphics")], Some("low"), &log);
        assert!(out2.success);
        assert_eq!(fs::read_to_string(e.game.join("system/cfg/video.ini")).unwrap(), "low");
        assert_eq!(fs::read_to_string(v.backup_path.as_ref().unwrap()).unwrap(), "user-original");

        // Uninstall restores the user's original and deletes the new file.
        let files: Vec<UninstallFile> = out2.mods[0].installed_files.iter().map(|f| UninstallFile { dest: Some(f.dest.clone()), backup_path: f.backup_path.clone() }).collect();
        let res = uninstall_files(&files);
        assert!(res.iter().any(|r| r.status == "restored"));
        assert_eq!(fs::read_to_string(e.game.join("system/cfg/video.ini")).unwrap(), "user-original");
    }

    #[test]
    fn graphics_exclude_keeps_users_csp() {
        let e = env();
        write(&e.game.join("dwrite.dll"), "user-csp");
        write(&e.game.join("extension/config/general.ini"), "user-csp-cfg");
        write(&e.mods.join("graphics/high/dwrite.dll"), "pack-csp");
        write(&e.mods.join("graphics/high/extension/config/general.ini"), "pack");
        write(&e.mods.join("graphics/high/system/cfg/video.ini"), "pack");

        let mut s = spec("graphics");
        s.exclude = vec!["extension".into(), "dwrite.dll".into()];
        let log = std::cell::RefCell::new(vec![]);
        let out = run(&e, &[s], Some("high"), &log);
        assert!(out.success, "{out:?}");
        assert_eq!(out.mods[0].installed_files.len(), 1);
        assert_eq!(fs::read_to_string(e.game.join("dwrite.dll")).unwrap(), "user-csp");
        assert_eq!(fs::read_to_string(e.game.join("extension/config/general.ini")).unwrap(), "user-csp-cfg");
        assert_eq!(fs::read_to_string(e.game.join("system/cfg/video.ini")).unwrap(), "pack");
    }

    #[test]
    fn graphics_missing_tier_and_invalid_tier() {
        let e = env();
        write(&e.mods.join("graphics/ultra/a.txt"), "x");
        let log = std::cell::RefCell::new(vec![]);
        let out = run(&e, &[spec("graphics")], Some("medium"), &log);
        assert_eq!(out.mods[0].status, "missing");
        let out = run(&e, &[spec("graphics")], Some("../evil"), &log);
        assert_eq!(out.mods[0].status, "error");
        assert_eq!(out.mods[0].message, "INVALID_TIER");
        let out = run(&e, &[spec("graphics")], None, &log);
        assert_eq!(out.mods[0].message, "INVALID_TIER");
    }

    #[test]
    fn addon_install_ignores_metadata_and_prunes_dirs_on_uninstall() {
        let e = env();
        write(&e.mods.join("addons/hud-gas/mod.json"), "{}");
        write(&e.mods.join("addons/hud-gas/preview.png"), "png");
        write(&e.mods.join("addons/hud-gas/files/apps/python/GasHUD/GasHUD.py"), "py");
        write(&e.mods.join("addons/hud-gas/files/apps/python/GasHUD/icon.png"), "ico");

        let log = std::cell::RefCell::new(vec![]);
        let out = run(&e, &[spec("hud-gas")], Some("ultra"), &log);
        assert!(out.success, "{out:?}");
        assert_eq!(out.mods[0].installed_files.len(), 2);
        assert!(!e.game.join("mod.json").exists());
        assert!(!e.game.join("preview.png").exists());
        assert!(e.game.join("apps/python/GasHUD/GasHUD.py").exists());

        let files: Vec<UninstallFile> = out.mods[0].installed_files.iter().map(|f| UninstallFile { dest: Some(f.dest.clone()), backup_path: f.backup_path.clone() }).collect();
        let res = uninstall_files(&files);
        assert!(res.iter().all(|r| r.status == "deleted"));
        assert!(!e.game.join("apps").exists(), "empty dirs must be pruned");
        assert!(e.game.exists(), "game root itself must survive");
    }

    #[test]
    fn addon_unknown_id_is_missing_and_ids_are_sanitised() {
        let e = env();
        let log = std::cell::RefCell::new(vec![]);
        let out = run(&e, &[spec("../../etc")], None, &log);
        assert_eq!(out.mods[0].status, "missing");
        assert_eq!(out.mods[0].id, "etc");
        assert_eq!(sanitize_id("my addon!"), "myaddon");
        assert!(addon_files_dir(&e.mods, "///").is_none());
    }

    #[test]
    fn skipped_and_unsafe_dest() {
        let e = env();
        let mut keep = spec("graphics");
        keep.overwrite = Some(false);
        let mut bad = spec("x");
        bad.dest = Some("../evil".into());
        let log = std::cell::RefCell::new(vec![]);
        let out = run(&e, &[keep, bad], Some("low"), &log);
        assert_eq!(out.mods[0].status, "skipped");
        assert_eq!(out.mods[1].message, "UNSAFE_DEST");
        assert!(!out.success);
    }

    #[test]
    fn cancel_mid_copy_keeps_records_for_revert() {
        let e = env();
        for i in 0..5 {
            write(&e.mods.join(format!("graphics/low/f{i}.txt")), "x");
        }
        let count = std::cell::Cell::new(0);
        let out = install_mods(InstallOptions {
            game_path: e.game.to_str().unwrap(),
            mods: &[spec("graphics")],
            mods_dir: &e.mods,
            backups_dir: &e.backups,
            tier: Some("low"),
            on_progress: &|p| if p.stage == "file" { count.set(count.get() + 1) },
            is_cancelled: &|| count.get() >= 2,
        });
        assert!(out.cancelled);
        assert!(!out.success);
        assert_eq!(out.mods[0].message, "CANCELLED");
        assert!(!out.mods[0].installed_files.is_empty());
        assert!(out.mods[0].installed_files.len() < 5);
    }
}
