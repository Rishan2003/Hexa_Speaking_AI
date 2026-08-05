# ARCHITECTURAL DECISIONS - SpeakReady IELTS

This log records the foundational architectural decisions for SpeakReady IELTS, their context, rationales, and alternatives considered.

---

## ADR 1: Full-Stack Express + React Structure
* **Status**: Approved
* **Context**: The app requires secure API key handling, server-minted session tokens, and proxy APIs, alongside a high-fidelity frontend with support for Web PWAs.
* **Decision**: We use a combined Express backend and Vite/React frontend in a single-container repository.
* **Rationale**:
  - Exposing high-privilege credentials like `GEMINI_API_KEY` to the client-side browser is a severe security violation.
  - Express serves as the perfect lightweight proxy to mint ephemeral tokens, validate Firebase auth headers, and execute final structured evaluation calls using `gemini-3.6-flash`.
* **Alternatives Considered**: 
  - Client-only SPA: Rejected due to API key security issues.
  - Next.js: Rejected to align precisely with standard React/Vite guidelines in this environment.

---

## ADR 2: Firebase Firestore & Authentication for Storage & Auth
* **Status**: Approved
* **Context**: User sessions, transcription histories, and structured score evaluations need long-term durable cloud storage to allow tracking progress over time.
* **Decision**: Use Firebase (Firestore and Auth) as the core backend storage engine.
* **Rationale**:
  - Auth is fully integrated, enabling quick verification of secure `/api/*` endpoints.
  - JSON-like document structure in Firestore perfectly aligns with the rich, complex nested output schema returned by the Gemini evaluations.
  - Real-time listeners allow the UI to receive status updates natively.
* **Alternatives Considered**:
  - LocalStorage-only: Rejected. Clearing browser cache would result in catastrophic data loss for students preparing for high-stakes exams.
  - PostgreSQL (Cloud SQL): Relational databases add unnecessary migration and connection pooling overhead for what is structurally a hierarchical document payload.

---

## ADR 3: Provider-Neutral `RealtimeVoiceProvider` Abstraction
* **Status**: Approved
* **Context**: Low-latency spoken conversational interfaces are a rapidly evolving landscape. Tying the application directly to the Gemini Live SDK limits future portability.
* **Decision**: Define a provider-neutral TypeScript contract (`RealtimeVoiceProvider`) and write a `GeminiLiveAdapter` to implement it, while leaving an `OpenAIRealtimeAdapter` stub disabled.
* **Rationale**:
  - Keeps the codebase modular, clean, and adaptable to other voice models (e.g., OpenAI Realtime API) with zero modifications to the core exam state machine and UI components.
  - Streamlines mocking and unit testing.
* **Alternatives Considered**:
  - Raw direct SDK bindings in React components: Rejected due to high code coupling and poor testability.

---

## ADR 4: Client-Driven Deterministic State Machine for IELTS
* **Status**: Approved
* **Context**: The IELTS Speaking test is highly structured and regulated by strict timing bounds (Part 1 is ~4-5m, Part 2 has exactly 1m prep + 1-2m speech, Part 3 is ~4-5m).
* **Decision**: Control the structure, parts, and transitions using a highly deterministic client-side state machine. Use timers and explicit state transitions to drive the examiner, rather than letting the AI decide when to move to the next part.
* **Rationale**:
  - LLMs can easily drift off-topic, forget instructions, skip exam sections, or end the interview too early.
  - Managing timing boundaries client-side ensures high-fidelity adherence to official IELTS standards.
  - It ensures we can cleanly disconnect the websocket, reset limits, and start a fresh 15-minute Gemini Live session for subsequent sections, preventing session timeouts.
* **Alternatives Considered**:
  - AI-directed transitions (allowing the examiner to say "Now let's move to Part 2"): Rejected due to high unpredictability and difficulty tracking exact seconds for student preparation times.

---

## ADR 5: Score Disclaimer & "Estimated Practice Band" Labeling
* **Status**: Approved
* **Context**: Presenting automated AI scores as official IELTS grades poses legal risks and can mislead users.
* **Decision**: All scores are explicitly labeled **"Estimated Practice Band"**, accompanied by clear, prominent disclaimers on every visual card, dashboard, and report view.
* **Rationale**:
  - Protects the product from liability.
  - Aligns with standard academic practices for practice tools.

