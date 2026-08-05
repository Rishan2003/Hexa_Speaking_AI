
## v1.1.7-vercel-bootstrap-fix — Vercel function 500 recovery
- Added a lightweight Vercel `/api/health` endpoint that does not initialize Firebase or Gemini dependencies.
- Added lightweight `/api/readiness` environment diagnostics.
- Replaced top-level async Express initialization with a lazy request handler.
- Lazy-loaded the Gemini Live SDK and evaluation pipeline only on routes that need them.
- Changed the API rewrite to a named wildcard so the original API path can be recovered reliably.
- Improved the practice setup error panel so API 500/503/bootstrap failures are not mislabeled as microphone permission problems.

# Changelog

## v1.1.4 — Gemini 3 Evaluation Migration
- Migrated post-test IELTS evaluator from legacy Gemini 2.5 models to `gemini-3.6-flash`, with `gemini-3.5-flash` as the full-quality fallback.
- Automatically remaps stale Gemini 2.0/2.5 evaluation model values from older `.env.local` files.
- Expanded provider-unavailable detection for the "no longer available to new users" 404 response.
- Removed deprecated sampling configuration from the structured evaluation request.
- Results metadata records the model that actually generated the evaluation.

# Sign-out UI update

- Added desktop and mobile sign-out controls.
- Added confirmation dialog and active-practice warning.
- Uses existing Firebase Auth logout path and redirects to `/login`.
- Clears temporary authenticated recovery/lease/pending-write browser data while preserving device preferences.
- No speaking, Part 2 timing, question-bank, or evaluation logic changed.

# v1.0.9-part2fix.2

- Fixed Part 2 brief closing-question answer getting stuck after the 120-second long turn.
- Closing-answer activity is now race-safe when Gemini sends `turnComplete` before final output transcription.
- Added a 20-second manual-turn fail-safe for the brief closing answer.
- Main long-turn pause immunity remains unchanged.

# Changelog

## 1.0.5 — Voice pipeline repair

- Unlocks the browser `AudioContext` synchronously from the Start Practice gesture.
- Uses the device-native audio rate and resamples microphone PCM to 16 kHz.
- Keeps PCM processing alive through a silent gain sink without microphone echo.
- Moves Gemini ephemeral-token WebSockets from `v1alpha` to required `v1beta`.
- Sends typed/control turns through `realtimeInput.text` for Gemini 3.1 Live.
- Reports browser-blocked playback and corrects the microphone level display.
- Defaults to real voice mode and ignores the stale pre-1.0.5 mock-mode browser flag.

# CHANGELOG - SpeakReady IELTS

## 1.0.4 - Gemini Live voice flow fix

- Fixed a stale React closure that kept the microphone PCM callback permanently seeing the initial `disconnected` state, preventing all candidate audio from reaching Gemini.
- Added an internal post-setup control turn so the examiner speaks first instead of waiting indefinitely for candidate input.
- Added actual microphone sample-rate normalization to 16 kHz signed PCM before Live API transmission.
- Passed the server-provided output sample rate into playback instead of hard-coding 24 kHz.
- Cleared queued examiner audio when Gemini reports an interruption.
- Added a clear microphone-open failure instead of continuing with a silent session.
- Added a provider test proving the internal opening turn triggers generation without creating a fake candidate transcript.

## 1.0.3 - Clean CommonJS server bundle

- Moved mock storage keys into `src/config.shared.ts`, a runtime-neutral module.
- Removed the Node server's transitive dependency on browser-only `src/config.ts`.
- Eliminated the esbuild warning that `import.meta` is empty in CommonJS output.
- Kept Vite environment access in the browser bundle, where `import.meta.env` is supported.

## 1.0.2 - TypeScript compatibility fix

- Converted Gemini `newSessionExpireTime` to an ISO timestamp string.
- Replaced the string literal `AUDIO` with `Modality.AUDIO` in the constrained Live configuration.
- Added an explicit `BrowserEnv` type for guarded Vite environment access in shared browser/server configuration.

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.1] - 2026-07-22

