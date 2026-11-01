use std::{collections::{BTreeMap,HashSet}, fs, io::{Read,Write}, net::{IpAddr,ToSocketAddrs}, path::{Path,PathBuf}, process::{Command,Stdio}, time::{Duration,Instant,SystemTime,UNIX_EPOCH}};
use serde::{Serialize,Deserialize};
use serde_json::{json,Value};
use fs2::FileExt;
use sha2::{Digest,Sha256};
use tauri::{AppHandle,Emitter,Manager};
use crate::security::{safe_target,relative_path,atomic_write,sha256_file};
const MAX_EXPANDED:u64=20_000_000_000;
const MAX_FILES:usize=20_000;
#[derive(Clone,Deserialize)] pub struct Artifact {pub id:String,pub name:String,pub url:String,pub sha256:String,pub size:u64,pub format:String}
#[derive(Clone,Deserialize)] pub struct Step {pub file_id:String,pub action:String,pub destination:String,pub overwrite:String}
#[derive(Clone,Deserialize)] pub struct Package {pub id:String,pub name:String,pub version:String,pub files:Vec<Artifact>,pub steps:Vec<Step>}
#[derive(Clone,Serialize,Deserialize)] pub struct Installed {pub version:String,pub installed_at:String,pub files:Vec<String>,#[serde(default)]pub transaction_id:String}
pub type Library=BTreeMap<String,Installed>;
#[derive(Clone,Serialize,Deserialize)] struct Entry {target:String,backup:String,existed:bool,ready:bool}
#[derive(Serialize,Deserialize)] struct Journal {package_id:String,state:String,entries:Vec<Entry>}
fn progress(app:&AppHandle,pkg:&str,phase:&str,percent:f64,bytes:u64,total:u64){let _=app.emit("install-progress",json!({"package_id":pkg,"phase":phase,"progress":percent.clamp(0.0,99.0),"bytes":bytes,"total":total}));}
fn regular_control(root:&Path)->Result<PathBuf,String>{
    let dir=root.join(".uhm");
    if dir.exists(){let m=fs::symlink_metadata(&dir).map_err(|e|e.to_string())?;if !m.is_dir()||m.file_type().is_symlink(){return Err("Unsafe installer state directory".into());}
      #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if m.file_attributes()&0x400!=0{return Err("Reparse state directory".into());}}
    }
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Ok(dir)
}
pub fn library(root:&Path)->Result<Library,String>{
    let path=safe_target(&regular_control(root)?,"installed.json")?;
    if !path.exists(){return Ok(BTreeMap::new());}
    serde_json::from_slice(&fs::read(path).map_err(|e|e.to_string())?).map_err(|_|"Installed state is damaged; repair is required".into())
}
fn save_journal(dir:&Path,journal:&Journal)->Result<(),String>{atomic_write(&dir.join("journal.json"),&serde_json::to_vec(journal).map_err(|e|e.to_string())?)}
fn rollback(root:&Path,dir:&Path,journal:&Journal)->Result<(),String>{
    for entry in journal.entries.iter().rev().filter(|e|e.ready){
        let target=safe_target(root,&entry.target)?;
        if entry.existed {
            if !entry.backup.starts_with("backups/"){return Err("Invalid recovery backup path".into());}
            let backup=safe_target(dir,&entry.backup)?;
            if !backup.is_file(){return Err("Recovery backup is missing; manual repair required".into());}
            if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            fs::copy(backup,&target).map_err(|e|e.to_string())?;
        }else if target.exists(){fs::remove_file(target).map_err(|e|e.to_string())?;}
    }Ok(())
}
fn recover_locked(root:&Path,control:&Path)->Result<usize,String>{
    let transactions=safe_target(control,"transactions")?;if !transactions.exists(){return Ok(0);}
    let mut count=0;
    for item in fs::read_dir(transactions).map_err(|e|e.to_string())?{
        let dir=item.map_err(|e|e.to_string())?.path();if !dir.is_dir(){continue;}
        let name=dir.file_name().ok_or("Invalid recovery directory")?.to_string_lossy();
        uuid::Uuid::parse_str(&name).map_err(|_|"Unknown recovery directory")?;safe_target(control,&format!("transactions/{name}"))?;
        let file=dir.join("journal.json");if !file.exists(){continue;}
        let mut j:Journal=serde_json::from_slice(&fs::read(file).map_err(|e|e.to_string())?).map_err(|_|"Recovery journal is damaged; do not continue installation")?;
        if j.state=="committing" {
            let committed=library(root)?.get(&j.package_id).map(|p|p.transaction_id==name).unwrap_or(false);
            if committed {j.state="committed".into();save_journal(&dir,&j)?;continue;}
        }
        if j.state=="applying" || j.state=="committing" {rollback(root,&dir,&j)?;j.state="rolled_back".into();save_journal(&dir,&j)?;count+=1;}
    }Ok(count)
}
pub fn recover(root:&Path)->Result<usize,String>{
    let control=regular_control(root)?;let lock=fs::OpenOptions::new().create(true).read(true).write(true).open(control.join("install.lock")).map_err(|e|e.to_string())?;
    lock.try_lock_exclusive().map_err(|_|"Another installation is running")?;
    recover_locked(root,&control)
}
fn public_ip(ip:IpAddr)->bool{match ip {
    IpAddr::V4(v)=>{let a=v.octets();!v.is_private()&&!v.is_loopback()&&!v.is_link_local()&&!v.is_multicast()&&!v.is_unspecified()&&a[0]!=0&&a[0]<224&&!(a[0]==100&&(64..=127).contains(&a[1]))},
    IpAddr::V6(_)=>false, // Fail closed for IPv6 until mapped/local address cases are exhaustively tested.
}}
fn download(app:&AppHandle,pkg:&str,file:&Artifact,out:&Path,completed:u64,total:u64)->Result<(),String>{
    if file.size==0||file.size>MAX_EXPANDED||file.sha256.len()!=64||!file.sha256.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Invalid artifact size or SHA-256".into());}
    let mut url=url::Url::parse(&file.url).map_err(|_|"Invalid download URL")?;
    let mut response=None;
    for _ in 0..6 {
        if url.scheme()!="https"||!url.username().is_empty()||url.password().is_some(){return Err("Only public HTTPS downloads are allowed".into());}
        let host=url.host_str().ok_or("Missing download host")?;
        let port=url.port_or_known_default().ok_or("Invalid port")?;
        if port!=443{return Err("Only HTTPS port 443 is allowed".into());}
        let addresses:Vec<_>=(host,port).to_socket_addrs().map_err(|_|"Download DNS failed")?.collect();
        if addresses.is_empty()||addresses.iter().any(|a|!public_ip(a.ip())){return Err("Private or unsupported download address blocked".into());}
        let client=reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(1800)).connect_timeout(Duration::from_secs(20)).resolve_to_addrs(host,&addresses).build().map_err(|e|e.to_string())?;
        let r=client.get(url.clone()).header("User-Agent","UHM-Launcher/0.1").send().map_err(|_|"Download connection failed")?;
        if r.status().is_redirection(){let location=r.headers().get("location").ok_or("Redirect has no location")?.to_str().map_err(|_|"Invalid redirect")?;url=url.join(location).map_err(|_|"Invalid redirect URL")?;continue;}
        if !r.status().is_success(){return Err(format!("Download host returned {}",r.status()));}
        if let Some(len)=r.content_length(){if len!=file.size{return Err("Content length does not match release manifest".into());}}
        response=Some(r);break;
    }
    let mut r=response.ok_or("Too many download redirects")?;let mut output=fs::OpenOptions::new().create_new(true).write(true).open(out).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();let mut received=0;let mut buffer=[0u8;65536];let mut last=Instant::now();
    loop{let n=r.read(&mut buffer).map_err(|_|"Download interrupted")?;if n==0{break;}received+=n as u64;if received>file.size{return Err("Download exceeds declared size".into());}hash.update(&buffer[..n]);output.write_all(&buffer[..n]).map_err(|e|e.to_string())?;
      if last.elapsed()>Duration::from_millis(200){progress(app,pkg,"در حال دانلود و بررسی فایل",((completed+received)as f64/total.max(1)as f64)*65.0,completed+received,total);last=Instant::now();}}
    output.sync_all().map_err(|e|e.to_string())?;
    if received!=file.size||format!("{:x}",hash.finalize())!=file.sha256.to_lowercase(){return Err("SHA-256 or download size mismatch; no game files were modified".into());}Ok(())
}
fn collect_files(root:&Path,dir:&Path,out:&mut Vec<PathBuf>)->Result<(),String>{
    for entry in fs::read_dir(dir).map_err(|e|e.to_string())?{
        let path=entry.map_err(|e|e.to_string())?.path();let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
        let rel=path.strip_prefix(root).map_err(|e|e.to_string())?.to_string_lossy().replace('\\',"/");safe_target(root,&rel)?;
        if meta.is_dir(){collect_files(root,&path,out)?;}else if meta.is_file(){out.push(path);}else{return Err("Special archive entries are forbidden".into());}
        if out.len()>MAX_FILES{return Err("Too many archive entries".into());}
    }Ok(())
}
fn extract_zip(source:&Path,destination:&Path)->Result<Vec<PathBuf>,String>{
    let mut zip=zip::ZipArchive::new(fs::File::open(source).map_err(|e|e.to_string())?).map_err(|_|"Corrupt ZIP archive")?;
    if zip.len()>MAX_FILES{return Err("Archive contains too many files".into());}
    let mut expanded=0u64;let mut names=HashSet::new();
    for i in 0..zip.len(){let f=zip.by_index(i).map_err(|_|"Invalid ZIP entry")?;let raw_name=f.name().map_err(|_|"Unsupported ZIP filename encoding")?;let name=raw_name.trim_end_matches('/');relative_path(name)?;
      if !names.insert(name.to_lowercase()){return Err("Archive has case-insensitive duplicate paths".into());}
      if f.unix_mode().map(|m|m&0o170000==0o120000).unwrap_or(false){return Err("Archive symbolic links are forbidden".into());}
      expanded=expanded.checked_add(f.size()).ok_or("Archive size overflow")?;}
    if expanded>MAX_EXPANDED||expanded>fs::metadata(source).map_err(|e|e.to_string())?.len().saturating_mul(200).max(10_000_000){return Err("Archive expansion limit exceeded".into());}
    if fs2::available_space(destination).map_err(|e|e.to_string())?<expanded.saturating_mul(2)+128_000_000{return Err("Insufficient disk space for extraction and backup".into());}
    let mut out=Vec::new();
    for i in 0..zip.len(){let mut f=zip.by_index(i).map_err(|_|"Invalid ZIP entry")?;let name=f.name().map_err(|_|"Unsupported ZIP filename encoding")?.into_owned();let target=safe_target(destination,name.trim_end_matches('/'))?;
      if f.is_dir(){fs::create_dir_all(&target).map_err(|e|e.to_string())?;continue;}
      fs::create_dir_all(target.parent().ok_or("Invalid ZIP path")?).map_err(|e|e.to_string())?;
      let mut writer=fs::OpenOptions::new().create_new(true).write(true).open(&target).map_err(|e|e.to_string())?;
      let expected=f.size();let actual=std::io::copy(&mut (&mut f).take(expected+1),&mut writer).map_err(|_|"ZIP extraction or checksum failed")?;
      if actual!=expected{return Err("ZIP expanded size mismatch".into());}writer.sync_all().map_err(|e|e.to_string())?;out.push(target);}
    Ok(out)
}
fn run_extractor(exe:&Path,args:&[String],log:&Path)->Result<String,String>{
    let output=fs::OpenOptions::new().create_new(true).write(true).open(log).map_err(|e|e.to_string())?;
    let mut command=Command::new(exe);command.args(args).stdin(Stdio::null()).stdout(Stdio::from(output.try_clone().map_err(|e|e.to_string())?)).stderr(Stdio::from(output));
    #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let mut child=command.spawn().map_err(|_|"Archive extractor could not start")?;let start=Instant::now();
    loop{
      if start.elapsed()>Duration::from_secs(300)||fs::metadata(log).map(|m|m.len()>4_000_000).unwrap_or(false){let _=child.kill();let _=child.wait();return Err("Archive extractor resource limit reached".into());}
      if let Some(status)=child.try_wait().map_err(|e|e.to_string())?{if !status.success(){return Err("Archive extraction failed (corrupt, encrypted or unsupported archive)".into());}break;}
      std::thread::sleep(Duration::from_millis(100));
    }
    fs::read_to_string(log).map_err(|_|"Unsupported archive filename encoding".into())
}
fn extract_external(app:&AppHandle,source:&Path,destination:&Path)->Result<Vec<PathBuf>,String>{
    let dir=app.path().resource_dir().map_err(|e|e.to_string())?.join("resources/extractor");
    extract_external_with_tools(&dir,source,destination)
}
fn extract_external_with_tools(dir:&Path,source:&Path,destination:&Path)->Result<Vec<PathBuf>,String>{
    let exe=dir.join("7z.exe");let dll=dir.join("7z.dll");
    let exe_hash=option_env!("UHM_EXTRACTOR_EXE_SHA256").ok_or("This build has no approved RAR/7z extractor")?;
    let dll_hash=option_env!("UHM_EXTRACTOR_DLL_SHA256").ok_or("This build has no approved RAR/7z library")?;
    if sha256_file(&exe)?!=exe_hash.to_lowercase()||sha256_file(&dll)?!=dll_hash.to_lowercase(){return Err("Archive extractor integrity check failed".into());}
    let listed=run_extractor(&exe,&["l".into(),"-slt".into(),"-ba".into(),"-sccUTF-8".into(),"--".into(),source.to_string_lossy().into_owned()],&destination.join("list.log"))?;
    let mut count=0usize;let mut expanded=0u64;let mut names=HashSet::new();
    for line in listed.lines(){
      if let Some(name)=line.strip_prefix("Path = "){relative_path(name)?;count+=1;if !names.insert(name.to_lowercase()){return Err("Duplicate archive entry".into());}}
      if let Some(size)=line.strip_prefix("Size = "){expanded=expanded.checked_add(size.parse::<u64>().map_err(|_|"Invalid archive size")?).ok_or("Archive size overflow")?;}
      if line.starts_with("Symbolic Link =")||line.starts_with("Hard Link =")||line.starts_with("Reparse Point =")||line=="Encrypted = +"{return Err("Archive links and encrypted entries are forbidden".into());}
    }
    if count==0||count>MAX_FILES||expanded>MAX_EXPANDED||expanded>fs::metadata(source).map_err(|e|e.to_string())?.len().saturating_mul(200).max(10_000_000){return Err("Archive preflight limit exceeded".into());}
    if fs2::available_space(destination).map_err(|e|e.to_string())?<expanded.saturating_mul(2)+128_000_000{return Err("Insufficient extraction space".into());}
    let output=destination.join("content");fs::create_dir(&output).map_err(|e|e.to_string())?;
    run_extractor(&exe,&["x".into(),"-y".into(),"-bd".into(),"-bb0".into(),"-mmt=1".into(),format!("-o{}",output.display()),"--".into(),source.to_string_lossy().into_owned()],&destination.join("extract.log"))?;
    let mut files=Vec::new();collect_files(&output,&output,&mut files)?;
    let actual:u64=files.iter().map(|p|fs::metadata(p).map(|m|m.len()).unwrap_or(MAX_EXPANDED+1)).sum();
    if actual>MAX_EXPANDED||actual>expanded{return Err("Expanded archive exceeds preflight size".into());}Ok(files)
}
pub fn install(app:&AppHandle,root:&Path,packages:Vec<Package>)->Result<Value,String>{
    let control=regular_control(root)?;let lock=fs::OpenOptions::new().create(true).read(true).write(true).open(control.join("install.lock")).map_err(|e|e.to_string())?;
    lock.try_lock_exclusive().map_err(|_|"Another installation is already running")?;
    recover_locked(root,&control)?;let mut library=library(root)?;
    for package in packages {
        uuid::Uuid::parse_str(&package.id).map_err(|_|"Invalid package identifier")?;
        if package.files.is_empty()||package.files.len()>30||package.steps.is_empty()||package.steps.len()>100{return Err("Invalid installation manifest".into());}
        let transaction_id=uuid::Uuid::new_v4().to_string();let dir=safe_target(&control,&format!("transactions/{transaction_id}"))?;fs::create_dir_all(dir.join("downloads")).map_err(|e|e.to_string())?;fs::create_dir_all(dir.join("backups")).map_err(|e|e.to_string())?;
        let mut journal=Journal{package_id:package.id.clone(),state:"applying".into(),entries:Vec::new()};save_journal(&dir,&journal)?;
        let result=(||->Result<Vec<String>,String>{
          let total:u64=package.files.iter().map(|f|f.size).sum();let mut completed=0;
          if total>MAX_EXPANDED||fs2::available_space(root).map_err(|e|e.to_string())?<total.saturating_mul(3)+256_000_000{return Err("Insufficient disk space".into());}
          for file in &package.files{uuid::Uuid::parse_str(&file.id).map_err(|_|"Invalid artifact identifier")?;download(app,&package.id,file,&dir.join("downloads").join(&file.id),completed,total)?;completed+=file.size;}
          let mut operations:Vec<(PathBuf,String,String)>=Vec::new();let mut destinations=HashSet::new();
          for step in &package.steps{
            relative_path(&step.destination)?;
            let file=package.files.iter().find(|f|f.id==step.file_id).ok_or("Unknown artifact in install step")?;
            let downloaded=dir.join("downloads").join(&file.id);
            if step.action=="copy"{operations.push((downloaded,step.destination.clone(),step.overwrite.clone()));}
            else if step.action=="extract"{
              let destination=dir.join(format!("extract-{}",uuid::Uuid::new_v4()));fs::create_dir(&destination).map_err(|e|e.to_string())?;
              progress(app,&package.id,"استخراج در پوشه موقت",70.0,completed,total);
              let files=if file.format=="zip"{extract_zip(&downloaded,&destination)?}else if file.format=="rar"||file.format=="7z"{extract_external(app,&downloaded,&destination)?}else{return Err("Artifact format cannot be extracted".into());};
              let base=if file.format=="zip"{destination}else{destination.join("content")};
              for path in files{let rel=path.strip_prefix(&base).map_err(|e|e.to_string())?.to_string_lossy().replace('\\',"/");operations.push((path,format!("{}/{}",step.destination,rel),step.overwrite.clone()));}
            }else{return Err("Unsupported install action; executable launch is prohibited".into());}
          }
          if operations.len()>MAX_FILES{return Err("Too many installation operations".into());}
          for (_,relative,overwrite) in &operations{
            if !destinations.insert(relative.to_lowercase()){return Err("Conflicting installation destinations".into());}
            let target=safe_target(root,relative)?;
            if target.exists()&&overwrite=="fail"{return Err(format!("File already exists: {relative}"));}
            if library.iter().any(|(id,p)|id!=&package.id&&p.files.iter().any(|f|f.eq_ignore_ascii_case(relative))){return Err("Another package owns an installation target".into());}
          }
          let mut ownership=Vec::new();
          for (index,(source,relative,_)) in operations.iter().enumerate(){
            let target=safe_target(root,relative)?;let existed=target.exists();if existed&&!target.is_file(){return Err("Installation target is not a regular file".into());}
            let backup=format!("backups/{index}");journal.entries.push(Entry{target:relative.clone(),backup:backup.clone(),existed,ready:false});save_journal(&dir,&journal)?;
            if existed{fs::copy(&target,dir.join(&backup)).map_err(|e|e.to_string())?;fs::File::open(dir.join(&backup)).and_then(|f|f.sync_all()).map_err(|e|e.to_string())?;}
            journal.entries.last_mut().unwrap().ready=true;save_journal(&dir,&journal)?;
            if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            let temp=dir.join(format!("apply-{index}"));fs::copy(source,&temp).map_err(|e|e.to_string())?;fs::File::open(&temp).and_then(|f|f.sync_all()).map_err(|e|e.to_string())?;
            // Source and destination share the game filesystem; replacement is atomic on Windows.
            replace_file(&temp,&target)?;
            if sha256_file(&target)?!=sha256_file(source)?{return Err("Installed file verification failed".into());}
            ownership.push(relative.clone());progress(app,&package.id,"اعمال و بررسی فایل‌ها",75.0+20.0*(index+1)as f64/operations.len().max(1)as f64,completed,total);
          }
          Ok(ownership)
        })();
        match result {
          Ok(mut files)=>{
            if let Some(previous)=library.get(&package.id){for old in &previous.files{if !files.iter().any(|f|f.eq_ignore_ascii_case(old)){files.push(old.clone());}}}
            library.insert(package.id.clone(),Installed{version:package.version.clone(),installed_at:SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_secs().to_string(),files,transaction_id});
            // Keep a pre-commit state copy for crash recovery; commit record follows verified files.
            journal.state="committing".into();save_journal(&dir,&journal)?;
            atomic_write(&control.join("installed.json"),&serde_json::to_vec(&library).map_err(|e|e.to_string())?)?;
            journal.state="committed".into();save_journal(&dir,&journal)?;
            let _=fs::remove_dir_all(dir.join("downloads"));
            progress(app,&package.id,"نصب تأیید شد",99.0,0,0);
          },
          Err(error)=>{
            match rollback(root,&dir,&journal){Ok(())=>{journal.state="rolled_back".into();save_journal(&dir,&journal)?;return Err(error);},Err(_)=>return Err(format!("{error}; repair_required: automatic recovery was incomplete"))}
          }
        }
    }Ok(json!({"success":true}))
}
fn replace_file(source:&Path,target:&Path)->Result<(),String>{
    #[cfg(windows)]{use std::os::windows::ffi::OsStrExt;let a:Vec<u16>=source.as_os_str().encode_wide().chain(Some(0)).collect();let b:Vec<u16>=target.as_os_str().encode_wide().chain(Some(0)).collect();if unsafe{windows_sys::Win32::Storage::FileSystem::MoveFileExW(a.as_ptr(),b.as_ptr(),windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING|windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH)}==0{return Err(std::io::Error::last_os_error().to_string());}}
    #[cfg(not(windows))]fs::rename(source,target).map_err(|e|e.to_string())?;Ok(())
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn rejects_local_download_ips(){for s in ["127.0.0.1","10.1.2.3","192.168.0.1","169.254.169.254","100.64.0.1","::1","0.0.0.0"]{assert!(!public_ip(s.parse().unwrap()));}assert!(public_ip("8.8.8.8".parse().unwrap()));}
 #[test]fn rolls_back_new_and_existing_files(){let temp=tempfile::tempdir().unwrap();let root=temp.path().join("game");let dir=temp.path().join("tx");fs::create_dir_all(&root).unwrap();fs::create_dir_all(dir.join("backups")).unwrap();fs::write(root.join("old.ini"),"changed").unwrap();fs::write(root.join("new.ini"),"new").unwrap();fs::write(dir.join("backups/0"),"original").unwrap();let j=Journal{package_id:"p".into(),state:"applying".into(),entries:vec![Entry{target:"old.ini".into(),backup:"backups/0".into(),existed:true,ready:true},Entry{target:"new.ini".into(),backup:"backups/1".into(),existed:false,ready:true}]};rollback(&root,&dir,&j).unwrap();assert_eq!(fs::read_to_string(root.join("old.ini")).unwrap(),"original");assert!(!root.join("new.ini").exists());}
}

