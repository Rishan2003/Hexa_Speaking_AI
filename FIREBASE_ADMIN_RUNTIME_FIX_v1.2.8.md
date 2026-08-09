# HEXA Speaking AI v1.2.8 — Firebase Admin runtime compatibility fix

## Root cause
The project was installing `firebase-admin` 14.2.0. That release depends on `jwks-rsa` 4.x, which in the deployed dependency tree loads ESM-only `jose` 6.x through a CommonJS `require()` path and crashes Vercel Node 22 functions.

## Change
`package.json` now pins:

```json
"firebase-admin": "13.10.0"
```

Firebase Admin 13.10.0 supports Node >=18 (including Node 22) and depends on `jwks-rsa` ^3.1.0, whose current 3.x line uses `jose` 4.x rather than the ESM-only v6 path that caused the crash.

## Deployment
Replace `package.json`, commit/push, then redeploy WITHOUT the existing Vercel Build Cache.

Vercel uses `npm install` for npm projects with `package-lock.json`. Because the exact dependency in package.json no longer matches the old lock entry, npm will resolve the pinned 13.10.0 dependency during the deployment install.

If you maintain the project locally, run `npm install` once and commit the regenerated `package-lock.json` afterward.
