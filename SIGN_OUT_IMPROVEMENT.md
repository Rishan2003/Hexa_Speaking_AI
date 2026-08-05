# Sign-out Improvement

This build adds a complete authenticated sign-out flow without changing the IELTS speaking, Part 2 timing, or evaluation logic.

## Changes

- Added a visible **Sign out** control to the desktop header.
- Added **Privacy**, **Diagnostics**, signed-in identity, and **Sign out** to the mobile menu.
- Added a confirmation dialog before signing out.
- Shows a stronger warning when signing out during an active practice session.
- Uses the existing Firebase Auth `signOut()` implementation.
- Redirects directly to `/login` after successful logout.
- Clears authenticated temporary browser artifacts on logout:
  - recovery snapshot
  - tab/session lease keys
  - pending unsynced speech-write queue
- Preserves device preferences such as recording consent, difficulty, and mock-mode setting.

No examiner prompt, question bank, Gemini Live, Part 2 manual VAD, or evaluation behavior was changed.