### Fixed
- Made sandbox mode fully local and prevented Firebase/API calls when the runtime sandbox toggle is enabled.
- Unified the local session storage key and restored sessions from Firestore or the consistent local recovery mirror.
- Added real authenticated recording deletion and recursive practice-data deletion.
- Removed fabricated audio retry uploads and exposed honest recording-retry limitations.
- Added true Part 3 snapshot support and corrected Part 2/Part 3 starting modes in sandbox and live flows.
- Added part-specific Live examiner connections and connection rotation across full mock sections.
- Corrected Part 2 preparation/speaking state transitions and the two-minute completion path.
- Prevented live API failures from silently generating fake scores.
- Marked pronunciation as not assessed because recording bytes are not yet attached to the grading request.
- Added durable-evaluation save failure handling, stricter production readiness, ownership checks, CSP hardening, and server-side non-Firebase development persistence.

## [1.0.0] - 2026-07-22

### Fixed
- Loaded `.env.local` and `.env` before importing server modules that read environment variables.
- Replaced permanent Gemini API-key exposure with single-use ephemeral Live tokens.
- Updated the Gemini Live WebSocket endpoint, audio payload, transcription fields, setup handshake, and default model.
- Corrected Firebase Admin credential detection and added service-account JSON/base64 support.
- Required authentication and ownership checks for Firebase-backed sessions and evaluations.
- Fixed the hanging OpenAI placeholder route, browser `process` references, reconnect lifecycle, and stale configuration names.
- Updated tests, PWA cache version, environment examples, and deployment documentation.

---

## [0.17.0] - 2026-07-22

### Added
- **Production PWA, Environment Validation & Deployment Protocol Milestone**:
  - **Progressive Web App (PWA) Manifest & Service Worker**:
    - Created `public/manifest.json` with standalone mode, theme color `#4f46e5`, background color `#0f172a`, and vector app icon `public/icon.svg`.
    - Created `public/sw.js` conservative service worker caching static app shell assets while strictly excluding API calls (`/api/*`), WebSockets (`wss://`), Auth tokens, transcripts, and audio recordings.
    - Updated `index.html` with theme-color meta tag, manifest links, Apple touch icon, and Service Worker registration over HTTPS.
  - **Isomorphic Environment Validation & Readiness API**:
    - Created `src/services/envValidation.ts` for environment variable inspection.
    - Added `GET /api/readiness` endpoint returning system readiness (`ready` vs `degraded_sandbox`), Gemini API key status, model aliases, and CORS origin setup without exposing secrets or keys.
    - Added CORS header handling for `ALLOWED_ORIGINS` with HTTP OPTIONS preflight handling in `server.ts`.
  - **Production Release & Rollback Checklist (`RELEASE_CHECKLIST.md`)**:
    - Documented pre-deployment environmental requirements, HTTPS smoke testing protocol (Microphone precheck, Gemini Live WebSockets, persistence, server evaluation, privacy purge), and Cloud Run rollback command sequence.
  - **Environment Example File (`.env.example`)**:
    - Updated `.env.example` with Gemini API key, Gemini Live model, Gemini evaluation model, Allowed CORS origins, Firebase Admin credentials, and Vite Firebase client keys.

---

## [0.16.0] - 2026-07-22

### Added
- **Dedicated Resilience & Security Milestone**:
  - **Server Rate Limiting & Quotas (`src/services/serverLimitsService.ts`)**:
    - Implemented endpoint rate limiter (`checkEndpointRateLimit`, max 30 requests per minute) returning HTTP 429 with abuse-safe generic messages.
    - Implemented server-side per-user daily quotas (`checkAndIncrementUserLimit`): 15 practice sessions, 20 ephemeral session tokens, and 10 evaluation requests per 24 hours.
  - **Safe Structured Server Logging (`src/services/serverLogger.ts`)**:
    - Structured JSON logs containing `requestId`, `sessionId`, `userId`, `provider`, `action`, `latencyMs`, and `errorCategory` while strictly redacting API keys, secrets, and raw audio streams.
  - **Security Headers & CSP (`server.ts`)**:
    - Added `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`, and `Referrer-Policy` security middleware.
  - **Security Rules & Limits Unit Test Suite (`src/tests/securityRules.test.ts`)**:
    - Added 12 automated unit tests validating Firestore/Storage security rules, rate limit enforcement, and per-user daily quotas.
  - **Text Sanitization (`src/utils/sanitize.ts`)**:
    - Added HTML/script tag stripping helper for user notes, transcripts, and custom feedback fields.
  - **Privacy Settings View (`src/components/PrivacySettingsView.tsx`)**:
    - Added dedicated `/privacy` view explaining stored data, active/inactive recording consent toggle, encrypted storage paths, and one-click data purge options.
  - **Admin Diagnostics View (`src/components/AdminDiagnosticsView.tsx`)**:
    - Added restrictive admin-only route (`/admin` & `GET /api/admin/diagnostics`) displaying system uptime, session counts, error rates, and security status without exposing private transcripts or user audio files.
  - **Session Cleanup & Audio Disconnecting**:
    - Integrated explicit `audioController.dispose()` and voice provider teardown on session teardown, tab locks, or idle timeout.

