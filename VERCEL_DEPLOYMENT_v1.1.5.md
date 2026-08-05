# SpeakReady IELTS v1.1.6 — Vercel Output Directory Fix

This release fixes the Vercel deployment error:

```text
Error: No Output Directory named "dist" found after the Build completed.
```

## Root cause

The Vite build is intentionally configured to emit the React application to `public/` so Vercel can serve the compiled frontend from its CDN. Some Vercel project/framework settings can still expect Vite's conventional `dist/` directory unless the repository explicitly overrides the Output Directory.

## Fix

`vercel.json` now contains:

```json
{
  "buildCommand": "npm run build:client",
  "outputDirectory": "public"
}
```

The source-controlled assets remain in `static/`, while `vite build` creates `public/index.html` and `public/assets/*`.

## Vercel dashboard

You can redeploy without changing the dashboard because the repository-level `outputDirectory` overrides the project Output Directory. If you prefer to inspect it manually, Project Settings → Build and Deployment → Output Directory should resolve to `public`, not `dist`.

## Expected build output

```text
public/index.html
public/assets/index-*.css
public/assets/index-*.js
```

The Rollup/Vite warning about a JavaScript chunk larger than 500 kB is a performance warning, not a deployment failure. It can be optimized later with route-level dynamic imports/manual chunking.

## Post-deployment checks

Open `/api/health` and `/api/readiness`, then sign in and complete a speaking test to verify Firebase, Gemini Live, and Gemini evaluation.
