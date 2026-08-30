# OpenAI Realtime migration notes

The live speaking examiner now defaults to OpenAI Realtime over WebRTC. The existing Gemini evaluator is intentionally unchanged, and the Gemini Live adapter remains available as a fallback provider.

## Production environment

Configure these server-only values:

```env
OPENAI_API_KEY=...
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
GEMINI_API_KEY=...
```

Configure these browser-visible identifiers at build time:

```env
VITE_OPENAI_REALTIME_MODEL=gpt-realtime-2.1
VITE_OPENAI_REALTIME_VOICE=marin
VITE_USE_MOCKS=false
```

Do not expose `OPENAI_API_KEY` or `GEMINI_API_KEY` through a `VITE_` variable.

## Connection flow

1. The existing audio controller obtains the browser microphone `MediaStream`.
2. `OpenAIRealtimeAdapter` creates an `RTCPeerConnection`, attaches the microphone track, and generates an SDP offer.
3. The browser sends the SDP offer, Firebase ID token, paid speaking-session ID, examiner instructions, and turn-detection mode to `/api/session/mint-openai`.
4. The server verifies the Firebase user and the exact paid-session reservation, then calls OpenAI `POST /v1/realtime/calls` with the server-side API key.
5. The server returns only OpenAI's SDP answer. The browser completes the WebRTC connection and uses the data channel for Realtime protocol events.
6. Examiner audio is received directly over WebRTC. Input and output transcript events are mapped into the app's existing transcript contract.

## IELTS turn handling

Parts 1 and 3 use server VAD with automatic response creation. Part 2 disables automatic turn detection and uses explicit `input_audio_buffer.clear`, `input_audio_buffer.commit`, and `response.create` events so natural pauses during the two-minute answer do not end the candidate turn early.

Examiner completion is emitted from `output_audio_buffer.stopped`, not `response.done`, so state transitions happen after the spoken examiner audio has actually drained.

## Validation performed for this migration

- Changed TypeScript/TSX files pass TypeScript transpile/syntax validation.
- The OpenAI adapter passes an isolated strict TypeScript compile with DOM/WebRTC types.
- A simulated Realtime event smoke test verifies transcript mapping, usage mapping, interruption handling, and audio-drain turn completion.
- A Part 2 smoke test verifies the manual event sequence: clear → commit → response.create.
- `vercel.json` and `metadata.json` parse as valid JSON and `git diff --check` is clean.

A full repository `npm run typecheck`, `npm test`, and `npm run build` still needs to be run in a normal dependency-enabled environment. Dependency installation in the migration container timed out before `node_modules` could be created.
