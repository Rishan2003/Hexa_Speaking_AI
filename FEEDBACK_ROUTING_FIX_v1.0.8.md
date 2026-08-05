# SpeakReady IELTS v1.0.8 — Feedback Routing Reliability Fix

## Symptoms fixed

- Examiner finished the test but the browser stayed on the practice screen.
- The Results/Feedback page did not open.
- Evaluation generation errors prevented navigation entirely.
- Gemini Live could split the final conclusion across several transcription chunks, so the old exact-string check did not fire.
- The evaluation server could briefly read a stale Firestore transcript immediately after the final turn.

## Changes

### 1. Results navigation no longer depends on evaluation success
`PracticeSessionView` now finishes/persists the session and navigates to `/results/:sessionId` first. `ResultsView` owns evaluation lookup/generation.

If evaluation generation fails, the user remains on the Results page with a visible Retry Evaluation action instead of being sent to the practice-screen FAILED state.

### 2. Reliable Live exam-completion detection
Added `src/services/examCompletion.ts` with rolling-buffer normalization and boundary detection. It detects Part 1, Part 2 and complete-test endings even when Gemini splits the sentence across transcription messages.

### 3. Turn-complete fallback
The app recognizes when the stored final question for the active part has been asked and then answered. The next completed examiner turn can advance the app even if the closing transcription did not contain the exact expected wording.

### 4. Part 2 rolling-buffer state guards
Part 2 preparation start, speaking invitation and closing-question transitions are now idempotent. Keeping old text in the rolling buffer no longer causes the preparation timer to restart.

### 5. Final session evidence sent to evaluator
`ResultsView` passes the just-finished session evidence to the authenticated evaluation endpoint. The server verifies ownership against the stored session and may use the fresher final transcript if Firestore has not caught up yet.

### 6. Local/cloud completion reconciliation
If the browser recovery copy already says the session is completed while Firestore still briefly says active, Results uses the completed local state and the richer of the two transcripts.

## Validation

- 89 / 89 automated tests passed.
- `tsc --noEmit` passed.
- Production Vite + server build passed.
