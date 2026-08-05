# Evaluation Pipeline Recovery v1.1.3

This patch addresses the post-session `Evaluation Pipeline Error` that could occur even when session creation and Gemini Live token minting succeeded.

## What changed

- Existing-report lookup failure no longer blocks a fresh evaluation request.
- Evaluation POST now logs `Evaluation request received` before loading evidence.
- Firestore reads use the existing availability circuit-breaker and can fall back to authenticated session evidence.
- Every created session is mirrored into server memory as a recovery copy, even when Firestore creation succeeds.
- Successful genuine Gemini evaluations are mirrored into server/browser recovery storage; this never invokes the deterministic sandbox evaluator.
- Temporary Firestore save failure no longer discards a valid Gemini assessment.
- Evaluation endpoint failures now return diagnostic codes such as `EVALUATION_PROVIDER_FAILED`, `EVALUATION_NOT_CONFIGURED`, and `EVALUATION_PIPELINE_FAILED`, plus the request ID.
- The Results page can therefore show the actual evaluation-stage failure instead of only the generic Express message.

## Important

Real mode still never substitutes the deterministic mock evaluator when Gemini grading fails. Recovery storage preserves only sessions/status or a genuine server-returned Gemini evaluation.
