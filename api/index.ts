/**
 * Main Vercel Function for SpeakReady API application routes.
 *
 * The Express implementation is kept in api/_server.ts and imported statically.
 * Vercel ignores underscore-prefixed utility files as standalone Functions while
 * tracing their dependencies into this Function bundle.
 *
 * /api/health and /api/readiness are separate minimal Functions so deployment
 * diagnostics remain available even if an application dependency cannot load.
 */

import appHandler from './_server';

function requestPath(req: any): string {
  const routedPath = req.query?.path;
  if (typeof routedPath === 'string' && routedPath.trim()) {
    return `/api/${routedPath.replace(/^\/+/, '')}`;
  }

  const raw = String(req.url || req.originalUrl || '');
  return raw.split('?')[0] || '/';
}

export default async function handler(req: any, res: any) {
  const path = requestPath(req);

  try {
    if (!String(req.url || '').startsWith(path)) {
      req.url = path;
    }
    return await appHandler(req, res);
  } catch (error: any) {
    console.error('[SpeakReady] Vercel API handler failed:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'The API request failed inside the server handler.',
        code: 'VERCEL_API_HANDLER_FAILED',
        stage: 'api_handler',
        runtimeErrorCode: typeof error?.code === 'string' ? error.code : undefined,
        runtimeErrorName: error?.name || undefined,
      });
    }
  }
}