---

## [0.15.0] - 2026-07-22

### Added
- **Accessible Practice Evaluation Results Page (`src/components/ResultsView.tsx`)**:
  - Implemented prominent hero section with estimated practice band score (e.g. `7.5`), practice band range (e.g. `7.0 - 7.5`), and AI confidence percentage without fake precision.
  - Implemented 4 core criterion cards for Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, and Pronunciation.
  - Added explicit "Not Assessed" presentation callout for Pronunciation when raw audio evidence is missing or consent was inactive, explaining why pronunciation was omitted from overall band calculation.
  - Safely rendered transcript evidence and verified quotes as plain text (never injected HTML).
  - Implemented Strong Moments (Strengths) and Highest-Priority Improvements sections.
  - Added responsive comparison tables for Grammatical Range & Accuracy corrections (original vs. standard syntax) and Vocabulary/Collocation Upgrades (original vs. Band 8.0+ phrases).
  - Added Pronunciation Observations panel covering intelligibility, rhythm, stress, connected speech, and problem words list when assessed.
  - Created interactive 7-Day Micro-Practice Plan checklist with toggleable completion states.
  - Added comprehensive state management handling Loading, Processing (`queued`/`processing`), Failed + Retry (`failed`), Incomplete Session (`incomplete`/`abandoned`), and Deleted/Not Found Session views.
  - Included official IELTS legal disclaimer and full session metadata audit bar.
- **Unit Tests for Evaluation Results UI (`src/tests/resultsView.test.ts`)**:
  - Added unit tests for band formatting, pronunciation rule rendering, and seeded session retrieval.

---

## [0.14.0] - 2026-07-22

### Added
- **Authenticated Server-Side Post-Test Evaluation Pipeline (`src/services/serverEvaluationPipeline.ts`)**:
  - Moved all post-test evaluation logic from client browser to secure server Express endpoints (`POST /api/evaluations/generate` & `GET /api/evaluations/:sessionId`).
  - Configured `@google/genai` Gemini SDK with structured JSON output matching `IELTS_EVALUATION_RESPONSE_SCHEMA`.
  - Configured model identifier via `process.env.GEMINI_EVALUATION_MODEL || 'gemini-2.5-flash'` with automatic fallback.
  - Implemented runtime schema validator and repair function (`validateAndRepairEvaluation`) ensuring score bounding (1.0 to 9.0 in 0.5 increments), overall practice band calculations, and mandatory disclaimer inclusion.
  - Enforced strict **Pronunciation Evidence Rule**: If usable raw audio evidence is absent (`hasAudioEvidence = false`), pronunciation MUST be marked `not_assessed`, `score = 0`, with explicit feedback that raw audio was unavailable. Pronunciation score is omitted from overall band calculation.
- **Server Rate Limiting & Audit Usage Logging**:
  - Implemented per-user sliding window rate limiting (max 10 evaluation requests per user per hour window).
  - Recorded structured `usageEvents` to Firestore or server log for auditing and tracking.
- **Client API Service & Results View Integration (`src/services/evaluationApiService.ts` & `src/components/ResultsView.tsx`)**:
  - Created client API proxy service passing authenticated Firebase ID Tokens or mock tokens.
  - Updated `PracticeSessionView` to trigger server-side evaluation pipeline upon session completion.
  - Updated `ResultsView` to cleanly display `Not Assessed` badge for pronunciation when audio is absent, and added a **Re-evaluate Session** action button.
- **Automated Pipeline Unit Test Suite (`src/tests/serverEvaluationPipeline.test.ts`)**:
  - Added 6 comprehensive unit tests verifying score clamping, pronunciation rule enforcement with/without audio, disclaimer presence, rate limiting boundaries, and pipeline execution idempotency.

---

## [0.13.0] - 2026-07-22

