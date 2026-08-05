> **Vercel:** v1.1.7 keeps health/readiness lightweight and lazy-loads the Express/provider stack to recover from function bootstrap 500s. See `VERCEL_500_RECOVERY_v1.1.7.md`.

# SpeakReady IELTS

A full-stack IELTS speaking-practice application built with React, Vite, Express, Firebase, and Gemini Live.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- A modern browser with microphone access

## Start in sandbox mode

Sandbox mode works without Gemini or Firebase credentials and remains fully local.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000` and keep:

```env
VITE_USE_MOCKS=true
```

The Settings toggle updates sandbox mode immediately. In sandbox mode, sessions, evaluations, recordings metadata, and privacy deletion use browser-local storage instead of Firebase or production APIs.

## Enable Gemini Live

Set the server-only API key and disable browser mock mode:

```env
GEMINI_API_KEY=your_server_api_key
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
VITE_GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
VITE_USE_MOCKS=false
```

`GEMINI_API_KEY` must never use a `VITE_` prefix. The Express server exchanges it for a short-lived, single-use token; the permanent key is never returned to the browser.

## Enable Firebase

The browser requires all `VITE_FIREBASE_*` values from the Firebase web-app configuration. The Express server separately requires Firebase Admin credentials. Configure one server method:

1. `FIREBASE_SERVICE_ACCOUNT` containing raw or base64-encoded service-account JSON.
2. `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` together.
3. `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON file.
4. Application Default Credentials on a supported Google Cloud runtime.

A Firebase project ID or browser web configuration by itself is not a Firebase Admin credential.

## Commands

```bash
npm run dev        # Express server with Vite middleware
npm run typecheck  # TypeScript checking
npm test           # Vitest suite
npm run build      # Browser bundle + bundled Express server
npm start          # Start the production build
```

The server respects `PORT`; it defaults to `3000`.

## Health and readiness

- `GET /api/health` is the liveness endpoint.
- `GET /api/readiness` reports configuration status without exposing secrets.

Production readiness returns HTTP 503 when Gemini or Firebase Admin configuration is incomplete. Development can report `degraded_sandbox` instead.

## Important behavior

- Gemini Live tokens are minted with authenticated `POST /api/session/mint` requests.
- Live sessions wait for `setupComplete`, send an internal opening turn so the examiner speaks first, and then stream microphone PCM.
- Browser microphone audio is normalized to signed 16-bit PCM at 16 kHz before transmission.
- Full mocks rotate to part-specific Live connections so Part 1 instructions do not leak into Parts 2 or 3.
- Part 1, Part 2, Part 3, and Full modes preserve their real snapshot mode in sandbox and live storage.
- Firebase-backed session/evaluation routes enforce authentication and ownership.
- Evaluation errors in live mode are surfaced; simulated scores are limited to explicit non-production sandbox mode.
- Pronunciation is marked `not_assessed` because the current grading request sends transcript text only. Recording metadata or consent is never treated as audio evidence.
- Privacy controls perform real authenticated deletion of recordings or practice data.
- API request bodies are limited to 1 MB and production CSP excludes `unsafe-eval`.

See `.env.example`, `GEMINI.md`, `REPAIR_REPORT.md`, and `RELEASE_CHECKLIST.md`.
