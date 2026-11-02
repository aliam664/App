//! Filesystem content, not catalog entries. All relative paths pass reparse confinement.
use crate::security::{atomic_write, safe_target};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};
const MAX_NODES: usize = 500_000;
#[derive(Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String, pub kind: String, pub parent: Option<String>, pub path: String,
    pub metadata: Value, pub bytes: u64, pub files: usize, pub image: Option<String>,
    pub source: String, pub warnings: Vec<String>,
}
#[derive(Serialize, Deserialize)]
pub struct Snapshot { pub items: Vec<Item>, pub bytes: u64, pub scanned_at: u64, pub warnings: Vec<String> }
pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn rel(root: &Path, path: &Path) -> Result<String,String> {
    Ok(path.strip_prefix(root).map_err(|_|"Path escaped root")?.to_string_lossy().replace('\\',"/"))
}
pub fn walk(root: &Path, relative: &str, out: &mut Vec<String>, depth: usize) -> Result<(),String> {
    if depth > 40 || out.len() >= MAX_NODES { return Err("Content scan limit exceeded".into()); }
    let dir = safe_target(root,relative)?;
    for entry in fs::read_dir(dir).map_err(|e|e.to_string())? {
        let p = entry.map_err(|e|e.to_string())?.path();
        let r = rel(root,&p)?;
        let target = safe_target(root,&r)?;
        let m = fs::symlink_metadata(target).map_err(|e|e.to_string())?;
        if m.is_dir() { walk(root,&r,out,depth+1)?; }
        else if m.is_file() { out.push(r); if out.len()>MAX_NODES { return Err("Content scan limit exceeded".into()); } }
        else { return Err("Unsupported content file type".into()); }
    }
    Ok(())
}
fn children(root: &Path, path: &str, warnings: &mut Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    let dir = match safe_target(root,path) { Ok(p) => p, Err(e)=>{warnings.push(e);return result;} };
    if !dir.exists() { return result; }
    match fs::read_dir(dir) {
        Ok(entries) => for entry in entries {
            match entry.map_err(|e|e.to_string()).and_then(|e|rel(root,&e.path())) {
                Ok(r) => match safe_target(root,&r) {
                    Ok(p) if p.is_dir() => result.push(r), Ok(_) => {}, Err(e) => warnings.push(format!("{r}: {e}")),
                }, Err(e)=>warnings.push(e),
            }
        }, Err(e)=>warnings.push(e.to_string()),
    }
    result.sort(); result
}
fn metadata(root: &Path,path: &str) -> (Value, bool) {
    let result: Result<Value,String> = (|| {
        let p = safe_target(root,path)?;
        if fs::metadata(&p).map_err(|e|e.to_string())?.len()>1_000_000 { return Err("Metadata too large".into()); }
        let data = fs::read(p).map_err(|e|e.to_string())?;
        let value: Value = serde_json::from_slice(data.strip_prefix(&[239,187,191]).unwrap_or(&data)).map_err(|e|e.to_string())?;
        if !value.is_object() { return Err("Invalid metadata".into()); }
        // Copy known textual metadata only. No scripts/HTML interpretation or inferred values.
        let mut safe = serde_json::Map::new();
        for key in ["name","skinname","brand","author","country","description","version","drivername","team","number","tags","length","width","pitboxes"] {
            if let Some(v)=value.get(key) {
                if v.is_string() || (key=="tags" && v.is_array()) || v.is_number() { safe.insert(key.into(),v.clone()); }
            }
        }
        Ok(Value::Object(safe))
    })();
    match result { Ok(v)=>(v,false), Err(_)=>(json!({}),true) }
}
fn item(root: &Path, path: &str, kind: &str, parent: Option<String>, meta: &str, images: &[String], registry: &crate::installer::Library) -> Item {
    let mut warnings=Vec::new(); let mut files=Vec::new();
    if let Err(e)=walk(root,path,&mut files,0) { warnings.push(e); }
    let mut bytes=0u64;
    for f in &files {
        match safe_target(root,f).and_then(|p|fs::metadata(p).map_err(|e|e.to_string())) {
            Ok(m)=>bytes=bytes.saturating_add(m.len()), Err(e)=>warnings.push(e),
        }
    }
    let (metadata,invalid)=metadata(root,meta);
    if invalid { warnings.push("Metadata missing or unreadable".into()); }
    let owned=files.iter().filter(|f|registry.values().any(|p|p.files.iter().any(|r|r.eq_ignore_ascii_case(f)))).count();
    let source=if owned==0 {"external"} else if owned==files.len() {"launcher"} else {"mixed"};
    let image=images.iter().find(|r|safe_target(root,r).map(|p|p.is_file()).unwrap_or(false)).cloned();
    Item {id:format!("{kind}:{path}"), kind:kind.into(), parent, path:path.into(), metadata,bytes,files:files.len(),image,source:source.into(),warnings}
}
pub fn scan(root: &Path, cache: &Path, force: bool) -> Result<Snapshot,String> {
    // Cache is per canonical root, bounded by TTL; explicit rescan bypasses it.
    use sha2::{Digest,Sha256};
    let key=format!("{:x}",Sha256::digest(root.to_string_lossy().as_bytes()));
    fs::create_dir_all(cache).map_err(|e|e.to_string())?;
    let cached=cache.join(format!("library-{key}.json"));
    if !force { if let Ok(data)=fs::read(&cached) { if let Ok(s)=serde_json::from_slice::<Snapshot>(&data) { if now().saturating_sub(s.scanned_at)<60 { return Ok(s); } } } }
    let _lock=crate::installer::content_lock(root)?;
    let registry=crate::installer::library(root)?;
    let mut items=Vec::new(); let mut warnings=Vec::new();
    for path in children(root,"content/cars",&mut warnings) {
        let car=item(root,&path,"car",None,&format!("{path}/ui/ui_car.json"),&[format!("{path}/ui/badge.png")],&registry);
        let parent=car.id.clone(); items.push(car);
        for skin in children(root,&format!("{path}/skins"),&mut warnings) {
            items.push(item(root,&skin,"skin",Some(parent.clone()),&format!("{skin}/ui_skin.json"),&[format!("{skin}/preview.jpg"),format!("{skin}/preview.png")],&registry));
        }
    }
    for path in children(root,"content/tracks",&mut warnings) {
        let track=item(root,&path,"track",None,&format!("{path}/ui/ui_track.json"),&[format!("{path}/ui/preview.png")],&registry);
        let parent=track.id.clone(); items.push(track);
        for layout in children(root,&format!("{path}/ui"),&mut warnings) {
            if !safe_target(root,&format!("{layout}/ui_track.json"))?.is_file() {continue;}
            items.push(item(root,&layout,"layout",Some(parent.clone()),&format!("{layout}/ui_track.json"),&[format!("{layout}/preview.png")],&registry));
        }
    }
    let bytes=items.iter().filter(|i|i.parent.is_none()).map(|i|i.bytes).sum();
    let snapshot=Snapshot{items,bytes,scanned_at:now(),warnings};
    atomic_write(&cached,&serde_json::to_vec(&snapshot).map_err(|e|e.to_string())?)?;
    Ok(snapshot)
}
pub fn image(root: &Path, relative: &str) -> Result<String,String> {
    use base64::{engine::general_purpose::STANDARD,Engine};
    if !(relative.starts_with("content/cars/") || relative.starts_with("content/tracks/")) {return Err("Image outside content".into());}
    let p=safe_target(root,relative)?;
    if fs::metadata(&p).map_err(|e|e.to_string())?.len()>4_000_000 {return Err("Thumbnail exceeds 4 MB".into());}
    let bytes=fs::read(p).map_err(|e|e.to_string())?;
    let mime=if bytes.starts_with(&[137,80,78,71,13,10,26,10]) {"image/png"} else if bytes.starts_with(&[255,216,255]) {"image/jpeg"} else {return Err("Unsupported thumbnail format".into());};
    Ok(format!("data:{mime};base64,{}",STANDARD.encode(bytes)))
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn scans_external_and_counts_children_once() {
    let d=tempfile::tempdir().unwrap();let c=tempfile::tempdir().unwrap();
    fs::create_dir_all(d.path().join("content/cars/test/ui")).unwrap();
    fs::create_dir_all(d.path().join("content/cars/test/skins/red")).unwrap();
    fs::write(d.path().join("content/cars/test/ui/ui_car.json"),br#"{"name":"Real car","brand":"Real brand"}"#).unwrap();
    fs::write(d.path().join("content/cars/test/skins/red/ui_skin.json"),br#"{"skinname":"Red"}"#).unwrap();
    let s=scan(d.path(),c.path(),true).unwrap();assert_eq!(s.items.len(),2);assert_eq!(s.items[0].source,"external");
    assert_eq!(s.bytes,s.items[0].bytes);assert!(s.items[1].bytes>0);
    assert_eq!(s.items[0].metadata["name"],"Real car");
    fs::write(d.path().join("content/cars/test/new.kn5"),b"new").unwrap();
    assert_eq!(scan(d.path(),c.path(),false).unwrap().bytes,s.bytes);
    assert_eq!(scan(d.path(),c.path(),true).unwrap().bytes,s.bytes+3);
 }
 #[test] fn rejects_non_images_and_outside_paths() {let d=tempfile::tempdir().unwrap(); assert!(image(d.path(),"../x.jpg").is_err());assert!(image(d.path(),"acs.exe").is_err());}
 #[cfg(unix)] #[test] fn rejects_symlink_content() {
    let d=tempfile::tempdir().unwrap(); fs::create_dir_all(d.path().join("content/cars")).unwrap();
    std::os::unix::fs::symlink("/tmp",d.path().join("content/cars/escape")).unwrap();
    let c=tempfile::tempdir().unwrap();let s=scan(d.path(),c.path(),true).unwrap();assert!(!s.warnings.is_empty()); assert!(s.items.is_empty());
 }
}