### Added
- **Hardened Session Persistence Architecture (`src/services/firebaseRepository.ts` & `src/services/persistenceQueue.ts`)**:
  - Implemented client-generated `eventId` values (`evt-*`) as document keys for subcollection turns (`speakingSessions/{sessionId}/turns/{turnId}`).
  - Applied transactional idempotency via `setDoc(turnRef, firestoreTurn, { merge: true })`, ensuring network retries never produce duplicate turn records.
  - Added `FirebaseRepository.restoreFullSessionState(sessionId)` to reconstruct state from session, part, and turn subcollections, deduplicating turns by `eventId` and sorting them sequentially.
  - Added `persistenceQueue.reconcileTranscript(sessionId, currentTranscript)` to merge unsaved local queue turns with cloud transcripts without duplicates.
  - Enforced explicit session status rules (`completed`, `abandoned`, `failed`, `incomplete`, `active`) across Firestore updates and `MockPracticeService`.
- **Optional Private Audio Recording Upload (`src/services/recordingUploadService.ts`)**:
  - Checked explicit consent active flag (`consentActive === true`) before initiating audio recording upload.
  - Safe post-session upload to private Cloud Storage path `speaking-recordings/{uid}/{sessionId}/{recordingId}.webm`.
  - Saved provider metadata (`providerName`, `modelAlias`, `transport`, `sampleRate`) concisely on session records without secret keys or tokens.
  - Enforced private ownership via Storage rules (`request.auth.uid == uid`).
- **Resilient Upload UI Controls (`src/components/ResultsView.tsx`)**:
  - Interactive Recording Status Card displaying private upload path and status badges.
  - Error banner on upload failure providing **Retry Upload**, **Continue Without Audio**, and **Delete Recording** actions.
  - Guaranteed that completed exam sessions and evaluation reports remain 100% valid even if recording upload fails.
- **Automated Unit & Integration Test Suite (`src/tests/sessionPersistenceAndRecording.test.ts`)**:
  - Added 9 unit tests verifying idempotent turn writes, queue reconciliation, status mappings, consent guards, private path formatting, and upload failure fallback behaviors.

---

## [0.12.0] - 2026-07-22

### Added
- **Full Mock Exam Orchestration Across Parts 1, 2, and 3**:
  - Unified practice exam flow across all three parts consecutively without showing intermediate feedback or scores.
  - Used single immutable `SelectedTestSnapshot` with mode `full` for deterministic exam execution.
  - Enforced neutral transitions between sections and overall duration tracking (<13:30) to prevent Live session 15-minute boundary expiration.
- **Multi-Tab Session Concurrency Control (`src/services/sessionLease.ts`)**:
  - Implemented `SessionLeaseManager` with heartbeat intervals and storage event listeners to lock secondary browser tabs from modifying active practice sessions.
  - Visual lock banner in `PracticeSessionView` alerting users when controls are locked in secondary tabs.
- **Enhanced Network Resilience & Unrecoverable Failure Handling**:
  - Dedicated `RECOVERING` state view with automatic reconnection attempts and manual retry controls.
  - Added explicit "Save Incomplete Session" option on connection or hardware failure (`FAILED`), preserving transcript logs without losing student data.
- **End-to-End Test Suite (`src/tests/fullMockOrchestration.test.ts`)**:
  - Added 6 comprehensive integration tests verifying:
    1. Complete full test execution across Parts 1, 2, and 3 without intermediate score overlays.
    2. Page refresh and exact state recovery across Part 1, Part 2 Prep, Part 2 Long Turn, and Part 3.
    3. Temporary network loss (`DISCONNECT`), `RECOVERING` state, and resumption from last unanswered question upon reconnection.
    4. Duplicate event delivery protection.
    5. Clean session failure / abandonment with full transcript preservation.
    6. Multi-tab lease acquisition and locking with `SessionLeaseManager`.

## [0.11.0] - 2026-07-22

