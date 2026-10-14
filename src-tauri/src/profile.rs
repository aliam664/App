//! User-profile settings — the "second layer" of the graphics pack.
//!
//! Assetto Corsa keeps the settings that actually take effect in the
//! user's Documents folder, not in the game folder:
//!
//!   <Documents>\Assetto Corsa\cfg\video.ini            (video settings)
//!   <Documents>\Assetto Corsa\cfg\extension\*.ini      (CSP/Pure overrides)
//!
//! Those files win over anything installed into the game folder, so a
//! pack that only ships `system/cfg/video.ini` and `extension/config/`
//! never changes what most players actually run. This module applies the
//! pack's curated settings (bundled under `mods/settings/`) onto that
//! profile — safely:
//!
//! * Video settings are MERGED, never blindly overwritten: the player's
//!   display keys (resolution, refresh rate, fullscreen, vsync) always
//!   survive; everything else comes from the pack template.
//! * CSP/Pure settings are copied per file; every overwritten file is
//!   backed up first (first backup wins — it holds the user's original),
//!   and every write is returned so the caller can record it in the
//!   manifest and the existing uninstall path can revert it.
//!
//! Only two whitelisted locations under the profile are ever written:
//! `cfg/video.ini` and `cfg/extension/**.ini`.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Display keys in `video.ini` that always stay with the user's values.
const DISPLAY_KEYS: [&str; 5] = ["WIDTH", "HEIGHT", "REFRESH", "FULLSCREEN", "VSYNC"];

/* ------------------------------------------------------------------ */
/*  Locations                                                          */
/* ------------------------------------------------------------------ */

/// The user's Documents folder (Windows: `%USERPROFILE%\Documents`).
pub fn documents_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.is_empty() {
                return Some(PathBuf::from(profile).join("Documents"));
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                return Some(PathBuf::from(home).join("Documents"));
            }
        }
    }
    None
}

/// `<Documents>\Assetto Corsa\cfg` — where effective user settings live.
pub fn profile_cfg_dir() -> Option<PathBuf> {
    documents_dir().map(|d| d.join("Assetto Corsa").join("cfg"))
}

/* ------------------------------------------------------------------ */
/*  INI merge (video)                                                  */
/* ------------------------------------------------------------------ */

struct IniFile {
    // (section, [(key, value)]) in file order; section "" = preamble.
    sections: Vec<(String, Vec<(String, String)>)>,
}

fn parse_ini(text: &str) -> IniFile {
    let mut out = IniFile { sections: vec![(String::new(), Vec::new())] };
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue; // comments are not preserved by the merge
        }
        if line.starts_with('[') && line.ends_with(']') {
            out.sections.push((line[1..line.len() - 1].trim().to_string(), Vec::new()));
            continue;
        }
        if let Some(eq) = line.find('=') {
            let key = line[..eq].trim().to_string();
            let value = line[eq + 1..].trim().to_string();
            if !key.is_empty() {
                out.sections.last_mut().unwrap().1.push((key, value));
            }
        }
    }
    out
}

fn render_ini(ini: &IniFile) -> String {
    let mut s = String::new();
    for (section, entries) in &ini.sections {
        if entries.is_empty() {
            continue;
        }
        if !section.is_empty() {
            s.push_str(&format!("[{section}]\n"));
        }
        for (k, v) in entries {
            s.push_str(&format!("{k}={v}\n"));
        }
        s.push('\n');
    }
    s
}

/// Merge the pack's video template with the player's current file:
/// template wins everywhere except the display keys, which always keep
/// the player's values. Sections that exist only in the player's file
/// are carried over untouched (they may belong to other tools).
pub fn merge_video_ini(template: &str, existing: Option<&str>) -> String {
    let tpl = parse_ini(template);
    let Some(existing_text) = existing else {
        return render_ini(&tpl);
    };
    let user = parse_ini(existing_text);
    let user_get = |section: &str, key: &str| -> Option<String> {
        user.sections
            .iter()
            .find(|(s, _)| s.eq_ignore_ascii_case(section))
            .and_then(|(_, entries)| {
                entries
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(key))
                    .map(|(_, v)| v.clone())
            })
    };

    let mut merged = IniFile { sections: Vec::new() };
    for (section, entries) in &tpl.sections {
        let mut out_entries: Vec<(String, String)> = Vec::new();
        for (k, v) in entries {
            if DISPLAY_KEYS.iter().any(|dk| dk.eq_ignore_ascii_case(k)) {
                if let Some(user_value) = user_get(section, k) {
                    out_entries.push((k.clone(), user_value));
                    continue;
                }
            }
            out_entries.push((k.clone(), v.clone()));
        }
        // Display keys the user has but the template does not: keep them.
        if let Some((_, user_entries)) = user.sections.iter().find(|(s, _)| s.eq_ignore_ascii_case(section)) {
            for (k, v) in user_entries {
                if DISPLAY_KEYS.iter().any(|dk| dk.eq_ignore_ascii_case(k))
                    && !out_entries.iter().any(|(ok, _)| ok.eq_ignore_ascii_case(k))
                {
                    out_entries.push((k.clone(), v.clone()));
                }
            }
        }
        merged.sections.push((section.clone(), out_entries));
    }
    // Sections only the user has are preserved as-is.
    for (section, entries) in &user.sections {
        if !merged.sections.iter().any(|(s, _)| s.eq_ignore_ascii_case(section)) {
            merged.sections.push((section.clone(), entries.clone()));
        }
    }
    render_ini(&merged)
}

