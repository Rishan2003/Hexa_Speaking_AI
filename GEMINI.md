# Gemini integration notes

## Models

| Use | Default model |
|---|---|
| Realtime voice examiner | `gemini-3.1-flash-live-preview` |
| Structured IELTS evaluation | `gemini-3.6-flash` |
| Evaluation fallback | `gemini-3.5-flash` |

All model aliases are configurable through deployment environment variables.

## Credential boundary

`GEMINI_API_KEY` is server-only. The browser calls:

```text
POST /api/session/mint
```

The server provisions a short-lived, single-use token through `@google/genai`. The browser connects to the constrained Live API WebSocket endpoint with `access_token`; it never receives the permanent API key.

## Live WebSocket flow

1. Authenticate the user when Firebase Admin is enabled.
2. Mint a constrained ephemeral token on the Express server.
3. Open the constrained v1alpha WebSocket endpoint.
4. Send a part-specific `setup` message.
5. Wait for `setupComplete` before streaming microphone audio.
6. Send PCM through `realtimeInput.audio`.
7. Read candidate and examiner transcriptions from current transcription fields.
8. Save session-resumption handles and rotate/reconnect with bounded retries.
9. For full mocks, establish a new constrained part-specific connection when moving from Part 1 to Part 2 and from Part 2 to Part 3.

## Examiner prompt requirements

The examiner remains professional and neutral, asks only stored snapshot questions, avoids coaching during the exam, and follows the selected practice mode. Feedback belongs in the post-test report.

## Structured evaluation

The server sends the transcript to Gemini and requests validated JSON for:

- Fluency and coherence
- Lexical resource
- Grammatical range and accuracy
- Pronunciation status

The current evaluation request does **not** attach recording bytes. Therefore pronunciation is deliberately returned as `not_assessed` with score `0`, and it is excluded from the calculated overall practice band. Consent or an `uploaded` metadata flag alone is not audio evidence.

A future pronunciation implementation must securely read the owned recording bytes, attach supported audio content to the server-side model request, enforce size/type limits, and retain the existing ownership and consent checks.

Deterministic fallback evaluation is allowed only in explicit non-production sandbox mode. Production failures are returned as errors and never replaced with simulated scores.
