# IELTS Exam Flow Improvements

## Part 1

- The deterministic question selection now chooses two distinct familiar-topic frames.
- Four stored questions are selected from each topic (8 total).
- `part1Topics` preserves topic boundaries for the examiner prompt.
- `part1Topic` remains as a flattened backwards-compatible view for the existing state machine.
- The deterministic mock-engine Part 1 limit is now 8 questions instead of 3.
- The examiner prompt targets a realistic 4-5 minute Part 1 and does not conclude after only 3-4 questions.

## Part 2 preparation timer

- The browser/app owns the exact timer; Gemini is explicitly told not to estimate time itself.
- When the examiner announces that preparation starts, candidate audio is muted and the realtime audio stream is closed cleanly.
- At exactly 60 seconds the app sends `[CONTROL:PART2_PREP_COMPLETE]` as an internal realtime text event.
- That control event is not written into the candidate transcript.
- The microphone remains muted until the examiner actually says the invitation to begin speaking.
- The Part 2 speaking timer starts only after that invitation is detected.

## Part 2 two-minute limit

- At 120 seconds, candidate audio is muted and the realtime audio stream is closed.
- The app sends `[CONTROL:PART2_LONG_TURN_TIME_LIMIT]` so the examiner can interrupt without waiting for another candidate utterance.
- If the candidate finishes naturally before two minutes and the examiner asks the stored closing question, the long-turn timer stops immediately.

## Validation

- 86/86 Vitest tests pass.
- TypeScript `tsc --noEmit` passes.
- Production Vite/server build passes.
