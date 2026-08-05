# Firestore Availability Fallback Fix

## Problem

Firebase Admin authentication initialized correctly, but Cloud Firestore returned
`7 PERMISSION_DENIED` because the Firestore API/database was disabled. The server
therefore failed `/api/session/create` with HTTP 500.

## Fix

- Firebase Admin/Auth availability is now tracked separately from Firestore availability.
- Firestore API, permission, deadline, and availability failures activate a 60-second
  persistence cooldown instead of crashing requests.
- Daily limits continue through the existing in-memory quota cache.
- Speaking-session creation falls back to server memory and returns HTTP 201.
- The response includes `X-SpeakReady-Persistence: firestore` or `memory` for diagnostics.
- A regression test covers the disabled-Firestore-API error shape.

## Verification

- `npm run typecheck`: passed
- `npm test`: 84/84 passed
- `npm run build`: passed

## Permanent Firebase setup

For durable cloud persistence, create/enable Cloud Firestore in the same Firebase project
used by the service account, then restart the Node server. Memory fallback is intended to
keep local development usable; it is not durable across server restarts.
