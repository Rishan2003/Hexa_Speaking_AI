# Build status

## Repair status

The July 22, 2026 repair pass corrected the main startup, security, persistence, privacy, mode-selection, Live API, and evaluation-integrity defects in the uploaded project.

Verified without downloading dependencies:

- All 59 TypeScript/TSX source files pass TypeScript syntax transpilation.
- All relative imports resolve to existing project files.
- `package.json`, `metadata.json`, and `tsconfig.json` parse as valid JSON.
- No embedded Google API key or private-key block is present in the source tree.
- Local persistence/privacy runtime harnesses pass.
- Gemini Live adapter connection/setup/reconnect harness passes.


## Version 1.0.3 verification

- The local import graph from `server.ts` reaches 10 runtime-neutral source modules.
- `src/config.ts` is no longer reachable from the Node/CommonJS server bundle.
- Therefore esbuild does not encounter the browser-only `import.meta.env` expression while bundling `server.ts`.
- TypeScript syntax transpilation reports 0 diagnostics across 59 TypeScript/TSX files.


## Version 1.0.4 voice-flow verification

- Removed the React-state gate from the persistent microphone callback; PCM now reaches the active provider and provider-level connection checks remain authoritative.
- Added a post-`setupComplete` internal client turn that starts the examiner without recording a fabricated candidate utterance.
- Added browser input resampling based on the real `AudioContext.sampleRate`, targeting 16 kHz signed PCM.
- Added real output sample-rate playback and interruption queue clearing.
- TypeScript syntax transpilation reports 0 diagnostics across 59 TypeScript/TSX files.
- All relative imports resolve and `package.json` parses successfully.
- Full dependency-backed typecheck/test/build could not run in the repair environment because the configured npm mirror returned HTTP 503 for `@google/genai`.

## Required dependency-backed verification

Run these commands in an environment with working npm registry access:

```bash
npm install
npm run typecheck
npm test
npm run build
```

The repair environment could not complete `npm install` because its package registry repeatedly timed out/returned HTTP 503 for packages including `@google/genai` and `@tailwindcss/vite`. Therefore, a full dependency-backed build is not claimed here.

## Runtime modes

- Sandbox: `VITE_USE_MOCKS=true`; practice data stays in browser-local mock storage and production APIs are not called.
- Live: `VITE_USE_MOCKS=false`; configure Gemini, Firebase Web, and Firebase Admin credentials.
- Production readiness returns HTTP 503 with `status: "misconfigured"` when required server credentials are absent.


## v1.0.9-part2fix.2 closing-answer repair

- Fixed the race where Gemini Live `turnComplete` can arrive before the final output-transcription chunk containing the stored Part 2 closing question.
- The closing-answer manual activity is armed only after both signals are observed, regardless of arrival order.
- Added a 20-second safety close for the brief Part 2 follow-up activity.
- TypeScript syntax transpilation passed for 61 TypeScript/TSX files.
- Relative import resolution check passed.
- Full dependency-backed `npm run typecheck`, `npm test`, and `npm run build` could not be completed in this environment because dependency restoration failed with an npm registry 404 for `yargs-parser`.
