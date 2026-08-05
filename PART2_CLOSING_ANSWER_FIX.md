# Part 2 Closing Answer Fix

## Problem
After the 120-second Part 2 long turn, Gemini correctly asked the stored brief closing question, but the candidate microphone/manual activity could remain closed. The UI then appeared stuck and the candidate answer was never committed.

## Root cause
Gemini Live can emit `serverContent.turnComplete` before the final output-transcription chunk containing the closing question. The previous implementation armed the candidate closing-answer activity only inside `onTurnChange` when `part2ClosingDetectedRef` was already true. When `turnComplete` arrived first, that condition failed permanently.

## Fix
- Track examiner `turnComplete` independently from closing-question transcript detection.
- Use one idempotent gate (`armPart2ClosingAnswerIfReady`) that requires both signals.
- Call the gate from both event paths, so either ordering works:
  - `turnComplete -> transcript`
  - `transcript -> turnComplete`
- Reset stale examiner-turn completion at the 120-second boundary.
- Add a 20-second safety close for the brief follow-up activity so browser input-level edge cases cannot create an infinite manual turn.
- Preserve the original Part 2 long-turn behavior: natural pauses during the main answer still do not end the turn.

## Intended flow
1. Main Part 2 answer runs as one manual activity for 120 seconds.
2. App ends that activity.
3. Examiner says `Thank you. That's two minutes.` and asks the stored closing question.
4. After BOTH the closing-question text and examiner turn completion are observed, the app starts a fresh candidate activity and unmutes the mic.
5. Candidate answers.
6. ~1.6 seconds of silence ends that short activity (20-second safety cap).
7. Gemini receives the committed answer, concludes Part 2, and the app advances to Part 3/results as appropriate.
