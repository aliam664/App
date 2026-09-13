//! Archive access — ZIP (pure Rust) and RAR (statically linked unrar).
//!
//! Provides the three primitives the installer core needs:
//!   * list entries (path / is_dir / size)
//!   * read a handful of small files into memory (metadata + previews)
//!   * extract everything to a staging directory
//!
//! RAR errors are classified into a small [`RarErrorKind`] enum so callers
//! can map them to UX decisions (ask for password / wrong password / damaged).

use crate::util::{is_within, norm_rel};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Entry {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RarErrorKind {
    MissingPassword,
    BadPassword,
    BadData,
    Other,
}

#[derive(Debug)]
pub enum ArchiveError {
    Io(std::io::Error),
    Zip(String),
    Rar { kind: RarErrorKind, message: String },
}

impl std::fmt::Display for ArchiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArchiveError::Io(e) => write!(f, "io: {e}"),
            ArchiveError::Zip(m) => write!(f, "zip: {m}"),
            ArchiveError::Rar { message, .. } => write!(f, "rar: {message}"),
        }
    }
}

impl From<std::io::Error> for ArchiveError {
    fn from(e: std::io::Error) -> Self {
        ArchiveError::Io(e)
    }
}

impl From<zip::result::ZipError> for ArchiveError {
    fn from(e: zip::result::ZipError) -> Self {
        ArchiveError::Zip(e.to_string())
    }
}

impl From<unrar::error::UnrarError> for ArchiveError {
    fn from(e: unrar::error::UnrarError) -> Self {
        use unrar::error::Code;
        let kind = match e.code {
            Code::MissingPassword => RarErrorKind::MissingPassword,
            Code::BadPassword => RarErrorKind::BadPassword,
            Code::BadData => RarErrorKind::BadData,
            _ => RarErrorKind::Other,
        };
        ArchiveError::Rar { kind, message: e.to_string() }
    }
}

impl ArchiveError {
    pub fn rar_kind(&self) -> RarErrorKind {
        match self {
            ArchiveError::Rar { kind, .. } => *kind,
            _ => RarErrorKind::Other,
        }
    }
}

pub type Result<T> = std::result::Result<T, ArchiveError>;

/* ------------------------------------------------------------------ */
/*  ZIP                                                                */
/* ------------------------------------------------------------------ */

pub fn list_zip_entries(file: &Path) -> Result<Vec<Entry>> {
    let f = File::open(file)?;
    let mut zip = zip::ZipArchive::new(f)?;
    let mut out = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let e = zip.by_index_raw(i)?;
        let is_dir = e.is_dir();
        out.push(Entry {
            path: norm_rel(e.name()),
            is_dir,
            size: if is_dir { 0 } else { e.size() },
        });
    }
    Ok(out)
}

/// Read one file from a ZIP by its normalised relative path.
pub fn read_zip_file(file: &Path, rel: &str) -> Option<Vec<u8>> {
    let want = norm_rel(rel);
    let f = File::open(file).ok()?;
    let mut zip = zip::ZipArchive::new(f).ok()?;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i).ok()?;
        if e.is_dir() || norm_rel(e.name()) != want {
            continue;
        }
        let mut buf = Vec::with_capacity(e.size() as usize);
        e.read_to_end(&mut buf).ok()?;
        return Some(buf);
    }
    None
}

