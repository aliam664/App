# RAR test fixtures

Small RAR archives used by the Rust archive and installer tests (`src-tauri/src/archive.rs`, `mod_installer.rs`) to exercise the
drag-and-drop installer's RAR support, including password handling.

All files are taken from the MIT-licensed
[`node-unrar-js`](https://github.com/YuJianrong/node-unrar.js) test suite
(`testFiles/`), used here purely as test data.

| File               | Contents                                   | Password            |
| ------------------ | ------------------------------------------ | ------------------- |
| `HeaderEnc1234.rar`| `1File.txt`, `2中文.txt` (header-encrypted) | `1234`              |
| `FileEncByName.rar`| `1File.txt`, `2中文.txt`, `3Sec.txt` (per-file encryption) | `2中文` / `3Sec` |
| `FolderTest.rar`   | `Folder1/Folder Space/long.txt`, `Folder1/Folder 中文/2中文.txt` (no password) | — |
| `WithComment.rar`  | `1File.txt`, `2中文.txt` (no password)      | —                   |
