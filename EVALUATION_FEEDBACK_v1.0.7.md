# SpeakReady IELTS — Evaluation Feedback v1.0.7

## What changed

The live examiner remains neutral during the speaking test. After the final examiner turn, the existing post-test evaluation pipeline runs automatically and opens the Results page.

The evaluator is now explicitly evidence-bound:

- Scores candidate language only, never examiner language.
- Uses IELTS Speaking practice dimensions: Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, and Pronunciation when usable audio evidence is available.
- Grammar corrections must come from wording actually present in the candidate transcript.
- Vocabulary improvements must start from wording the candidate actually used.
- Avoids penalizing likely speech-to-text punctuation/capitalization artifacts.
- Avoids rewarding word count or verbosity by itself.
- Produces separate Part 1 / Part 2 / Part 3 diagnostic feedback when those parts contain candidate evidence.
- Uses the stored test snapshot, actual questions, transcript metadata, and Part 2 timing metadata as evaluation context.
- Gives 3–4 strengths, 3–4 priorities, and a short actionable practice plan.

## Pronunciation safeguard

The current server evaluator receives transcript evidence, but not evaluator-readable raw audio bytes. Therefore pronunciation is deliberately marked `not_assessed` rather than hallucinated from text.

When pronunciation is unavailable:

- The displayed band is explicitly a transcript-based practice estimate.
- Confidence is capped at 72%.
- The UI explains that the estimate is not a complete four-criterion IELTS Speaking assessment.

## Evaluation schema migration

Evaluation schema version was bumped from `v1` to `v2`. This prevents an older cached evaluation from being returned after the report format changed.

## Validation

- TypeScript: passed (`tsc --noEmit`)
- Tests: 86/86 passed
- Production build: passed