/* ------------------------------------------------------------------ */
/*  Applying the profile layer                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFile {
    pub dest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
    pub existed: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileOutcome {
    pub success: bool,
    pub applied_video: bool,
    pub applied_csp_files: usize,
    /// Every file written, for the manifest (uninstall reverts them).
    pub files: Vec<ProfileFile>,
    pub warnings: Vec<String>,
}

/// The pack's profile-settings sources for a tier, in override order:
/// `mods/settings/common/` first, then `mods/settings/<tier>/`.
fn settings_sources(mods_dir: &Path, tier: &str) -> Vec<PathBuf> {
    let root = mods_dir.join("settings");
    let valid = crate::installer::is_valid_tier(tier);
    let mut out = vec![root.join("common")];
    if valid {
        out.push(root.join(tier));
    }
    out.into_iter().filter(|p| p.is_dir()).collect()
}

/// Collect `csp/**.ini` from the sources; later sources win per path.
fn collect_csp_settings(sources: &[PathBuf]) -> Vec<(PathBuf, String)> {
    let mut map: BTreeMap<String, PathBuf> = BTreeMap::new();
    for src in sources {
        let csp_dir = src.join("csp");
        if !csp_dir.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&csp_dir).min_depth(1).into_iter().flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = crate::util::rel_from(&csp_dir, entry.path()) else { continue };
            if rel.to_ascii_lowercase().ends_with(".ini") {
                map.insert(rel, entry.path().to_path_buf());
            }
        }
    }
    map.into_iter().map(|(rel, src)| (src, rel)).collect()
}

/// Back up `dest` (first backup wins) and return the backup path.
fn backup_once(dest: &Path, backups_root: &Path, slug: &str) -> std::io::Result<PathBuf> {
    let b = backups_root.join("profile").join(format!("{slug}.bak"));
    if let Some(p) = b.parent() {
        fs::create_dir_all(p)?;
    }
    if !b.exists() {
        fs::copy(dest, &b)?;
    }
    Ok(b)
}

fn slug(rel: &str) -> String {
    rel.replace(['/', '\\'], "__")
}

/// Apply the pack's profile settings for `tier`.
///
/// * `apply_video` — merge `video.ini` (template: the tier's file wins
///   over common's) into the profile, preserving display keys.
/// * `apply_csp` — copy every `csp/**.ini` into `cfg/extension/`.
pub fn apply_profile(
    mods_dir: &Path,
    backups_root: &Path,
    tier: &str,
    apply_video: bool,
    apply_csp: bool,
) -> ProfileOutcome {
    let mut out = ProfileOutcome { success: true, ..Default::default() };
    let Some(cfg_dir) = profile_cfg_dir() else {
        out.success = false;
        out.warnings.push("NO_DOCUMENTS_DIR".into());
        return out;
    };
    let sources = settings_sources(mods_dir, tier);
    if sources.is_empty() {
        out.warnings.push("NO_SETTINGS_BUNDLED".into());
        return out; // nothing bundled: not an error, just nothing to do
    }

    if apply_video {
        // Tier template wins over common.
        let template_path = sources
            .iter()
            .rev()
            .map(|s| s.join("video.ini"))
            .find(|p| p.is_file());
        if let Some(tpl) = template_path {
            match fs::read_to_string(&tpl) {
                Ok(template) => {
                    let dest = cfg_dir.join("video.ini");
                    let existing = fs::read_to_string(&dest).ok();
                    let existed = dest.exists();
                    let mut backup_path = None;
                    let write_result: std::io::Result<()> = (|| {
                        if existed {
                            backup_path = Some(
                                backup_once(&dest, backups_root, "video.ini")?
                                    .to_string_lossy()
                                    .to_string(),
                            );
                        }
                        if let Some(p) = dest.parent() {
                            fs::create_dir_all(p)?;
                        }
                        fs::write(&dest, merge_video_ini(&template, existing.as_deref()))
                    })();
                    match write_result {
                        Ok(()) => {
                            out.applied_video = true;
                            out.files.push(ProfileFile {
                                dest: dest.to_string_lossy().to_string(),
                                backup_path,
                                existed,
                            });
                        }
                        Err(e) => {
                            out.success = false;
                            out.warnings.push(format!("VIDEO_WRITE_FAILED: {e}"));
                        }
                    }
                }
                Err(e) => out.warnings.push(format!("VIDEO_TEMPLATE_UNREADABLE: {e}")),
            }
        }
    }

    if apply_csp {
        for (src, rel) in collect_csp_settings(&sources) {
            let dest = cfg_dir.join("extension").join(&rel);
            let existed = dest.exists();
            let mut backup_path = None;
            let result: std::io::Result<()> = (|| {
                if existed {
                    backup_path = Some(
                        backup_once(&dest, backups_root, &format!("extension__{}", slug(&rel)))?
                            .to_string_lossy()
                            .to_string(),
                    );
                }
                if let Some(p) = dest.parent() {
                    fs::create_dir_all(p)?;
                }
                fs::copy(&src, &dest)?;
                Ok(())
            })();
            match result {
                Ok(()) => {
                    out.applied_csp_files += 1;
                    out.files.push(ProfileFile {
                        dest: dest.to_string_lossy().to_string(),
                        backup_path,
                        existed,
                    });
                }
                Err(e) => {
                    out.success = false;
                    out.warnings.push(format!("CSP_WRITE_FAILED: {rel}: {e}"));
                }
            }
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

    #[test]
    fn merge_preserves_display_keys_and_applies_template() {
        let template = "[VIDEO]\nWIDTH=1920\nHEIGHT=1080\nREFRESH=60\nFULLSCREEN=1\nSHADOW_MAP_SIZE=4096\nMSAA=4\n\n[GRAPHICS]\nMIP_LOD_AUTOGEN=1\n";
        let user = "[VIDEO]\nWIDTH=2560\nHEIGHT=1440\nREFRESH=144\nFULLSCREEN=0\nSHADOW_MAP_SIZE=1024\n\n[MYTOOL]\nX=1\n";
        let merged = merge_video_ini(template, Some(user));
        // Display keys stay with the user…
        assert!(merged.contains("WIDTH=2560"), "{merged}");
        assert!(merged.contains("HEIGHT=1440"), "{merged}");
        assert!(merged.contains("REFRESH=144"), "{merged}");
        assert!(merged.contains("FULLSCREEN=0"), "{merged}");
        // …pack quality keys are applied…
        assert!(merged.contains("SHADOW_MAP_SIZE=4096"), "{merged}");
        assert!(merged.contains("MSAA=4"), "{merged}");
        // …and user-only sections survive.
        assert!(merged.contains("[MYTOOL]"), "{merged}");
    }

    #[test]
    fn merge_without_existing_user_file_is_template() {
        let merged = merge_video_ini("[VIDEO]\nWIDTH=1920\n", None);
        assert!(merged.contains("WIDTH=1920"));
    }

    #[test]
    fn settings_sources_and_collect() {
        let tmp = tempfile::tempdir().unwrap();
        let mods = tmp.path().join("mods");
        let write = |p: &Path, s: &str| {
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, s).unwrap();
        };
        write(&mods.join("settings/common/csp/general.ini"), "common");
        write(&mods.join("settings/common/csp/weather.ini"), "common-w");
        write(&mods.join("settings/ultra/csp/general.ini"), "ultra");
        write(&mods.join("settings/ultra/video.ini"), "[VIDEO]\n");
        write(&mods.join("settings/ultra/csp/notes.txt"), "not-ini");

        let sources = settings_sources(&mods, "ultra");
        assert_eq!(sources.len(), 2);
        let files = collect_csp_settings(&sources);
        assert_eq!(files.len(), 2, "txt excluded, tier overrides common: {files:?}");
        let general = files.iter().find(|(_, r)| r == "general.ini").unwrap();
        assert_eq!(fs::read_to_string(&general.0).unwrap(), "ultra");

        // Invalid tiers fall back to common only.
        assert_eq!(settings_sources(&mods, "../evil").len(), 1);
    }
}
