fn main() {
    for name in [
        "UHM_LICENSE_PUBLIC_JWK",
        "UHM_LICENSE_ISSUER",
        "UHM_LICENSE_KEY_ID",
        "UHM_EXTRACTOR_EXE_SHA256",
        "UHM_EXTRACTOR_DLL_SHA256",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "updater_status",
            "device_identity",
            "sign_challenge",
            "get_settings",
            "set_game_path",
            "installed_packages",
            "control_job",
            "set_download_preferences",
            "download_cache_status",
            "discover_paths",
            "set_autoscan",
            "scan_content",
            "content_image",
            "deletion_preview",
            "quarantine_files",
            "list_quarantine",
            "restore_quarantine",
            "install_plan",
            "recover_installations",
            "verify_offline_grant",
        ]),
    ))
    .expect("Tauri build configuration failed");
}