---

## ADR 6: Deterministic Server-Only Speaking Session Snapshots
* **Status**: Approved
* **Context**: The application needs to ensure that students cannot cheat by injecting custom scoring instructions or changing question flows after the test starts, and that past session question texts remain immutable even if the master question bank is updated in future code changes.
* **Decision**: Move session initialization, seed-based question selection, and test snapshot generation to a secure server-side endpoint (`POST /api/session/create`).
* **Rationale**:
  - Ensures a standard student client cannot tamper with the exam flow.
  - Generates immutable snapshots storing exact question IDs and full question text strings directly on the session record.
  - Employs a reproducible pseudorandom number generator (Mulberry32) for deterministic seed-to-snapshot integrity.
  - Implements Firestore security rules to prevent client updates or deletions of the `selectedTestSnapshot` once written.
* **Alternatives Considered**:
  - Client-side snapshotting: Rejected because it allows clients to modify question contexts or scoring heuristics midway through the test.

---

## ADR 7: Transparent Database Error Exposure and Explicit Navigation Guards
* **Status**: Approved
* **Context**: Authentication and routing flows previously stalled on connection failures due to opaque generic errors, and navigated solely through passive observer listeners.
* **Decision**: 
  - Unmask and bubble non-auth errors (e.g. database uninitialized, Firestore permission denied) so developers and automated agents can diagnose cloud configurations instantly.
  - Implement explicit, imperative navigation inside all sign-in, sign-up, and quick sandbox login hooks checking onboarding profiles.
* **Rationale**:
  - Allows precise debugging of security rule violations and project setup states.
  - Mitigates visual stalls and makes navigation predictable.
  - Automates sandbox credentials provisioning on the fly to elevate developer ergonomics.

---

## ADR 8: Real Dashboard & Resilient Precheck Calibration
* **Status**: Approved
* **Context**: The app required a full integration with the real Firebase data layer on both the dashboard and the setup experience. Additionally, the setup experience needed to calibrating microphones and listing inputs while preventing premature websocket/Gemini connections.
* **Decision**: 
  - Build direct `FirebaseRepository` queries into the dashboard loading cycle, calculating average rubrics and dynamically suggesting practice guides based on the user's lowest-scoring criterion.
  - Separate hardware precheck completely from model connectivity. The setup panel lists inputs and executes a local 3-second recording/playback test using the Web Audio API, holding websocket creation until "Start" is explicitly triggered.
  - Write newly spawned server-side sessions back into local storage mock history as well to ensure total visual synchronization across both sandbox and Firebase modes.
* **Rationale**:
  - Provides highly engaging, personal, and actionable diagnostic recommendations.
  - Avoids hardware/permissions page crashes and prevents wasteful server token minting or active model socket connections during user configuration phases.
  - Guarantees backward and forward compatibility across mock states and real database integrations with no extra file updates.

---

## ADR 9: Browser Audio Controller & Web Audio Queue Architecture
* **Status**: Approved
* **Context**: Low-latency voice interaction requires safe microphone media capture, input meter monitoring, mute/unmute capability without dropping sessions, controlled remote examiner audio queue playback, and optional local recording without exposing raw audio data or leaking resources.
* **Decision**: 
  - Create `BrowserAudioControllerService` behind a strict typed `BrowserAudioController` interface in `src/services/audioController.ts` and React hook `useAudioController` in `src/services/useAudioController.ts`.
  - Handle mobile browser AudioContext resume requirements via touch/click window event listeners.
  - Implement a controlled audio queue scheduling PCM buffers sequentially (`nextScheduledTime = Math.max(now, nextScheduledTime) + duration`) to prevent gaps or overlapping examiner audio.
  - Require explicit user consent before initiating `MediaRecorder` for local audio review, using feature-detected WebM/Opus formats with graceful fallbacks.
  - Provide an interactive `AudioControllerPanel` in `SettingsView` allowing candidates to test input levels, microphone switching, mute toggles, remote audio queue playback, and local session recording.
