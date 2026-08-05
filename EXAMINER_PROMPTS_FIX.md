# Examiner Prompts Startup Fix

Fixed two independent startup issues:

1. Gemini Live constrained ephemeral tokens now use `lockAdditionalFields: []`, so the client-side per-part `systemInstruction` is not silently overridden/ignored by the token's locked setup.
2. The deterministic mock examiner now selects the correct Part 1/2/3 examiner prompt, completes its simulated connection lifecycle, and starts the proper examiner flow automatically.

Validation completed:
- `npm test`: 84/84 tests passed
- `npm run typecheck`: passed
- `npm run build`: passed

Security note: `.env.local` is intentionally excluded from this archive. Add your own environment values locally and do not commit credentials.
