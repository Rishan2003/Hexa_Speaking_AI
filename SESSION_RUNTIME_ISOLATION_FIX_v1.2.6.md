# HEXA Speaking AI v1.2.6 — Session Runtime Isolation

This patch removes the remaining server-side dependency on `src/services/questionBank.ts` from the Vercel session-create function.

The browser already generates the deterministic `selectedTestSnapshot`. It now sends that snapshot to `/api/session/create`. The server validates the snapshot shape/size but remains authoritative for Firebase identity, paid-test reservation, Firestore persistence, and session ownership.

The session implementation also dynamically loads Firebase auth lookup, billing, and Firestore helpers inside the request stages so a module-load failure can be returned as structured JSON instead of becoming an opaque Vercel invocation error.

API revision: `1.2.6-session-runtime-isolation`.
