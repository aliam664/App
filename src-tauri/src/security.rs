use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    rand::SystemRandom,
    signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn relative_path(input: &str) -> Result<PathBuf, String> {
    if input.is_empty()
        || input.len() > 220
        || input.starts_with(['/', '\\'])
        || input
            .chars()
            .any(|c| c.is_control() || ":<>\"|?*".contains(c))
    {
        return Err("Unsafe installation path".into());
    }
    let normalized = input.replace('\\', "/");
    for part in normalized.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with([' ', '.'])
            || ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "CLOCK$"].contains(&stem.as_str())
            || stem
                .strip_prefix("COM")
                .or_else(|| stem.strip_prefix("LPT"))
                .map(|s| {
                    matches!(
                        s,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
                .unwrap_or(false)
            || part.eq_ignore_ascii_case(".uhm")
        {
            return Err("Reserved or traversing installation path".into());
        }
    }
    Ok(PathBuf::from(normalized))
}
pub fn safe_target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = relative_path(relative)?;
    let mut current = root.to_path_buf();
    for part in rel.components() {
        current.push(part);
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                return Err("Symbolic links are not allowed".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err("Reparse points are not allowed".into());
                }
            }
        }
    }
    Ok(current)
}
pub fn sha256_file(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let a: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let result = unsafe {
            windows_sys::Win32::Storage::FileSystem::MoveFileExW(
                a.as_ptr(),
                b.as_ptr(),
                windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
                    | windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    #[cfg(not(windows))]
    fs::rename(&temp, path).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(windows)]
fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::*;
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let result = unsafe {
        if decrypt {
            CryptUnprotectData(
                &mut input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &mut input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if result == 0 {
        return Err("Windows could not protect the device key".into());
    }
    let value =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(output.pbData as *mut core::ffi::c_void);
    }
    Ok(value)
}
#[cfg(not(windows))]
fn protect(_bytes: &[u8], _decrypt: bool) -> Result<Vec<u8>, String> {
    Err("Device identity requires Windows DPAPI".into())
}
fn device_key(dir: &Path) -> Result<EcdsaKeyPair, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join("device.dpapi");
    if path.exists() {
        let der = protect(&fs::read(&path).map_err(|e| e.to_string())?, true)?;
        return EcdsaKeyPair::from_pkcs8(
            &ECDSA_P256_SHA256_FIXED_SIGNING,
            &der,
            &SystemRandom::new(),
        )
        .map_err(|_| "Device key cannot be recovered; contact administrator".into());
    }
    let rng = SystemRandom::new();
    let der = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng)
        .map_err(|_| "Could not generate device identity")?;
    atomic_write(&path, &protect(der.as_ref(), false)?)?;
    EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, der.as_ref(), &rng)
        .map_err(|_| "Generated device identity is invalid".into())
}
pub fn identity(dir: &Path) -> Result<Value, String> {
    let key = device_key(dir)?;
    let point = key.public_key().as_ref();
    if point.len() != 65 || point[0] != 4 {
        return Err("Unexpected device public key format".into());
    }
    Ok(
        json!({"kty":"EC","crv":"P-256","x":URL_SAFE_NO_PAD.encode(&point[1..33]),"y":URL_SAFE_NO_PAD.encode(&point[33..65])}),
    )
}
pub fn device_thumb(dir: &Path) -> Result<String, String> {
    let jwk = identity(dir)?;
    // RFC 7638: lexicographic member ordering, no whitespace.
    let canonical = format!(
        "{{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"{}\",\"y\":\"{}\"}}",
        jwk["x"].as_str().unwrap(),
        jwk["y"].as_str().unwrap()
    );
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(canonical.as_bytes())))
}
pub fn sign_nonce(dir: &Path, nonce: &str) -> Result<String, String> {
    if nonce.len() != 43
        || !nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid challenge".into());
    }
    let signature = device_key(dir)?
        .sign(
            &SystemRandom::new(),
            format!("UHM:device-proof:v1:{nonce}").as_bytes(),
        )
        .map_err(|_| "Device could not sign the challenge")?;
    Ok(URL_SAFE_NO_PAD.encode(signature.as_ref()))
}
pub fn verify(token: &str, kind: &str) -> Result<Value, String> {
    use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
    if token.len() > 2_000_000 {
        return Err("Oversized authorization token".into());
    }
    let jwk: Value = serde_json::from_str(
        option_env!("UHM_LICENSE_PUBLIC_JWK")
            .ok_or("This build has no trusted license public key configured")?,
    )
    .map_err(|e| e.to_string())?;
    let header = decode_header(token).map_err(|_| "Invalid token header")?;
    if header.alg != Algorithm::ES256
        || header.typ.as_deref() != Some(kind)
        || header.kid.as_deref() != option_env!("UHM_LICENSE_KEY_ID")
    {
        return Err("Token type, key or algorithm mismatch".into());
    }
    let mut validation = Validation::new(Algorithm::ES256);
    validation.leeway = 30;
    validation.set_audience(&["uhm-launcher"]);
    validation.set_issuer(&[option_env!("UHM_LICENSE_ISSUER").ok_or("Missing trusted issuer")?]);
    let key = DecodingKey::from_ec_components(
        jwk["x"].as_str().ok_or("Invalid public key")?,
        jwk["y"].as_str().ok_or("Invalid public key")?,
    )
    .map_err(|e| e.to_string())?;
    let value = decode::<Value>(token, &key, &validation)
        .map_err(|_| "Authorization signature or expiry is invalid")?
        .claims;
    if value["schema_version"] != 1 {
        return Err("Unsupported authorization schema".into());
    }
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_windows_escapes() {
        for p in [
            "COM¹.txt",
            "LPT²",
            "CONIN$.cfg",
            "CONOUT$",
            "CLOCK$",
            "x\u{7f}y",
            "x\u{85}y",
            "../evil",
            "/abs",
            "C:\\x",
            "a/../../b",
            "a:stream",
            "NUL.txt",
            "a/COM1",
            "x.",
            "x ",
            ".uhm/state.json",
            "\\\\server\\x",
        ] {
            assert!(relative_path(p).is_err(), "{p}");
        }
    }
    #[test]
    fn accepts_game_relative_paths() {
        for p in [
            "extension/config/test.ini",
            "content/cars/test/model.kn5",
            "پوشه/فایل.ini",
        ] {
            assert!(relative_path(p).is_ok(), "{p}");
        }
    }
    #[test]
    fn replaces_state_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"second");
    }
    #[test]
    fn no_unconfigured_trust() {
        assert!(verify("bad-token", "uhm-plan+jwt").is_err());
    }
}

#[cfg(all(test, windows))]
mod identity_tests {
    use super::*;
    #[test]
    fn dpapi_identity_survives_restart_and_uses_raw_p256_signatures() {
        let dir = tempfile::tempdir().unwrap();
        let first = identity(dir.path()).unwrap();
        let second = identity(dir.path()).unwrap();
        assert_eq!(first, second);
        let nonce = "a".repeat(43);
        let signature = URL_SAFE_NO_PAD
            .decode(sign_nonce(dir.path(), &nonce).unwrap())
            .unwrap();
        assert_eq!(signature.len(), 64);
        let mut key = vec![4];
        key.extend(
            URL_SAFE_NO_PAD
                .decode(first["x"].as_str().unwrap())
                .unwrap(),
        );
        key.extend(
            URL_SAFE_NO_PAD
                .decode(first["y"].as_str().unwrap())
                .unwrap(),
        );
        ring::signature::UnparsedPublicKey::new(&ring::signature::ECDSA_P256_SHA256_FIXED, &key)
            .verify(
                format!("UHM:device-proof:v1:{nonce}").as_bytes(),
                &signature,
            )
            .unwrap();
    }
}
