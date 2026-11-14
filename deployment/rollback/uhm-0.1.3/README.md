# Rollback bundles for the pre-0.1.4 cloud deployment

These files are extracted directly from `d17ef1034a30828f0f0e17c606944868f0ca4c0d` (`main` before 0.1.4), whose version was `0.1.3`. Immediately before the 0.1.4 API deployment the cloud API function was version 12 (`0.1.3`).

- `api.js`: SHA-256 `c7f8141a988caf4760e3cf3963ed48f49c0be25274904a478b79a3e9781a7f5a`, 40928 bytes.
- `update-key-broker.js`: SHA-256 `d8fd4ba70ee855e9af4c0f17bfad224cd5c3baaabf607008f63adf356114352c`, 4080 bytes.

Rollback is a code-only operation: redeploy `api.js` with `verify_jwt:false` if needed, then run the non-destructive live check against a matching `0.1.3` source tree. Never roll back additive database migrations or delete production data.
