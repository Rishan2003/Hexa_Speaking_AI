# SpeakReady IELTS / HEXA'S — Evaluation Engine Fix v1.1.2

## Root cause found

The previous build could display a plausible-looking IELTS band even when no genuine model evaluation had happened.

There were two silent fallback paths:

1. `EvaluationApiService` returned `MockPracticeService.generateEvaluation()` whenever Firebase client initialization was unavailable. That mock evaluator scored mainly from total candidate word count and contained hard-coded feedback/corrections.
2. `serverEvaluationPipeline` caught Gemini provider failures and, while sandbox fallback was enabled, silently returned another deterministic word-count score with generic feedback.

In addition, malformed or incomplete Gemini output was "repaired" with default 6.5 criterion scores and canned text. This made failures look like successful assessment reports.

## What changed

- Evaluation schema cache bumped from `v2` to `v3`, so old generic reports are not reused.
- Real evaluation requests never silently downgrade to the mock evaluator.
- If a configured Gemini request fails, the Results page receives an explicit retryable error instead of a fake band.
- `ALLOW_SANDBOX_EVALUATIONS=false` is now the shipped local default.
- Sandbox/mock reports are explicitly marked `evaluationEngine: "sandbox"`, use low confidence, and show a strong red DEMO warning in the Results page.
- The evaluator prompt now uses explicit IELTS-style band anchors instead of beginning from a safe/default 6.5.
- Each criterion is scored independently before the server calculates the overall transcript estimate.
- Server-side evidence statistics are computed (response lengths, lexical diversity, short-answer count, timing availability, Part 2 duration) and supplied as diagnostic context only; the model is explicitly forbidden from scoring mechanically from them.
- A question/answer response index is supplied so feedback can connect answers to actual examiner questions.
- Grammar corrections and vocabulary upgrades whose source wording is not present in the candidate transcript are removed.
- Missing core criterion data no longer gets filled with generic 6.5 defaults. The response fails the quality gate instead.
- One bounded Gemini retry is performed if the first structured evaluation fails the quality/grounding checks.
- Tests were strengthened to verify that missing criterion data is rejected instead of fabricated.

## Important current limitation

The server evaluation pipeline still sets raw audio evidence to `false`. Therefore pronunciation is intentionally `not_assessed` and the overall number is a three-criterion, transcript-based practice estimate (Fluency & Coherence, Lexical Resource, Grammar).

A complete four-criterion IELTS-style practice evaluation requires securely attaching evaluator-readable candidate audio to the post-test evaluation request. The current stored browser recording is `audio/webm`; that audio ingestion/transcoding path is not implemented in this version, so the code does not pretend pronunciation was assessed.

## Verification

- Vitest: 91 / 91 passed
- TypeScript: passed (`tsc --noEmit`)
- Production build: passed (`npm run build`)