### Added
- **Theme-Linked Part 3 Two-Way Discussion Implementation**:
  - Consumed theme-linked abstract discussion questions (`part3Questions`) directly from `SelectedTestSnapshot`.
  - Implemented `PART3_ASKING`, `PART3_LISTENING`, and `PART3_COMPLETED` state machine transitions in `examEngineReducer`.
  - Added `buildPart3SystemInstruction` in `examinerPrompts.ts` enforcing official IELTS examiner conduct: transition statement linking to Part 2 cue card theme, asking exact stored questions sequentially, constrained neutral follow-ups, and no mid-exam coaching or scoring.
  - Implemented candidate speech start (barge-in) detection in Part 3 without skipping questions.
  - Added session recovery logic recalculating `currentPart3QuestionIndex` from completed question IDs matching Part 3 snapshot IDs, guaranteeing exact resumption at the unanswered question.
  - Recorded exact `questionId` references on all Part 3 speech chunks and persisted turns via `persistenceQueue`.
  - Unit tests in `src/tests/examEngine.test.ts` verifying standalone Part 3, barge-in handling, and exact question restoration.

## [0.10.0] - 2026-07-22

### Added
- **Full Part 2 Cue Card & Preparation/Long-Turn Workflow**:
  - Implemented explicit Part 2 state machine transitions (`PART2_INSTRUCTIONS`, `PART2_PREPARATION`, `PART2_LONG_TURN`, `PART2_CLOSING`, `PART2_COMPLETED`).
  - Added `buildPart2SystemInstruction` in `examinerPrompts.ts` with strict examiner instructions, cue card reveal, and 2-minute polite neutral interruption.
  - Built cue card visual display and 60-second preparation countdown timer with "Start Speaking Now" manual trigger.
  - Implemented private draft notes pad (`part2Meta.notes`), isolated from spoken audio transcripts.
  - Added non-distracting long-turn milestone indicators at 1:00 and 1:45/2:00.
  - Added wall-clock timestamp recalculation (`prepStartTime`, `longTurnStartTime`) ensuring accurate timer restoration upon session reconnection.
  - Unit tests verifying notes isolation, manual early start, interruption markers, and timer accuracy across reconnections.

## [0.9.0] - 2026-07-22

### Added
- **Integrated Part 1 Practice Architecture**: Connected the deterministic IELTS state engine, `GeminiLiveAdapter`, audio controller (`useAudioController`), and Firestore persistence queue (`persistenceQueue`) into `PracticeSessionView`.
- **Strict IELTS Examiner System Instructions (`src/services/examinerPrompts.ts`)**: Built `buildPart1SystemInstruction` to configure Gemini as an official IELTS Speaking examiner. Enforces strict examiner behavior: brief neutral greeting, asking exact snapshot questions sequentially, minimal acknowledgements, no coaching or scoring mid-exam, and safe turn management.
- **Resilient Firestore Persistence Queue (`src/services/persistenceQueue.ts`)**: Implemented idempotent, sequence-tracked Firestore turn saving with a local `localStorage` retry queue to survive network glitches and page reloads.
- **Enhanced UI Controls & Session Management**:
  - Continuous session timer (`MM:SS`).
  - Active topic display and real-time mic input volume level meter.
  - Mic mute toggle button using `useAudioController`.
  - End Session modal triggering graceful session abandonment (`ABANDONED`) without generating partial/unearned band scores.
- **Updated State Machine & Data Models**: Updated `SpeechChunk` and `examEngine` with complete persistence metadata (`sequence`, `eventId`, `startTime`, `endTime`, `questionId`, `interrupted`).

## [0.8.0] - 2026-07-22

### Added
- **Production `GeminiLiveProvider` (`src/realtime/geminiLiveAdapter.ts`)**: Encapsulated WebSocket communication to Gemini Live API behind the provider-neutral `RealtimeVoiceProvider` contract. Operates over browser-to-Gemini WebSockets utilizing ephemeral credentials minted from `POST /api/session/mint`.
- **Event Normalization & Event Contract**: Normalized examiner speech audio output (24kHz PCM), examiner output transcription, candidate input transcription, turn completion states, model token usage metadata, server warnings, and interruption signals (`onInterrupted`).
- **Interactive Provider Diagnostics Panel (`src/components/ProviderDiagnosticsPanel.tsx`)**: Built a development-only live inspector panel displaying provider status, model/voice configuration, 15-minute audio session duration boundary timer, packet/token counters, real-time transcript stream feed, filterable raw event log console, manual reconnect/disconnect actions, and interruption toggling. Integrated directly into `PracticeSessionView`.
- **Unit Test Suite (`src/tests/geminiLiveProvider.test.ts`)**: Created 6 automated unit tests covering ephemeral credential fetching, setup payload structure, PCM audio chunk base64 encoding, normalized server message dispatching, interruption signal handling, diagnostics snapshot state, and clean teardown.

