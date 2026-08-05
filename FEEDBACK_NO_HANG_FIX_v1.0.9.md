# Feedback No-Hang Fix — v1.0.9

## Root cause

The v1.0.8 practice screen entered `EVALUATING`, but navigation to `/results/:sessionId` happened only after awaiting browser/network cleanup:

- realtime provider disconnect
- `MediaRecorder.stop()` / `onstop`
- final Firestore persistence

If any of those operations failed to resolve, the candidate remained forever on “Evaluating Speech Performance…”.

## v1.0.9 behavior

1. Stop microphone transmission and timers.
2. Mark the local recovery session `COMPLETE` synchronously.
3. Start disconnect, recorder shutdown, Firestore persistence, and optional recording upload as best-effort background work.
4. Navigate to `/results/:sessionId` immediately without awaiting cleanup.
5. Bound cloud restore/evaluation calls so the Results page cannot spin forever. A slow evaluation becomes a visible retryable error.

## Timeouts

- Cloud session restore fallback: 8 seconds.
- Evaluation lookup/auth: 12 seconds.
- Evaluation generation request: 60 seconds.
- Recorder finalization before upload is abandoned: 3 seconds.

## Validation

- TypeScript: passed
- Vitest: 89/89 passed
- Production build: passed
