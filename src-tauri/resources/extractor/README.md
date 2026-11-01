# Pinned Windows archive extractor

ZIP is handled in Rust. RAR and 7z require the official 7-Zip `7z.exe` and
`7z.dll` in this directory plus their license notices. The Windows CI workflow
retrieves a specific release, verifies its installer SHA-256, extracts the tools,
and pins both binary hashes at compile time. Runtime verifies them again before
execution. No PATH lookup, downloaded installer execution, or package-provided
executable is permitted. Without this preparation, RAR/7z fail closed.

These generated binaries are not committed. See `scripts/prepare-extractor.ps1`.
