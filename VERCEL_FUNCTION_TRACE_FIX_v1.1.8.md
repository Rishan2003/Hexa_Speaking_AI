# Vercel Function Trace Fix — v1.1.8

## Problem fixed
The v1.1.7 Vercel entrypoint dynamically imported `../server` from outside the `/api` function directory. A deployment could build successfully but the deployed Node function could still fail while resolving/tracing that module, returning `VERCEL_API_BOOTSTRAP_FAILED`.

## Changes
- Moved the Vercel API implementation to `api/_server.ts`.
- `_server.ts` is underscore-prefixed so it is utility code, not a separate public Function.
- `api/index.ts` now statically imports `./_server`, making the function dependency graph directly traceable at build time.
- Root `server.ts` is now only a local-development wrapper around the same implementation.
- API rewrite explicitly forwards the captured route as `?path=:path*`.
- `/api/health` reports `apiRevision: 1.1.8` so you can confirm the new deployment is active.
- Entry-point failures after bootstrap now return `VERCEL_API_HANDLER_FAILED`; deeper Express initialization failures still return `SERVER_INITIALIZATION_FAILED`.

## Deployment check
After redeploying, open:
1. `/api/health` — must return HTTP 200 and `apiRevision: "1.1.8"`.
2. `/api/readiness` — configure any missing server environment variables it reports.
3. Start a test. If it fails, copy the returned `code`, `stage`, and request ID (if present) from the UI or Vercel Function log.


## Additional isolation
- `/api/health` is now `api/health.ts` and does not import Express, Firebase, or Gemini.
- `/api/readiness` is now `api/readiness.ts` and checks environment-variable presence without importing Firebase/Gemini SDKs.
- Only `/api/session/*`, `/api/evaluations/*`, `/api/privacy/*`, and `/api/admin/*` are rewritten to `api/index.ts`.