---

## [0.7.0] - 2026-07-22

### Added
- **Typed Browser Audio Controller (`src/services/audioController.ts`)**: Built `BrowserAudioControllerService` implementing safe microphone media requesting/releasing, device enumeration, live input volume level metering without audio persistence, and mute/unmute toggles without session teardown.
- **Remote Examiner Audio Queue Playback**: Added a controlled Web Audio API queue that schedules incoming 24kHz/16kHz PCM audio chunks sequentially (`nextScheduledTime`) to eliminate clipping, gaps, and overlapping speech.
- **Mobile AudioContext Resumption**: Implemented automatic touch/click gesture listeners to handle mobile Safari/Android Chrome AudioContext suspension rules.
- **Optional Local Session Recording**: Built local recording using `MediaRecorder` with WebM/Opus feature detection and fallback, activated strictly when `userConsentForRecording` is true. Features local blob URL generation, playback review player, and memory release on delete.
- **React Hook & Interactive Panel (`src/services/useAudioController.ts` & `src/components/AudioControllerPanel.tsx`)**: Created reusable React hook and setting panel for real-time microphone metering, device selection, remote queue testing, and recording review. Integrated into `SettingsView`.
- **Unit Test Suite (`src/tests/audioController.test.ts`)**: Added 5 comprehensive automated unit tests verifying device state logic, recording consent guardrails, mute toggling, queue clearing, and cleanup on disposal.

---

## [0.6.0] - 2026-07-20

### Added
- **Real Dashboard Experience (src/components/DashboardView.tsx)**: Fully replaced mock-only dashboard structures with dynamic Firebase data-driven components. Includes a Welcome card displaying target band and optional exam date, a dynamic Weakest Criterion recommender, an estimated score disclaimer, and a recent completed session review card with detailed criteria indicators.
- **Microphone precheck & Calibration (src/components/PracticeSetupView.tsx)**: Implemented highly polished, resilient precheck components. Dynamically lists available input media devices, features a live sound level meter using Web Audio API, supports a 3-second recording/playback test, and displays helpful recovery guides for security constraints (HTTPS) or denied permissions.
- **Secure Server-Side Session Creation**: Connected Setup wizards to the HTTP POST `/api/session/create` endpoint. Obtains ephemeral client ID tokens via Firebase, seeds reproducible secure snapshots on the server, and persists them into Firestore before triggering navigation state changes.
- **Isomorphic Local Synchronization**: Configured setup wizards to feed new sessions into the offline local mock storage seamlessly to guarantee absolute routing and state compatibility across both Firebase and Sandbox modes.

## [0.5.0] - 2026-07-17

### Added
- **Explicit Imperative Route Guards**: Implemented explicit user onboarding validation inside `handleSignIn`, `handleSignUp`, and `handleQuickLogin` in `/src/components/LoginView.tsx`. Directs newly created or non-onboarded accounts to `/onboarding` and fully onboarded accounts directly to `/dashboard`.
- **Automated Sandbox Provisioning**: Upgraded `handleQuickLogin` in `/src/components/LoginView.tsx` so that when a preset credentials sign-in fails due to an unprovisioned account, it automatically triggers `signUp(emailPreset, 'password123')` and immediately log the user in.
- **Unmasked Real Database Errors**: Patched `/src/services/authContext.tsx` error handlers in both `signIn` and `signUp` functions. Authenticator filters standard client-side validation codes (`auth/*`) to present polite messages, while allowing true backend database or configuration failures (e.g., Firestore permission errors) to propagate unmasked for diagnostics.

## [0.4.0] - 2026-07-17

### Added
- **Deterministic IELTS Speaking Question Bank**: Created `/src/services/questionBank.ts` with over 8 Part 1 topic groups (5-7 questions each), 12 Part 2 cue cards, and linked Part 3 theme questions (explanation, comparison, causes, effects, future speculation).
- **Mulberry32 Random Generator**: Integrated deterministic seeded selection logic using a pseudo-random number generator to guarantee reproducible snapshot results given the same input seed.
- **Server-Only Session Creation Endpoint**: Implemented secure `POST /api/session/create` in `/server.ts` to generate, validate, and persist immutable `selectedTestSnapshot` collections to Firestore.
- **Immutable Snapshot Rules Protection**: Updated `/firestore.rules` to write-protect `selectedTestSnapshot` fields on the client-side, preventing students from injecting custom scoring guides or modifying questions midway.
- **Mock Integration**: Fully integrated `questionBank` and `generateTestSnapshot` into the local `MockPracticeService` in `/src/services/mockService.ts` to ensure consistent and high-quality cue-card data when offline.
- **Unit Test Suite**: Developed `/src/tests/questionBank.test.ts` to test deterministic reproducibility, correct exam part composition, active-only content validation, and absence of duplicate questions within generated tests.

