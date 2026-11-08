//! Versioned, per-file claims. Legacy 0.1.2 installs keep their path-only claims;
//! unknown hashes are never treated as permission to overwrite or delete a file.
use crate::installer::{Installed, Library};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Serialize, Deserialize)]
pub struct Revision {
    pub version: String,
    pub sha256: String,
    pub transaction_id: String,
    pub installed_at: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct FileRecord {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub version: String,
    pub transaction_id: String,
    pub installed_at: String,
    #[serde(default)]
    pub previous: Vec<Revision>,
}
#[derive(Clone)]
pub struct Operation {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}
pub struct Claim {
    pub package_id: String,
    pub version: String,
    pub sha256: Option<String>,
}
pub struct Removed {
    pub path: String,
    pub sha256: String,
}
pub struct Plan {
    pub installed: Installed,
    pub removed: Vec<Removed>,
}
pub fn compare_versions(a: &str, b: &str) -> Result<std::cmp::Ordering, String> {
    fn parts(value: &str) -> Result<Vec<u64>, String> {
        let parts: Vec<_> = value.split('.').collect();
        if parts.len() != 3 { return Err("Invalid package version".into()); }
        parts.iter().map(|p| {
            if p.is_empty() || p.len() > 9 || !p.bytes().all(|b| b.is_ascii_digit()) {
                Err("Invalid package version".into())
            } else { p.parse::<u64>().map_err(|_| "Invalid package version".into()) }
        }).collect()
    }
    Ok(parts(a)?.cmp(&parts(b)?))
}
pub fn claims(library: &Library, path: &str, excluding: &str) -> Vec<Claim> {
    library
        .iter()
        .filter(|(id, _)| id.as_str() != excluding)
        .filter_map(|(id, installed)| {
            let record = installed.records.get(&path.to_lowercase());
            if record.is_none()
                && !installed.files.iter().any(|p| p.eq_ignore_ascii_case(path))
            {
                return None;
            }
            Some(Claim {
                package_id: id.clone(),
                version: record.as_ref().map_or(installed.version.clone(), |r| r.version.clone()),
                sha256: record.map(|r| r.sha256.clone()),
            })
        })
        .collect()
}
pub fn check_shared(library: &Library, package_id: &str, operations: &[Operation]) -> Result<(), String> {
    for op in operations {
        for claim in claims(library, &op.path, package_id) {
            if claim.sha256.as_deref() != Some(op.sha256.as_str()) {
                return Err(format!(
                    "PACKAGE_FILE_CONFLICT: {} is owned by {} ({}); different or unverified bytes",
                    op.path, claim.package_id, claim.version
                ));
            }
        }
    }
    Ok(())
}
/// Current hashes are supplied by the caller while the content lock is held.
/// Obsolete files are deleted only when their bytes still match the last install.
pub fn plan_update(
    library: &Library,
    package_id: &str,
    version: &str,
    transaction_id: &str,
    installed_at: &str,
    operations: &[Operation],
    current: &BTreeMap<String, String>,
) -> Result<Plan, String> {
    check_shared(library, package_id, operations)?;
    let old = library.get(package_id);
    let mut records = BTreeMap::new();
    let mut paths = HashSet::new();
    for op in operations {
        let key = op.path.to_lowercase();
        if !paths.insert(key.clone()) {
            return Err("Duplicate ownership target".into());
        }
        let previous = old.and_then(|p| p.records.get(&key));
        let mut history = previous.map(|r| r.previous.clone()).unwrap_or_default();
        if let Some(r) = previous.filter(|r| r.sha256 != op.sha256) {
            history.push(Revision {
                version: r.version.clone(),
                sha256: r.sha256.clone(),
                transaction_id: r.transaction_id.clone(),
                installed_at: r.installed_at.clone(),
            });
        }
        records.insert(key, FileRecord {
            path: op.path.clone(), sha256: op.sha256.clone(), bytes: op.bytes,
            version: version.into(), transaction_id: transaction_id.into(),
            installed_at: installed_at.into(), previous: history.split_off(history.len().saturating_sub(8)),
        });
    }
    let mut removed = Vec::new();
    let mut retained = Vec::new();
    if let Some(old) = old {
        for path in &old.files {
            let key = path.to_lowercase();
            if paths.contains(&key) { continue; }
            if !claims(library, path, package_id).is_empty() { continue; }
            match old.records.get(&key).and_then(|record| {
                current.get(&key).filter(|hash| *hash == &record.sha256).map(|hash| (record, hash))
            }) {
                Some((_record, hash)) => removed.push(Removed { path: path.clone(), sha256: hash.clone() }),
                None if !current.contains_key(&key) => {}
                None => {
                    retained.push(path.clone());
                    if let Some(record) = old.records.get(&key) { records.insert(key, record.clone()); }
                }
            }
        }
    }
    // A legacy path without a hash remains an explicit, conservative claim.
    let mut files: Vec<_> = records.values().map(|r| r.path.clone()).collect();
    files.extend(retained.iter().filter(|p| !records.contains_key(&p.to_lowercase())).cloned());
    files.sort_by_key(|p| p.to_lowercase());
    Ok(Plan {
        installed: Installed {
            version: version.into(), installed_at: installed_at.into(), files,
            transaction_id: transaction_id.into(), records,
        },
        removed,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn operation(path: &str, hash: &str) -> Operation {
        Operation { path: path.into(), sha256: hash.into(), bytes: 10 }
    }
    fn install(library: &mut Library, id: &str, version: &str, ops: &[Operation], current: &BTreeMap<String, String>) -> Plan {
        let plan = plan_update(library, id, version, &uuid::Uuid::new_v4().to_string(), "100", ops, current).unwrap();
        library.insert(id.into(), plan.installed.clone());
        plan
    }
    #[test]
    fn identical_shared_files_have_independent_claims_and_hashes() {
        let mut library = Library::new();
        let op = operation("content/shared.ini", "a");
        install(&mut library, "a", "1.0.0", std::slice::from_ref(&op), &BTreeMap::new());
        install(&mut library, "b", "1.0.0", std::slice::from_ref(&op), &BTreeMap::new());
        assert_eq!(claims(&library, &op.path, "a").len(), 1);
        let changed = operation(&op.path, "b");
        assert!(check_shared(&library, "a", &[changed]).is_err());
        let current = BTreeMap::from([(op.path.clone(), "a".to_string())]);
        let plan = install(&mut library, "a", "2.0.0", &[], &current);
        assert!(plan.removed.is_empty());
        assert_eq!(claims(&library, &op.path, "a").len(), 1);
        install(&mut library, "b", "2.0.0", &[], &current);
        assert!(claims(&library, &op.path, "").is_empty());
    }
    #[test]
    fn updates_remove_only_unmodified_exclusive_obsolete_files() {
        let mut library = Library::new();
        let old = operation("content/old.ini", "old");
        let edited = operation("content/edited.ini", "installed");
        install(&mut library, "a", "1.0.0", &[old.clone(), edited.clone()], &BTreeMap::new());
        let current = BTreeMap::from([(old.path.clone(), "old".into()), (edited.path.clone(), "user edit".into())]);
        let plan = install(&mut library, "a", "2.0.0", &[operation("content/new.ini", "new")], &current);
        assert_eq!(plan.removed.len(), 1);
        assert!(plan.installed.files.contains(&edited.path));
        assert_eq!(library["a"].records[&edited.path].sha256, "installed");
    }
    #[test]
    fn legacy_path_claims_fail_closed_without_inventing_a_hash() {
        let mut library = Library::new();
        library.insert("legacy".into(), Installed {
            version: "1.0.0".into(), installed_at: "0".into(), files: vec!["content/shared.ini".into()],
            transaction_id: "legacy-tx".into(), records: BTreeMap::new(),
        });
        assert!(claims(&library, "CONTENT/SHARED.INI", "new")[0].sha256.is_none());
        assert!(check_shared(&library, "new", &[operation("content/shared.ini", "a")]).is_err());
    }
    #[test]
    fn serde_reads_012_installs_without_records() {
        let old: Installed = serde_json::from_str(r#"{"version":"1.0.0","installed_at":"0","files":["content/a"],"transaction_id":"tx"}"#).unwrap();
        assert!(old.records.is_empty());
        assert_eq!(old.files, vec!["content/a"]);
    }
}