* **Rationale**:
  - Encapsulates Web Audio API, getUserMedia, and MediaRecorder safely.
  - Prevents memory and resource leaks by stopping all tracks, nodes, timers, and object URLs on unmount/disposal.
  - Maintains strict privacy by never logging raw audio data.

---

## ADR 10: GeminiLiveProvider WebSocket Transport & Developer Diagnostics Panel
* **Status**: Approved
* **Context**: Low-latency voice exams require browser-to-Gemini WebSockets for low voice latency while keeping API keys hidden from the browser and giving developers deep observability into transport, barge-in, token usage, and session limit states.
* **Decision**: 
  - Build `GeminiLiveAdapter` (`GeminiLiveProvider`) implementing `RealtimeVoiceProvider`.
  - Fetch short-lived ephemeral tokens from `/api/session/mint` to authenticate browser-to-Gemini Live WebSockets without exposing `GEMINI_API_KEY`.
  - Normalize examiner speech output (24kHz PCM), examiner output transcription, candidate input transcription, turn completion states, model token usage metadata, server warnings, and interruption signals (`onInterrupted`).
  - Create a development-only `ProviderDiagnosticsPanel` displaying provider status, model/voice configuration, 15-minute audio session duration boundary timer, packet/token counters, real-time transcript stream feed, filterable raw event log console, manual reconnect/disconnect actions, and interruption toggling.
* **Rationale**:
  - Encapsulates WebSocket transport mechanics behind the provider-neutral interface.
  - Guarantees API key security via ephemeral token minting on the server.
  - Provides real-time developer observability for testing real-time voice sessions without exposing internal transport detail to end users.

---

## ADR 11: Part 2 Cue Card Preparation & Long Turn Execution Model
* **Status**: Approved
* **Context**: Part 2 requires a strict 60-second preparation phase with an explicit cue card display, typed notes canvas, explicit microphone behavior, and a 1-to-2 minute timed speaking long turn with polite neutral examiner interruption at 2:00.
* **Decision**:
  - Enforce explicit preparation states (`PART2_INSTRUCTIONS`, `PART2_PREPARATION`, `PART2_LONG_TURN`, `PART2_CLOSING`, `PART2_COMPLETED`) in `examEngineReducer`.
  - Isolate typed notes from the spoken transcript: notes are saved exclusively to `part2Meta.notes` and draft state, never emitted as speech chunks.
  - Control microphone state explicitly: muted during preparation, active during speaking.
  - Automatically start long turn upon student speech or explicit "Start Speaking Now" user trigger.
  - Provide non-distracting milestone indicators at 1:00 and 1:45/2:00, with polite examiner interruption at 2:00-2:10.
  - Accurately recalculate preparation and long-turn speaking elapsed times upon reconnection using wall-clock timestamps (`prepStartTime`, `longTurnStartTime`).
* **Rationale**:
  - Mirrors official IELTS examination procedures with exact temporal boundaries.
  - Ensures notes are private and preserved without contaminating exam speech transcripts.
  - Guarantees resilient timer state recovery across network drops or browser refreshes.

---

## ADR 12: Theme-Linked Part 3 Two-Way Discussion & Constrained Examiner Behavior
* **Status**: Approved
* **Context**: Part 3 of the IELTS Speaking exam requires abstract discussion linked logically to the Part 2 cue card theme. The examiner must ask stored questions in sequence, enforce neutral behavior without unscripted interviews or unsolicited coaching, and support smooth barge-in and session recovery.
* **Decision**:
  - Consume theme-linked Part 3 question snapshots (`part3Questions`) directly from `SelectedTestSnapshot`.
  - Enforce exact question asking in `examEngineReducer` and `MockRealtimeProvider` using `PART3_ASKING`, `PART3_LISTENING`, and `PART3_COMPLETED` state transitions.
  - Implement candidate speech start (barge-in) detection without skipping questions or incrementing question indices prematurely.
  - Recalculate `currentPart3QuestionIndex` upon session reconnection using `completedQuestionIds` matching Part 3 snapshot IDs, guaranteeing exact resumption at the unanswered question.
  - Attach question reference metadata (`questionId`) to every transcript speech chunk and persist turns via `persistenceQueue.saveTurn`.
