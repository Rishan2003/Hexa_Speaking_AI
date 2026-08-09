# HEXA v1.2.4 — Firebase Admin Auth interop fix

Observed production error:

`require() of ES Module .../jose/dist/webapi/index.js from .../jwks-rsa/src/utils.js not supported`

Cause: the paid-access functions imported `firebase-admin/auth`. Firebase Admin 14.x depends on jwks-rsa 4.x, which brings jose 6.x. The Vercel Node 22 runtime for this deployment rejected the CommonJS -> ESM require path before Firebase Auth could initialize.

Fix:
- Billing and paid session creation no longer import `firebase-admin/auth`.
- Firebase user identity is verified by Firebase Authentication's `accounts:lookup` REST endpoint using the user's Firebase ID token and the project's Web API key.
- Firebase Admin is retained only for privileged Firestore operations.
- No payment credentials are required for this fix.

Required Vercel variable: one of `FIREBASE_WEB_API_KEY` or `VITE_FIREBASE_API_KEY` must be present. The frontend already normally uses `VITE_FIREBASE_API_KEY`.
