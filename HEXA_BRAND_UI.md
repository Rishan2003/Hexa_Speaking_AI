# HEXA'S Education UI Brand Pass — v1.1.0

This release is based on the working `v1.0.9-part2-closing-signout` branch and changes presentation only.

## What changed

- Reframed the visible product as **HEXA'S Education — Speaking AI**.
- Added a reusable text/CSS `HexasBrand` wordmark with a navy brand name and red X accent.
- Added HEXA'S navy/red design tokens in `src/index.css`.
- Reworked the landing screen into a branded education-software hero instead of a generic AI/SaaS page.
- Branded the authentication card and student-portal copy.
- Branded the dashboard hero, primary actions, diagnostic bars and practice-mode accents.
- Branded the practice setup/calibration panel and launch action.
- Branded the live practice room, examiner transcript bubble, cue-card panel and assessment transition.
- Branded the results score banner and core criterion score typography.
- Replaced user-visible SpeakReady references with HEXA'S Speaking AI.
- Added a navy/red HEXA'S-style PWA icon and updated browser/PWA metadata.

## Intentionally unchanged

No changes were made to:

- Gemini Live transport
- Part 2 manual VAD / two-minute long-turn behavior
- Part 2 closing-question synchronization
- examiner prompts
- question bank
- Firestore session persistence
- evaluation generation
- authentication logic
- sign-out logic

## Branding note

The UI uses a software wordmark built from text/CSS and an approximate navy/red palette inspired by HEXA'S public visual identity. If an official HEXA'S master logo/brand-guideline asset is provided later, the `HexasBrand` component and PWA icon can be swapped to the exact approved artwork without changing application logic.
