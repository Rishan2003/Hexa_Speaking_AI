# Gemini Live and Firebase Admin Fix

## Fixed

1. Gemini Live WebSocket messages now support `string`, `Blob`, `ArrayBuffer`, and typed-array payloads before JSON parsing. This prevents a valid `setupComplete` message from being discarded and causing the setup timeout.
2. The browser now uses the API version returned by `/api/session/mint` when constructing the constrained WebSocket URL.
3. `GoogleGenAI` now receives the API version through `httpOptions.apiVersion`, matching the SDK configuration shape.
4. Firebase Admin now uses modular ESM imports from `firebase-admin/app`, `firebase-admin/auth`, `firebase-admin/firestore`, and `firebase-admin/storage`. This fixes `credential.cert` being undefined under Firebase Admin v14 ESM.
5. Added a regression test for a Blob-delivered `setupComplete` event.

## Validation

- `npm run typecheck`: passed
- `npm test`: 83 tests passed
- `npm run build`: passed
- Development server `/api/health`: HTTP 200

## Run

```bash
npm install
npm run dev
```

Then hard-refresh the browser (`Ctrl+Shift+R`) so the old Vite bundle is not reused.