/// Extract a whole ZIP into `dest`, refusing entries that escape it.
pub fn extract_zip_to(file: &Path, dest: &Path) -> Result<()> {
    let f = File::open(file)?;
    let mut zip = zip::ZipArchive::new(f)?;
    fs::create_dir_all(dest)?;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i)?;
        let Some(enclosed) = e.enclosed_name() else { continue };
        let out = dest.join(enclosed);
        if !is_within(dest, &out) {
            continue;
        }
        if e.is_dir() {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut w = File::create(&out)?;
        std::io::copy(&mut e, &mut w)?;
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/*  RAR                                                                */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone)]
pub struct EncryptedFile {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct RarProbe {
    pub entries: Vec<Entry>,
    pub encrypted: bool,
    pub header_encrypted: bool,
    pub encrypted_files: Vec<EncryptedFile>,
}

fn rar_archive<'a>(file: &'a Path, password: Option<&'a str>) -> unrar::Archive<'a> {
    match password {
        Some(pw) if !pw.is_empty() => unrar::Archive::with_password(file, pw),
        _ => unrar::Archive::new(file),
    }
}

/// Open a RAR and read its full file list plus encryption summary.
pub fn probe_rar(file: &Path, password: Option<&str>) -> Result<RarProbe> {
    let archive = rar_archive(file, password).open_for_listing()?;
    let header_encrypted = archive.has_encrypted_headers();
    let mut entries = Vec::new();
    let mut encrypted_files = Vec::new();
    let mut encrypted = header_encrypted;
    for header in archive {
        let h = header?;
        let is_dir = h.is_directory();
        let name = norm_rel(&h.filename.to_string_lossy());
        if h.is_encrypted() {
            encrypted = true;
            if !is_dir {
                encrypted_files.push(EncryptedFile { name: name.clone(), size: h.unpacked_size });
            }
        }
        entries.push(Entry { path: name, is_dir, size: if is_dir { 0 } else { h.unpacked_size } });
    }
    Ok(RarProbe { entries, encrypted, header_encrypted, encrypted_files })
}

/// Read a set of files from a RAR into memory in a single pass (best-effort:
/// entries that fail to decrypt are skipped, never fatal).
pub fn read_rar_files(file: &Path, rels: &[String], password: Option<&str>) -> HashMap<String, Vec<u8>> {
    let mut result = HashMap::new();
    if rels.is_empty() {
        return result;
    }
    let wanted: std::collections::HashSet<String> = rels.iter().map(|r| norm_rel(r)).collect();
    let Ok(mut archive) = rar_archive(file, password).open_for_processing() else {
        return result;
    };
    loop {
        let next = match archive.read_header() {
            Ok(Some(a)) => a,
            _ => break,
        };
        let name = norm_rel(&next.entry().filename.to_string_lossy());
        let is_file = next.entry().is_file();
        if is_file && wanted.contains(&name) {
            match next.read() {
                Ok((data, rest)) => {
                    result.insert(name, data);
                    archive = rest;
                }
                Err(_) => break, // stream is unusable after a failed read
            }
        } else {
            match next.skip() {
                Ok(rest) => archive = rest,
                Err(_) => break,
            }
        }
        if result.len() == wanted.len() {
            break;
        }
    }
    result
}

/// Verify a user-supplied password by actually decrypting an encrypted entry.
/// Per-file-encrypted archives may use different passwords per entry, so we
/// accept the password when it unlocks ANY encrypted entry (smallest first).
pub fn verify_rar_password(file: &Path, encrypted_files: &[EncryptedFile], password: &str) -> bool {
    let mut candidates: Vec<&EncryptedFile> = encrypted_files.iter().filter(|f| !f.name.is_empty()).collect();
    if candidates.is_empty() {
        return true;
    }
    candidates.sort_by_key(|f| f.size);
    // The unrar handle becomes unusable after a failed decrypt, so every
    // candidate gets a fresh handle (exactly like the JS implementation).
    for candidate in candidates {
        if test_rar_entry(file, &candidate.name, password) {
            return true;
        }
    }
    false
}

/// Decrypt + CRC-check a single entry in memory. `false` on any failure.
fn test_rar_entry(file: &Path, name: &str, password: &str) -> bool {
    let Ok(mut archive) = rar_archive(file, Some(password)).open_for_processing() else {
        return false;
    };
    loop {
        let next = match archive.read_header() {
            Ok(Some(a)) => a,
            _ => return false,
        };
        let entry_name = norm_rel(&next.entry().filename.to_string_lossy());
        if next.entry().is_file() && entry_name == name {
            return next.test().is_ok();
        }
        match next.skip() {
            Ok(rest) => archive = rest,
            Err(_) => return false,
        }
    }
}

/// Extract the whole RAR into `dest`. Entries escaping `dest` are skipped.
pub fn extract_rar_to(file: &Path, dest: &Path, password: Option<&str>) -> Result<()> {
    fs::create_dir_all(dest)?;
    let mut archive = rar_archive(file, password).open_for_processing()?;
    loop {
        let next = match archive.read_header()? {
            Some(a) => a,
            None => break,
        };
        let rel = norm_rel(&next.entry().filename.to_string_lossy());
        let target: PathBuf = dest.join(&rel);
        if rel.is_empty() || rel.contains("..") || !is_within(dest, &target) {
            archive = next.skip()?;
            continue;
        }
        if next.entry().is_directory() {
            fs::create_dir_all(&target)?;
            archive = next.skip()?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        archive = next.extract_to(&target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures").join(name)
    }

    #[test]
    fn rar_plain_listing() {
        let p = probe_rar(&fixture("FolderTest.rar"), None).expect("probe");
        assert!(!p.encrypted);
        let names: Vec<&str> = p.entries.iter().map(|e| e.path.as_str()).collect();
        assert!(names.iter().any(|n| n.ends_with("long.txt")), "{names:?}");
        assert!(names.iter().any(|n| n.contains("Folder Space")), "{names:?}");
    }

    #[test]
    fn rar_header_encrypted_requires_password() {
        let err = probe_rar(&fixture("HeaderEnc1234.rar"), None).err().expect("should fail");
        assert_eq!(err.rar_kind(), RarErrorKind::MissingPassword);
        let ok = probe_rar(&fixture("HeaderEnc1234.rar"), Some("1234")).expect("with pw");
        assert!(ok.header_encrypted);
        assert_eq!(ok.entries.len(), 2);
    }

    #[test]
    fn rar_file_encrypted_detected_and_verified() {
        let p = probe_rar(&fixture("FileEncByName.rar"), None).expect("probe");
        assert!(p.encrypted && !p.header_encrypted);
        assert!(!p.encrypted_files.is_empty());
        assert!(verify_rar_password(&fixture("FileEncByName.rar"), &p.encrypted_files, "3Sec"));
        assert!(!verify_rar_password(&fixture("FileEncByName.rar"), &p.encrypted_files, "wrong-pw"));
    }

    #[test]
    fn rar_read_and_extract() {
        let files = read_rar_files(&fixture("WithComment.rar"), &["1File.txt".into()], None);
        assert!(files.contains_key("1File.txt"));
        let tmp = tempfile::tempdir().unwrap();
        extract_rar_to(&fixture("FolderTest.rar"), tmp.path(), None).expect("extract");
        assert!(tmp.path().join("Folder1").join("Folder Space").join("long.txt").exists());
    }
}