* **Rationale**:
  - Prevents AI model drift or unscripted interview expansion.
  - Guarantees strict IELTS regulatory compliance and deterministic session state recovery across browser refreshes or network drops.

---

## ADR 13: End-to-End Full Mock Orchestration, Multi-Tab Session Lease & Unrecoverable Failure Options
* **Status**: Approved
* **Context**: The full practice exam requires seamless execution across Parts 1, 2, and 3 using a single immutable snapshot, strict session boundary management (<13:30), prevention of concurrent multi-tab session execution, and clean transcript preservation on failure or abandonment.
* **Decision**:
  - Orchestrate all 3 parts consecutively in `examEngineReducer` and `MockRealtimeProvider` without showing intermediate feedback or scores.
  - Enforce tab lease locking via `SessionLeaseManager` (using heartbeat & storage events) to prevent concurrent tabs from corrupting active exam states.
  - Monitor live audio session age with a non-intrusive warning near 12 minutes to finish clean before the 15-minute Live audio boundary limit.
  - Present explicit "Attempt Reconnection" and "Save Incomplete Session" options upon network or hardware failure, ensuring transcripts are saved without data loss.
  - Add end-to-end integration tests in `src/tests/fullMockOrchestration.test.ts` covering happy path completion, page refreshes across all 3 parts, network drops, duplicate event delivery, and multi-tab locking.
* **Rationale**:
  - Prevents race conditions and duplicate event delivery from concurrent browser tabs.
  - Preserves student progress and transcript logs even during unexpected network drops or hardware disconnects.

---

## ADR 14: Hardened Session Persistence & Optional Private Recording Upload
* **Status**: Approved
* **Context**: Session persistence requires strict transactional idempotency, state restoration across subcollections, reconciliation of local pending write queues, and optional user audio recording upload without exposing private user audio or losing completed sessions when uploads fail.
* **Decision**:
  - Implement client-generated `eventId` values (`evt-*`) as document keys for turns in subcollections, ensuring `setDoc(turnRef, firestoreTurn, { merge: true })` writes are fully idempotent without duplicate records.
  - Implement `FirebaseRepository.restoreFullSessionState(sessionId)` to fetch session, parts, and turns subcollections, deduplicate turns by `eventId`, and sort them sequentially.
  - Implement `persistenceQueue.reconcileTranscript(sessionId, currentTranscript)` to merge local unsaved write queue turns after reconnect without duplicates.
  - Require explicit user consent active flag (`consentActive === true`) before uploading audio recordings to private Cloud Storage path `speaking-recordings/{uid}/{sessionId}/{recordingId}.webm`.
  - Store non-sensitive provider metadata (`providerName`, `modelAlias`, `transport`, `sampleRate`) concisely without credentials or secret tokens.
  - Save recording metadata status (`uploading`, `uploaded`, `failed`, `skipped`, `deleted`) on session documents.
  - Provide interactive UI controls in `ResultsView` allowing students to **Retry Upload**, **Continue Without Audio**, or **Delete Recording** while keeping the completed exam session and evaluation report 100% valid.
* **Rationale**:
  - Eliminates duplicate turn bugs during network retry loops.
  - Protects student privacy with strict Storage rules (`request.auth.uid == uid`).
  - Guarantees that network errors during post-exam audio recording upload never invalidate or delete the student's completed exam evaluation.

---

