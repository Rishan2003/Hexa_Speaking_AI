# Part 2 Long-Turn Pause Fix

This build is based on v1.0.9 (not v1.0.10).

## Problem
Gemini Live automatic VAD treated a natural pause in the Part 2 long turn as the end of the candidate turn. The model then asked the closing question and the app advanced early.

## Fix
- Part 1 and Part 3 continue using automatic Gemini VAD.
- Part 2 uses manual activity detection.
- The application sends `activityStart` when the examiner finishes the preparation-time invitation.
- All candidate audio for the long turn remains inside the same logical activity across pauses.
- At exactly 120 seconds the application sends `activityEnd`; only then may Gemini respond with `Thank you. That's two minutes.` and the stored closing question.
- The Part 2 closing-answer turn is also manual, with a small client-side silence detector used only to finish that short answer.

This follows the Gemini Live API documented manual-VAD mechanism (`automaticActivityDetection.disabled`, `activityStart`, `activityEnd`).
