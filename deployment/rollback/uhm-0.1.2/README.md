# Rollback bundles for the pre-0.1.3 cloud deployment

These files are reconstructed from `8cc4e74a0113c6152cf0e6c7b9514148ad155f19` (`main` before this work), whose version was `0.1.2`. Immediately before the 2026-11-08 deployment the cloud functions were API version 11 and update-key-broker version 2. The hashes below are the expected previous bundles; they were not re-fetched from cloud history before replacement.

- `api.js`: SHA-256 `a87f5e2e02325bfc1f960d28688000f85bd26100cc768dd8963474431b62cc9b`, 40164 bytes.
- `update-key-broker.js`: SHA-256 `5ecb6dec22cf9073e726157e71dcbc18cb0a7a160976b73e2d491ebd9a5882a2`, 4098 bytes.

Rollback is a code-only operation: redeploy these exact bodies with `verify_jwt:false`, then run the non-destructive live check against a matching 0.1.2 source tree. Do not roll back database migrations or delete data. The immutable 0.1.3 release/feed must not be rewritten; if the feed must stop pointing at 0.1.3, publish a separately reviewed higher-version rollback release instead of replacing immutable artifacts.