## ADR 16: Accessible Practice Evaluation Results Page & Multi-State Presentation
* **Status**: Approved
* **Context**: IELTS candidate results page requires an accessible, responsive, full-fledged presentation of overall estimated practice band, individual criteria cards, transcript evidence, strengths, priority improvements, grammar corrections, vocabulary collocations, pronunciation observations, practical 7-day micro-practice plan, disclaimers, metadata, and state handling (loading, processing, failed, retry, incomplete session, deleted session).
* **Decision**:
  - Enhance `src/components/ResultsView.tsx` with responsive layout (fully readable down to 360px mobile width and up to desktop).
  - Prominently display overall estimated practice band score, band range (e.g. `7.0 - 7.5`), and confidence percentage without fake precision.
  - Implement 4 core criterion cards for Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, and Pronunciation.
  - Explicitly display a "Not Assessed" callout and badge for Pronunciation when raw audio recording evidence is missing or consent was inactive, explaining why it was omitted from overall practice band calculation.
  - Safely render transcript quotes and evidence as plain text (never injected HTML).
  - Provide structured side-by-side / stacked sections for Strong Moments (Strengths) and Highest-Priority Improvements.
  - Display responsive tables for Grammatical Corrections (original vs. standard accuracy) and Vocabulary Upgrades (original vs. Band 8.0+ collocations).
  - Include a 7-day micro-practice plan checklist with interactive goal completion toggles.
  - Handle all lifecycle states cleanly: Loading screen, Server Processing indicator (`queued`/`processing`), Error & Retry banner (`failed`), Incomplete Session notice (`incomplete`/`abandoned`), and Deleted/Not Found Session card.
* **Rationale**:
  - Provides candidate-centric diagnostic feedback adhering to official IELTS assessment standards.
  - Guarantees screen-reader accessibility, semantic markup, and mobile responsiveness.
  - Prevents misleading candidates regarding official status with prominent disclaimers.

---

## ADR 17: Resilience, Rate Limiting, Security Rules & System Diagnostics
* **Status**: Approved
* **Context**: Production deployment requires server resilience against endpoint abuse, per-user daily resource quotas, security rules validation, structured logging without sensitive data leaks, data sanitization, privacy controls, and admin diagnostics.
* **Decision**:
  - Implement endpoint rate limiting (`checkEndpointRateLimit`, max 30 requests per minute) returning HTTP 429 with generic error messages.
  - Implement per-user daily resource quotas (`checkAndIncrementUserLimit`): 15 practice sessions, 20 ephemeral session tokens, 10 evaluation reports per 24 hours.
  - Inject HTTP security headers (CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`, `Referrer-Policy`) in `server.ts`.
  - Validate Firestore and Cloud Storage security rules via automated Vitest test suite (`src/tests/securityRules.test.ts`).
  - Strip HTML/script tags from user inputs using plain text sanitization (`src/utils/sanitize.ts`).
  - Add dedicated `/privacy` view for recording consent management and one-click data purge, and `/admin` diagnostics view for aggregate system health observability.
* **Rationale**:
  - Protects production container services against abuse and runaway costs.
  - Enforces privacy controls and transparency for student candidates.
  - Verifies database and storage isolation policies automatically in CI.

---

## ADR 18: Production PWA, Isomorphic Environment Validation & Deployment Protocol
* **Status**: Approved
* **Context**: Cloud Run deployment requires a production Progressive Web App (PWA) with conservative caching, environment variable validation, readiness endpoints, microphone permission prechecks on HTTPS, and release/rollback documentation.
* **Decision**:
  - Implement PWA web manifest (`public/manifest.json`), vector logo icon (`public/icon.svg`), theme color metadata (`#4f46e5`), and conservative Service Worker (`public/sw.js`).
  - Ensure Service Worker caches only static app shell assets (`/`, `/index.html`, `/manifest.json`, `/icon.svg`) and strictly excludes API calls (`/api/*`), WebSockets (`wss://`), Auth tokens, transcripts, and audio recordings.
  - Add environment validation module (`src/services/envValidation.ts`) and readiness endpoint (`GET /api/readiness`) checking `GEMINI_API_KEY`, model configs, Firebase server access, and allowed CORS origins without exposing keys or secrets.
  - Enable CORS handling for `ALLOWED_ORIGINS` with HTTP OPTIONS preflight handling in `server.ts`.
  - Document complete release checklist, HTTPS smoke test protocol, and Cloud Run rollback procedures in `RELEASE_CHECKLIST.md`.
* **Rationale**:
  - Guarantees installability and fast app shell loading as a standalone PWA.
  - Prevents cached dynamic/private data exposure or stale Service Worker state bugs.
  - Provides clear diagnostic readiness and emergency rollback procedures for production operations.



