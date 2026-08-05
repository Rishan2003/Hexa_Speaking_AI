# SpeakReady IELTS v1.1.7 — Vercel 500 / Function Bootstrap Recovery

This release targets Vercel `FUNCTION_INVOCATION_FAILED` / HTTP 500 errors that could prevent even `/api/health` from responding.

## What changed

- `/api/health` is now handled directly by the lightweight Vercel entrypoint.
- `/api/readiness` now reports environment configuration without initializing Firebase/Firestore/Gemini provider code.
- The main Express server is imported lazily only for application API routes.
- Express initialization no longer uses top-level `await`.
- Gemini Live SDK loading moved into `/api/session/mint` only.
- Gemini evaluation pipeline loading moved into evaluation routes only.
- Session creation therefore no longer depends on the Gemini evaluation bundle during API startup.
- Bootstrap failures now return a JSON error code/stage instead of only surfacing Vercel's generic function crash page when possible.

## After deployment

1. Open `/api/health` — expected HTTP 200 JSON with `status: "ok"`.
2. Open `/api/readiness` — HTTP 200 means required server credentials are present; HTTP 503 JSON lists missing configuration.
3. Sign in and launch a practice session.
4. If launch still fails, inspect the JSON `code` and `stage` returned by `/api/session/create` plus the Vercel Function log for that request.

## Required Vercel environment variables

At minimum for production authentication/session launch:

- `FIREBASE_SERVICE_ACCOUNT` (recommended) **or** all three: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- `GEMINI_API_KEY` (required for Gemini Live token minting/evaluation)
- `ALLOWED_ORIGINS=https://YOUR-PROJECT.vercel.app`
- `VITE_APP_URL=https://YOUR-PROJECT.vercel.app`

Frontend Firebase `VITE_FIREBASE_*` values are also required for normal browser sign-in.
