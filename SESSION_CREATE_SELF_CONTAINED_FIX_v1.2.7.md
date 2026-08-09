# HEXA Speaking AI v1.2.7 — Session Create Self-Contained Fix

`api/session-create.ts` no longer imports any local helper module. Authentication, paid-credit reservation/release, lazy Firestore Admin initialization, snapshot validation and authoritative session persistence all live in the Vercel entrypoint itself.

This removes the remaining Vercel Node File Trace / local ESM module-resolution failure mode from `/api/session/create`.

After deployment, GET `/api/session/create` must report:

- `apiRevision`: `1.2.7-session-self-contained`
- `architecture`: `self-contained`

If POST still fails after that probe is confirmed, the function now returns JSON with `code`, `stage`, `requestId`, and `detail.message` for server-side failures.
