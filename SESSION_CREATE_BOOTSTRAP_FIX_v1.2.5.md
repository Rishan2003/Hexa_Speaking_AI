# HEXA Speaking AI v1.2.5 — Session Create Bootstrap Fix

This patch gives `/api/session/create` the same zero-import Vercel bootstrap boundary used by billing.

## Why
The frontend was receiving a bare HTTP 500 (`Could not create test (500)`) when the session function could fail before its request handler started. That hid the module/runtime stage.

## Changes
- `api/session-create.ts` is now a zero-import entrypoint.
- New `api/_sessionCreateHandler.ts` contains the real paid-session logic.
- Firestore Admin is loaded through `_firebaseSessionAdminLazy.ts`, inside the request path.
- Local server imports use Node-22-safe `.js` ESM specifiers.
- `questionBank.ts` uses a type-only import so its type dependency is erased at runtime.
- Direct GET to `/api/session/create` returns a bootstrap diagnostic JSON response.
- Failed reservation/persistence stages return structured codes instead of an opaque 500 where possible.

## Expected probe
GET `/api/session/create` should return HTTP 200 with `apiRevision: 1.2.5-session-zero-import-bootstrap`.
