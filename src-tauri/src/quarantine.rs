//! Recoverable file-level deletion with on-disk intent before each rename.
use crate::security::{atomic_write, safe_target, sha256_file};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
struct File {
    path: String,
    sha256: String,
    bytes: u64,
    external: bool,
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    id: String,
    created_at: u64,
    state: String,
    #[serde(default)]
    scope: String,
    files: Vec<File>,
}
fn allowed(path: &str) -> bool {
    let p: Vec<_> = path.split('/').collect();
    p.len() >= 4 && p[0] == "content" && ["cars", "tracks"].contains(&p[1]) && !p[2].is_empty()
}
fn scope_allowed(path: &str) -> bool {
    let p: Vec<_> = path.split('/').collect();
    (p.len() == 3 || (p.len() == 5 && p[1] == "cars" && p[3] == "skins"))
        && p[0] == "content"
        && ["cars", "tracks"].contains(&p[1])
}
fn prune(root: &Path, scope: &str, files: &[File]) -> Result<(), String> {
    // Only ancestors of selected files: never prune unrelated pre-existing empty folders.
    let mut directories = std::collections::BTreeSet::new();
    for f in files {
        let mut parent = Path::new(&f.path).parent();
        while let Some(p) = parent {
            let relative = p.to_string_lossy().replace('\\', "/");
            if relative != scope && !relative.starts_with(&format!("{scope}/")) {
                break;
            }
            directories.insert(relative);
            parent = p.parent();
        }
    }
    let mut directories: Vec<_> = directories.into_iter().collect();
    directories.sort_by_key(|p| std::cmp::Reverse(p.len()));
    for relative in directories {
        let _ = fs::remove_dir(safe_target(root, &relative)?);
    }
    Ok(())
}
fn restore_no_replace(source: &Path, target: &Path) -> Result<(), String> {
    // Unlike rename, hard_link/create_new cannot replace a concurrently created file.
    if fs::hard_link(source, target).is_ok() {
        return fs::remove_file(source).map_err(|e| e.to_string());
    }
    let mut output = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)
        .map_err(|e| e.to_string())?;
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        Ok(())
    })();
    drop(output);
    if let Err(e) = result {
        let _ = fs::remove_file(target);
        return Err(e);
    }
    if sha256_file(source)? != sha256_file(target)? {
        return Err("Restored file verification failed; quarantine retained".into());
    }
    fs::remove_file(source).map_err(|e| e.to_string())
}
fn directory(root: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid recovery identifier")?;
    let control = crate::installer::control_dir(root)?;
    safe_target(&control, &format!("quarantine/{id}"))
}
fn save(dir: &Path, m: &Manifest) -> Result<(), String> {
    atomic_write(
        &dir.join("manifest.json"),
        &serde_json::to_vec(m).map_err(|e| e.to_string())?,
    )
}
fn load(dir: &Path) -> Result<Manifest, String> {
    let p = safe_target(dir, "manifest.json")?;
    if fs::metadata(&p).map_err(|e| e.to_string())?.len() > 16_000_000 {
        return Err("Recovery manifest too large".into());
    }
    let m: Manifest = serde_json::from_slice(&fs::read(p).map_err(|e| e.to_string())?)
        .map_err(|_| "Recovery manifest is damaged")?;
    if (!m.scope.is_empty() && !scope_allowed(&m.scope))
        || m.files.len() > 20_000
        || m.files.iter().any(|f| {
            !allowed(&f.path)
                || (!m.scope.is_empty() && !f.path.starts_with(&format!("{}/", m.scope)))
        })
    {
        return Err("Unsafe recovery manifest".into());
    }
    Ok(m)
}
pub fn preview(root: &Path, path: &str) -> Result<Value, String> {
    let _lifecycle = crate::lifecycle::operation()?;
    let _lock = crate::installer::content_lock(root)?;
    let parts: Vec<_> = path.split('/').collect();
    let valid = parts.len() == 3 || (parts.len() == 5 && parts[1] == "cars" && parts[3] == "skins");
    if !valid
        || !["content/cars/", "content/tracks/"]
            .iter()
            .any(|p| path.starts_with(p))
    {
        return Err("Select a car, track or skin directory".into());
    }
    safe_target(root, path)?;
    let registry: std::collections::HashSet<String> = crate::installer::library(root)?
        .values()
        .flat_map(|p| p.files.iter().map(|f| f.to_lowercase()))
        .collect();
    let mut paths = Vec::new();
    crate::content::walk(root, path, &mut paths, 0)?;
    if paths.len() > 20_000 {
        return Err("More than 20,000 files; split this operation".into());
    }
    let mut files = Vec::new();
    for path in paths {
        let p = safe_target(root, &path)?;
        files.push(File {
            external: !registry.contains(&path.to_lowercase()),
            sha256: sha256_file(&p)?,
            bytes: fs::metadata(p).map_err(|e| e.to_string())?.len(),
            path,
        });
    }
    let m = Manifest {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: crate::content::now(),
        state: "preview".into(),
        scope: path.into(),
        files,
    };
    let dir = directory(root, &m.id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    save(&dir, &m)?;
    serde_json::to_value(m).map_err(|e| e.to_string())
}
pub fn apply(
    root: &Path,
    id: &str,
    selected: &[String],
    acknowledge_external: bool,
) -> Result<Value, String> {
    let _lifecycle = crate::lifecycle::operation()?;
    let _lock = crate::installer::content_lock(root)?;
    let dir = directory(root, id)?;
    let mut m = load(&dir)?;
    if m.state != "preview" || crate::content::now().saturating_sub(m.created_at) > 900 {
        return Err("Preview expired; scan again".into());
    }
    let wanted: std::collections::HashSet<_> = selected.iter().collect();
    if wanted.is_empty()
        || wanted.len() != selected.len()
        || selected
            .iter()
            .any(|p| !m.files.iter().any(|f| &f.path == p))
    {
        return Err("Invalid file selection".into());
    }
    m.files.retain(|f| wanted.contains(&f.path));
    for f in &m.files {
        if f.external && !acknowledge_external {
            return Err("External content requires explicit acknowledgement".into());
        }
        if sha256_file(&safe_target(root, &f.path)?)? != f.sha256 {
            return Err("Content changed after preview; scan again".into());
        }
    }
    m.state = "moving".into();
    save(&dir, &m)?;
    let storage = safe_target(&dir, "files")?;
    fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
    for (i, f) in m.files.iter().enumerate() {
        let target = safe_target(root, &f.path)?;
        // Revalidate immediately before mutation. Partial moves remain recoverable via manifest.
        if sha256_file(&target)? != f.sha256 {
            return Err("Content changed; restore partially moved files before retrying".into());
        }
        fs::rename(target, safe_target(&storage, &i.to_string())?).map_err(|e| e.to_string())?;
    }
    if !m.scope.is_empty() {
        prune(root, &m.scope, &m.files)?;
    }
    m.state = "quarantined".into();
    save(&dir, &m)?;
    Ok(json!({"id":id,"files":m.files.len()}))
}
pub fn list(root: &Path) -> Result<Value, String> {
    let control = crate::installer::control_dir(root)?;
    let parent = safe_target(&control, "quarantine")?;
    let mut rows = Vec::new();
    if !parent.exists() {
        return Ok(json!(rows));
    }
    for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
        let e = entry.map_err(|e| e.to_string())?;
        let id = e.file_name().to_string_lossy().into_owned();
        let dir = directory(root, &id)?;
        let m = load(&dir)?;
        if ["moving", "quarantined", "restoring"].contains(&m.state.as_str()) {
            rows.push(
                json!({"id":m.id,"state":m.state,"created_at":m.created_at,"files":m.files.len()}),
            );
        }
    }
    Ok(json!(rows))
}
pub fn restore(root: &Path, id: &str) -> Result<Value, String> {
    let _lifecycle = crate::lifecycle::operation()?;
    let _lock = crate::installer::content_lock(root)?;
    let dir = directory(root, id)?;
    let mut m = load(&dir)?;
    if !["moving", "quarantined", "restoring"].contains(&m.state.as_str()) {
        return Err("Nothing to restore".into());
    }
    // Preflight every conflict before touching anything; never overwrite externally recreated files.
    for (i, f) in m.files.iter().enumerate() {
        let source = safe_target(&dir, &format!("files/{i}"))?;
        let target = safe_target(root, &f.path)?;
        if source.exists() {
            if target.exists()
                && !(m.state == "restoring"
                    && target.is_file()
                    && sha256_file(&source)? == f.sha256
                    && sha256_file(&target)? == f.sha256)
            {
                return Err(format!("Restore conflict: {}", f.path));
            }
            if sha256_file(&source)? != f.sha256 {
                return Err("Quarantined file checksum mismatch".into());
            }
        } else if !target.is_file() || sha256_file(&target)? != f.sha256 {
            return Err("Recovery file is missing or changed".into());
        }
    }
    m.state = "restoring".into();
    save(&dir, &m)?;
    for (i, f) in m.files.iter().enumerate() {
        let source = safe_target(&dir, &format!("files/{i}"))?;
        if source.exists() {
            let target = safe_target(root, &f.path)?;
            if target.exists() {
                if target.is_file()
                    && sha256_file(&source)? == f.sha256
                    && sha256_file(&target)? == f.sha256
                {
                    fs::remove_file(source).map_err(|e| e.to_string())?;
                    continue;
                }
                return Err("Restore conflict; no overwrite allowed".into());
            }
            if let Some(p) = target.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            restore_no_replace(&source, &target)?;
        }
    }
    m.state = "restored".into();
    save(&dir, &m)?;
    Ok(json!({"restored":m.files.len()}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_acknowledgement_and_safe_recovery() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("content/cars/test")).unwrap();
        fs::write(d.path().join("content/cars/test/a.kn5"), b"original").unwrap();
        let p = preview(d.path(), "content/cars/test").unwrap();
        let id = p["id"].as_str().unwrap();
        let selected = vec!["content/cars/test/a.kn5".into()];
        assert!(apply(d.path(), id, &selected, false).is_err());
        apply(d.path(), id, &selected, true).unwrap();
        assert!(!d.path().join(&selected[0]).exists());
        assert!(!d.path().join("content/cars/test").exists());
        fs::create_dir_all(d.path().join("content/cars/test")).unwrap();
        fs::write(d.path().join(&selected[0]), b"new").unwrap();
        assert!(restore(d.path(), id).is_err());
        fs::remove_file(d.path().join(&selected[0])).unwrap();
        restore(d.path(), id).unwrap();
        assert_eq!(fs::read(d.path().join(&selected[0])).unwrap(), b"original");
    }
    #[test]
    fn mutation_after_preview_is_blocked() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("content/tracks/test")).unwrap();
        let p = d.path().join("content/tracks/test/a.kn5");
        fs::write(&p, b"old").unwrap();
        let m = preview(d.path(), "content/tracks/test").unwrap();
        fs::write(&p, b"new").unwrap();
        assert!(apply(
            d.path(),
            m["id"].as_str().unwrap(),
            &["content/tracks/test/a.kn5".into()],
            true
        )
        .is_err());
    }
}
