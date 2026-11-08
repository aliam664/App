# Archive compatibility fixtures

Tiny test-only fixtures from https://github.com/libarchive/libarchive at commit `348e5a2e27503f5bf114e298e2bd9ddcd59ab48e`. No executable in these fixtures is ever launched. UU decoding is the only transformation. Kept outside desktop bundle.

- `sample.rar`: `libarchive/test/test_read_format_rar_windows.rar.uu`; decoded SHA-256 `8d689455e9ecd92c19426604e2360b5ef8eb023890fe46aabbe2864260b70fc9`.
- `sample.7z`: `libarchive/test/test_read_format_7zip_copy.7z.uu`; decoded SHA-256 `67a85f85950c4aaa524eb3f22be1fbac586e90c76de21e10fc1c2ce7685e04c2`.

Upstream distribution license and associated test-source copyright headers are preserved beside the fixtures.
