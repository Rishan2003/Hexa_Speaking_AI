> **Vercel:** v1.1.8 includes the lightweight health/readiness and lazy provider loading used to avoid function bootstrap 500s. See `VERCEL_500_RECOVERY_v1.1.7.md`.

# SpeakReady IELTS

A full-stack IELTS speaking-practice application built with React, Vite, Express, Firebase, OpenAI Realtime voice, and Gemini-based post-test evaluation.

## Requirements

- Node.js 22.x
- npm 10 or newer
- A modern browser with microphone access and WebRTC

## Start in sandbox mode

Sandbox mode works without OpenAI, Gemini, or Firebase credentials and remains fully local.

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

## Enable OpenAI Realtime voice

The live speaking examiner now uses OpenAI Realtime over WebRTC. Set the server-only OpenAI API key and choose the realtime model/voice if desired:

```env
OPENAI_API_KEY=your_server_api_key
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
VITE_OPENAI_REALTIME_MODEL=gpt-realtime-2.1
VITE_OPENAI_REALTIME_VOICE=marin
VITE_USE_MOCKS=false
```

`OPENAI_API_KEY` must never use a `VITE_` prefix. The browser sends its WebRTC SDP offer to the authenticated `/api/session/mint-openai` route; the server creates the OpenAI Realtime call and returns only the SDP answer. The permanent OpenAI API key is never returned to the browser.

The legacy Gemini Live adapter and `/api/session/mint` endpoint are retained as a fallback provider, but OpenAI Realtime is the default live voice provider.

## Enable Gemini post-test evaluation

The existing grading/evaluation pipeline still uses Gemini, so production live mode also requires:

```env
GEMINI_API_KEY=your_server_api_key
```

The Gemini Live model variables may remain configured only if you want the legacy Gemini Live fallback. `GEMINI_API_KEY` is server-only and must never use a `VITE_` prefix.

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

Production readiness returns HTTP 503 when OpenAI Realtime, Gemini evaluation, or Firebase Admin configuration is incomplete. Development can report `degraded_sandbox` instead.

## Important behavior

- OpenAI Realtime live calls are authorized through authenticated `POST /api/session/mint-openai` requests and use WebRTC browser audio.
- The microphone `MediaStream` is attached directly to the WebRTC peer connection; the OpenAI path does not manually upload PCM chunks.
- Part 1 and Part 3 use server VAD for normal conversational turns and interruption handling.
- Part 2 uses app-controlled activity boundaries so a candidate's long-turn pauses do not prematurely trigger the examiner.
- Examiner turn completion waits for the WebRTC output audio buffer to finish playing, not merely for model generation to finish.
- The legacy Gemini Live provider remains available through the provider factory as a fallback.
- Full mocks rotate to part-specific connections so Part 1 instructions do not leak into Parts 2 or 3.
- Part 1, Part 2, Part 3, and Full modes preserve their real snapshot mode in sandbox and live storage.
- Firebase-backed session/evaluation routes enforce authentication and ownership.
- Evaluation errors in live mode are surfaced; simulated scores are limited to explicit non-production sandbox mode.
- Pronunciation is marked `not_assessed` because the current grading request sends transcript text only. Recording metadata or consent is never treated as audio evidence.
- Privacy controls perform real authenticated deletion of recordings or practice data.
- API request bodies are limited to 1 MB and production CSP excludes `unsafe-eval`.

See `.env.example`, `GEMINI.md`, `REPAIR_REPORT.md`, and `RELEASE_CHECKLIST.md`.