#[cfg(test)] mod crash_and_archive_tests {
    use super::*;
    fn interrupted(state:&str,library_committed:bool)->(tempfile::TempDir,PathBuf,PathBuf){
        let temp=tempfile::tempdir().unwrap();let root=temp.path().join("game");fs::create_dir(&root).unwrap();
        let control=regular_control(&root).unwrap();let transaction=uuid::Uuid::new_v4().to_string();let dir=control.join("transactions").join(&transaction);
        fs::create_dir_all(dir.join("backups")).unwrap();fs::write(root.join("settings.ini"),"new").unwrap();fs::write(dir.join("backups/0"),"original").unwrap();
        save_journal(&dir,&Journal{package_id:"package".into(),state:state.into(),entries:vec![Entry{target:"settings.ini".into(),backup:"backups/0".into(),existed:true,ready:true}]}).unwrap();
        if library_committed {let mut value=Library::new();value.insert("package".into(),Installed{version:"1.0.0".into(),installed_at:"0".into(),files:vec!["settings.ini".into()],transaction_id:transaction});atomic_write(&control.join("installed.json"),&serde_json::to_vec(&value).unwrap()).unwrap();}
        (temp,root,dir)
    }
    #[test]fn recovers_interrupted_apply_and_is_idempotent(){let(_temp,root,_)=interrupted("applying",false);assert_eq!(recover(&root).unwrap(),1);assert_eq!(fs::read_to_string(root.join("settings.ini")).unwrap(),"original");assert_eq!(recover(&root).unwrap(),0);}
    #[test]fn rolls_back_pre_commit_crash(){let(_temp,root,_)=interrupted("committing",false);assert_eq!(recover(&root).unwrap(),1);assert_eq!(fs::read_to_string(root.join("settings.ini")).unwrap(),"original");}
    #[test]fn retains_post_commit_files_after_crash(){let(_temp,root,dir)=interrupted("committing",true);assert_eq!(recover(&root).unwrap(),0);assert_eq!(fs::read_to_string(root.join("settings.ini")).unwrap(),"new");let j:Journal=serde_json::from_slice(&fs::read(dir.join("journal.json")).unwrap()).unwrap();assert_eq!(j.state,"committed");}
    #[test]fn rejects_missing_recovery_backup(){let(_temp,root,dir)=interrupted("applying",false);fs::remove_file(dir.join("backups/0")).unwrap();assert!(recover(&root).is_err());assert_eq!(fs::read_to_string(root.join("settings.ini")).unwrap(),"new");}
    fn zip_fixture(dir:&Path,names:&[&str])->PathBuf{
        let path=dir.join("fixture.zip");let mut writer=zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for name in names{writer.start_file(*name,zip::write::SimpleFileOptions::default()).unwrap();writer.write_all(b"test bytes").unwrap();}writer.finish().unwrap();path
    }
    #[test]fn extracts_zip_and_verifies_contents(){let dir=tempfile::tempdir().unwrap();let source=zip_fixture(dir.path(),&["content/test.ini"]);let output=dir.path().join("out");fs::create_dir(&output).unwrap();let files=extract_zip(&source,&output).unwrap();assert_eq!(files.len(),1);assert_eq!(fs::read(output.join("content/test.ini")).unwrap(),b"test bytes");}
    #[test]fn rejects_zip_traversal_before_writing(){let dir=tempfile::tempdir().unwrap();let source=zip_fixture(dir.path(),&["../escaped.ini"]);let output=dir.path().join("out");fs::create_dir(&output).unwrap();assert!(extract_zip(&source,&output).is_err());assert!(!dir.path().join("escaped.ini").exists());}
    #[test]fn rejects_zip_case_collisions(){let dir=tempfile::tempdir().unwrap();let source=zip_fixture(dir.path(),&["Config.ini","config.ini"]);let output=dir.path().join("out");fs::create_dir(&output).unwrap();assert!(extract_zip(&source,&output).is_err());}
    #[cfg(windows)]
    #[test]fn extracts_real_rar_and_seven_zip_with_pinned_tools(){
        let root=PathBuf::from(env!("CARGO_MANIFEST_DIR"));let tools=root.join("resources/extractor");
        for fixture in ["sample.rar","sample.7z"]{
            let dir=tempfile::tempdir().unwrap();let files=extract_external_with_tools(&tools,&root.join("tests/fixtures").join(fixture),dir.path()).unwrap();assert!(!files.is_empty());
            if fixture=="sample.rar"{assert_eq!(fs::read(dir.path().join("content/test.txt")).unwrap(),b"test text file\r\n");}
        }
    }
}
