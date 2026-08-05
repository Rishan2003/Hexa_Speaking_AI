## v1.0.3 CommonJS build-warning repair

The browser configuration module uses `import.meta.env`, which is correct for Vite but unsupported in a CommonJS server bundle. The server reached that module only because `mockService.ts` imported two local-storage key constants from it. Those constants now live in `src/config.shared.ts`; both browser and mock code import the neutral module, while the Node server no longer bundles `src/config.ts`.

# SpeakReady IELTS repair report

Repair date: July 22, 2026

## Major repaired defects

### Startup and configuration

- Environment variables are loaded before modules that inspect them.
- Firebase Admin no longer treats browser configuration or a project ID alone as server credentials.
- Server supports service-account JSON, base64 JSON, separate fields, and Application Default Credentials.
- `PORT`, production readiness, CORS, request limits, and CSP behavior are explicit.

### Authentication and private data

- Session creation, Gemini token minting, evaluation generation, evaluation retrieval, and privacy operations validate authenticated ownership.
- The sandbox admin credential is unavailable in production.
- Permanent Gemini keys are not sent to the browser.
- Privacy buttons now delete actual owned data instead of logging fake success.

### Gemini Live

- Uses constrained, single-use ephemeral tokens.
- Waits for `setupComplete` before audio streaming.
- Uses current audio/transcription message shapes.
- Handles stale sockets, bounded reconnects, session resumption, and safe connection rotation.
- Uses the correct examiner prompt for Part 1, Part 2, or Part 3.

### Practice session flow

- Fixed the mismatched local-storage key that caused newly created sessions to disappear.
- Firestore restoration and local recovery now use a consistent session object.
- Sandbox mode immediately stays local even when Firebase browser configuration exists.
- Part 3 is no longer stored as Part 2.
- Sandbox Part 2 and Part 3 sessions no longer start in Part 1.
- Full live mocks rotate examiner context between parts.
- Transcript turns are saved under their actual part.
- Part 2 preparation and two-minute paths no longer jump incorrectly to Part 3.

### Evaluation integrity

- Production API failures are surfaced rather than replaced with deterministic fake scores.
- Deterministic scoring remains limited to explicit non-production sandbox mode.
- A generated evaluation is not reported complete until durable storage succeeds.
- Pronunciation is `not_assessed` because the current model request contains transcript text but no audio bytes.

### Recording and privacy

- Upload size is limited consistently to 25 MiB.
- Failed recording retry no longer uploads a fabricated silent blob.
- Recording deletion removes owned Storage objects and metadata.
- Full practice-data purge recursively deletes sessions, subcollections, evaluations, feedback, usage events, limits, and orphaned recording files.

## Verification completed

- TypeScript syntax transpilation: 58 files, 0 diagnostics.
- Relative imports: 0 missing.
- JSON configuration parsing: passed.
- Secret-pattern scan: no embedded Google API key or private-key block.
- Local privacy/persistence harness: passed.
- Gemini Live setup/reconnect harness: passed.

## Verification not completed

A dependency-backed `npm install`, `npm run typecheck`, `npm test`, and `npm run build` could not be completed in the repair environment because its npm registry repeatedly timed out or returned HTTP 503. Run the commands in `BUILD_STATUS.md` on a machine with working registry access before deployment.

## 1.0.4 Live voice repair

The live session appeared connected but remained silent for two separate reasons: the long-lived audio callback captured the first-render `connectionStatus` value (`disconnected`), so it discarded every microphone chunk; and the model was never sent a completed client turn after setup, so it did not initiate the examiner greeting. Version 1.0.4 removes the stale-state gate, lets the provider validate readiness, sends a hidden opening control turn after `setupComplete`, resamples browser audio to 16 kHz PCM, and uses the received output sample rate for playback.
