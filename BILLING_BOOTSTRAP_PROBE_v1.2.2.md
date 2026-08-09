# Billing Bootstrap Probe — v1.2.2

This patch makes `api/billing.ts` a zero-static-import Vercel entrypoint.

## Why
v1.2.1 could still fail before its handler because the public entrypoint still
statically imported local billing modules. A Vercel module-trace/load failure
therefore still appeared only as `FUNCTION_INVOCATION_FAILED`.

## Checks after deployment
1. Open `/api/billing/bootstrap`.
   - Expected: HTTP 200 JSON with `stage: "entrypoint"`.
2. Sign in and let the app request `/api/billing/me`.
   - If dependencies cannot load, the endpoint now returns
     `BILLING_IMPLEMENTATION_IMPORT_FAILED` plus the module-load error.
   - If Firebase configuration is wrong, the existing billing handler returns
     `FIREBASE_ADMIN_INIT_FAILED` as JSON.

No payment credentials are required for these checks.