## [0.3.0] - 2026-07-17

### Added
- **Global Auth Provider**: Created `/src/services/authContext.tsx` implementing a unified React Context for authentication. Seamlessly bridges Firebase Auth state changes with active local Firestore profile synchronizations, and falls back to a sandbox state when Firebase is disabled.
- **Onboarding Experience Form**: Developed `/src/components/OnboardingView.tsx` supporting candidate name, native language, target IELTS band, current self-estimated band, date of exam, and timezone resolution. Includes a live browser microphone test and sound calibration bar, with explicit GDPR consent toggle.
- **Route Guards & Navigation Protection**: Enhanced `/src/components/NavigationShell.tsx` to actively intercept routes. Redirects unauthenticated users to `/login` (preserving target path), and redirects completed sign-ups to `/onboarding` if profile setup has not been finished.
- **Login Credentials Console**: Redesigned `/src/components/LoginView.tsx` with high-contrast UI, fully accessible form fields, and client-side sandbox helper logs.
- **Profile Preference Panel**: Configured `/src/components/SettingsView.tsx` to tie profile fields, target bands, timezones, and GDPR recording consents directly to the authenticated database model.
- **Test-Suite Isolation**: Patched firebase server and client initialization routines in `/src/services/` to respect `process.env.VITEST`. Ensures 100% test suite independence and offline speed by avoiding unwanted API endpoints during test runs.

## [0.2.0] - 2026-07-17

### Added
- **Client-Side Firebase Module**: Created `/src/services/firebaseClient.ts` containing safe client initialization, isomorphic fallback mode, and strong types with converters for all 11 required collections.
- **Server-Side Firebase Admin Module**: Created `/src/services/firebaseServer.ts` with error-tolerant initialization, type safety, and a deep recursive session purger that deletes subcollections and audio recording assets from Cloud Storage.
- **Security Rules Configuration**: Created `/firestore.rules` and `/storage.rules` establishing strict, deny-by-default security configurations.
- **Idempotent Data Repository**: Developed `FirebaseRepository` inside `/src/services/firebaseRepository.ts` implementing client-generated idempotent IDs for speech turn events.
- **Automated Tests Suite**: Added `/src/tests/firebaseServer.test.ts` to test client fallbacks and server deletion mechanisms.
- **Environment Variables**: Documented Firebase public and secret environment variables in `/.env.example`.

## [0.1.0] - 2026-07-17

### Added
- **Repository Memory Base**: Created `GEMINI.md`, `PROJECT_MEMORY.md`, `DECISIONS.md`, `CHANGELOG.md`, and `BUILD_STATUS.md`.
- **Architectural Specifications**: Documented standard full-stack React/Express + Firebase structure.
- **Milestone Blueprint**: Formulated a 21-step incremental development plan to take the product from scratch to fully verified production-ready release.
- **Risk Mitigation Registry**: Identified and logged crucial mitigation tactics for microphone permissions, 15-minute live boundaries, Firestore idempotency, and GDPR-compliant recording consent.
- **Project Metadata Configuration**: Configured initial app metadata, including descriptive naming and security/permission settings (microphone).
## v1.1.5-vercel-ready — Vercel deployment architecture
- Exported the Express app from `server.ts` so Vercel can run it as a single Vercel Function.
- Prevented the app from opening its own listener when `VERCEL` is present.
- Moved source static assets to `static/` and configured Vite to emit the deployable frontend to `public/` for Vercel CDN hosting.
- Added Vercel SPA rewrites for login, onboarding, dashboard, practice, results, history, and settings deep links.
- Added Vercel-safe environment examples, deployment documentation, cache headers, and `.vercelignore`.
- Kept local Express + Vite development and local production startup working.
- Verification: TypeScript pass, 91/91 tests pass, production build pass, `/api/health` smoke test pass.
