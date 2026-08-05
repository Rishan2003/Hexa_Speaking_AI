# Voice Repair Report — v1.0.5

## Root causes fixed

1. The `AudioContext` was created after awaiting microphone permission. On browsers with autoplay protection, that loses the original click/tap activation and can leave the context suspended. A suspended context produces no PCM microphone callbacks and no examiner audio playback.
2. The ephemeral-token WebSocket used the outdated `v1alpha` constrained endpoint. Current Gemini Live ephemeral-token connections require `v1beta`.
3. Gemini 3.1 conversational text turns were sent through `clientContent`; normal post-setup turns now use `realtimeInput.text`.
4. The app defaulted to mock mode when `VITE_USE_MOCKS` was missing, and an old local-storage flag could silently force the keyboard-only mock engine.
5. The live microphone level UI multiplied an already percentage-based value by 100.

## Validation

Run:

```bash
npm test
npm run typecheck
npm run build
```

Then test in Chrome or Edge over `https://` or `http://localhost`:

1. Allow microphone permission.
2. Press **Start Practice Session**.
3. Confirm the examiner is audible.
4. Speak and confirm a candidate transcript appears followed by the next examiner question.
5. In Settings, use the 24 kHz playback test if audio is still blocked.
