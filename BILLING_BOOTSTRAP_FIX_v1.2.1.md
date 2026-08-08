# HEXA Speaking AI v1.2.1 — Billing Vercel Bootstrap Fix

This patch addresses the generic Vercel `FUNCTION_INVOCATION_FAILED` response seen on `/api/billing/*`.

## What changed
- Billing no longer imports `firebase-admin` during function module bootstrap.
- Firebase Admin SDK modules are dynamically loaded only after the request handler starts.
- Firebase credential/SDK initialization errors now return JSON with code `FIREBASE_ADMIN_INIT_FAILED` instead of a generic Vercel crash page whenever Vercel can start the function.
- Billing API revision header updated to `1.2.1-paid-access-bootstrap-fix`.

## After deployment
Call `/api/billing/me` while signed in. If Firebase credentials are wrong, inspect the JSON `error` field; it will now identify the configuration problem.
