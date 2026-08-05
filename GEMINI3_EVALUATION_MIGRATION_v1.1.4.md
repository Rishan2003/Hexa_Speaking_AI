# Gemini 3 Evaluation Migration — v1.1.4

## Root cause
The post-test evaluator could reach Gemini successfully, but the configured Gemini 2.5 models can return HTTP 404 for newer API users. In the affected build, `gemini-2.5-flash` fell through to `gemini-2.5-flash-lite`, which then returned "no longer available to new users".

## Fix
- Default IELTS evaluation model: `gemini-3.6-flash`.
- Full-quality fallback model: `gemini-3.5-flash`.
- Legacy Gemini 2.0/2.5 evaluation values in an old `.env.local` are automatically migrated at runtime, so copying an older environment file cannot reintroduce this 404.
- Model-unavailable detection now also recognizes explicit "no longer available" / "not available to new users" provider messages.
- Removed the old `temperature` sampling parameter from structured evaluation requests to stay compatible with the latest Gemini model API guidance.
- No mock score is used when a real Gemini key is configured.

## Important
Gemini Live remains separate and continues to use `gemini-3.1-flash-live-preview`. This patch changes only the post-test structured IELTS evaluator.
