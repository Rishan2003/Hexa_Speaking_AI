# HEXA Speaking AI v1.2.9 — Gemini Mint Preview Protection Fix

## Root cause
`api/session-mint.ts` authorized a paid session by making an HTTP request back to the current Vercel deployment at `/api/billing/reservation/authorize-mint`.

On a Vercel Preview Deployment protected by Vercel Authentication/SSO, that server-to-server request is intercepted by Deployment Protection and returns `Protected deployment` before the billing API is reached. The mint endpoint then surfaced this as `PAID_SESSION_NOT_AUTHORIZED` even though the paid session itself was valid.

## Fix
`api/session-mint.ts` now authorizes the paid session directly in Firestore after verifying the Firebase ID token. It checks:
- reservation exists
- speaking session exists
- both belong to the authenticated user
- `billingReservationId` and `sessionId` are linked
- reservation status is `reserved` or `consumed`
- speaking session status is `active`
- reservation has not expired

Expired credit reservations are released/refunded transactionally.

## Deployment
Replace only:
- `api/session-mint.ts`

This patch expects the prior Firebase Admin runtime pin (`firebase-admin` 13.10.0) from v1.2.8 to remain in place.

Expected mint API revision after deployment:
`1.2.9-paid-mint-direct-firestore-auth`
