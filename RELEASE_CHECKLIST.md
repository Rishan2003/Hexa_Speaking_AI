# SpeakReady IELTS release checklist

## Configuration

- [ ] `PORT` is supplied by the platform or defaults to `3000`.
- [ ] `OPENAI_API_KEY` is stored in a server secret manager.
- [ ] `OPENAI_REALTIME_MODEL=gpt-realtime-2.1`.
- [ ] `OPENAI_REALTIME_VOICE=marin` (or another supported Realtime voice).
- [ ] `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe`.
- [ ] `GEMINI_API_KEY` is stored server-side for post-test evaluation.
- [ ] `GEMINI_EVALUATION_MODEL=gemini-3.6-flash`.
- [ ] `GEMINI_EVALUATION_FALLBACK_MODEL=gemini-3.5-flash`.
- [ ] `ALLOW_SANDBOX_EVALUATIONS=false` in production.
- [ ] `VITE_USE_MOCKS=false` in the production browser build.
- [ ] `VITE_OPENAI_REALTIME_MODEL` and `VITE_OPENAI_REALTIME_VOICE` match the server Realtime settings.
- [ ] `ALLOWED_ORIGINS` contains every permitted production origin.
- [ ] Complete Firebase Web values are supplied through `VITE_FIREBASE_*`.
- [ ] Firebase Admin uses a service account or Application Default Credentials.
- [ ] Firestore and Storage rules from this project are deployed.

## Dependency-backed verification

```bash
rm -rf node_modules dist
npm install
npm run typecheck
npm test
npm run build
NODE_ENV=production npm start
```

Then verify:

- [ ] `GET /api/health` returns HTTP 200.
- [ ] `GET /api/readiness` returns `ready` and HTTP 200.
- [ ] Missing production credentials make `/api/readiness` return HTTP 503 and `misconfigured`.
- [ ] Sign-up/sign-in works on the HTTPS production domain.
- [ ] Session creation rejects missing or invalid Firebase ID tokens.
- [ ] Part 1, Part 2, Part 3, and Full modes restore with the selected mode and correct starting part.
- [ ] OpenAI Realtime call creation uses authenticated `POST /api/session/mint-openai` and never returns the permanent API key.
- [ ] The OpenAI Realtime provider establishes WebRTC, sends the microphone `MediaStream`, receives examiner audio, and opens its data channel.
- [ ] Full mode rotates examiner instructions correctly between all three parts.
- [ ] Part 2 preparation and speaking timers transition correctly.
- [ ] Evaluation generation/retrieval is limited to the owning user.
- [ ] Live evaluation failures are shown instead of replaced by fake scores.
- [ ] Pronunciation displays `Not Assessed` until audio bytes are actually attached to grading.
- [ ] Recording consent is honored before upload.
- [ ] Failed audio upload never retries with fabricated audio.
- [ ] “Delete recordings” removes Storage objects and metadata.
- [ ] “Purge practice data” recursively removes owned sessions, turns, evaluations, usage records, limits, and orphaned audio.
- [ ] Production CSP has no `unsafe-eval`.

## Rollback

1. Route traffic to the previous healthy deployment revision.
2. If stale browser assets are involved, increment `CACHE_NAME` in `public/sw.js` and redeploy.
3. For an intentional sandbox-only release, rebuild the browser with `VITE_USE_MOCKS=true`; changing only a server variable cannot alter an already-built Vite flag.
