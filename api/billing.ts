/**
 * HEXA billing Vercel bootstrap — v1.2.2
 *
 * Intentionally ZERO static imports. If any dependency of the real billing
 * implementation cannot load on Vercel, this wrapper catches that failure and
 * returns diagnostic JSON instead of FUNCTION_INVOCATION_FAILED.
 */

const API_REVISION = '1.3.0-billing-configurable-credit-costs';

function setHeaders(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-HEXA-Billing-Bootstrap', API_REVISION);

  const origin = req?.headers?.origin;
  const allowed = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
}

function cleanPath(req: any): string {
  const queryPath = typeof req?.query?.path === 'string' ? req.query.path : '';
  return queryPath.replace(/^\/+|\/+$/g, '');
}

function errorDetails(error: any) {
  return {
    name: String(error?.name || 'Error').slice(0, 120),
    code: error?.code == null ? undefined : String(error.code).slice(0, 120),
    message: String(error?.message || error || 'Unknown module-load error').slice(0, 1000),
  };
}

export default async function billingBootstrap(req: any, res: any) {
  try {
    setHeaders(req, res);

    if (req?.method === 'OPTIONS') return res.status(204).end();

    const path = cleanPath(req);

    // This route never imports Firebase or any local billing helper. It proves
    // whether the Vercel entrypoint itself is healthy.
    if (path === 'bootstrap') {
      return res.status(200).json({
        ok: true,
        stage: 'entrypoint',
        apiRevision: API_REVISION,
        node: process.version,
        runtime: 'vercel-node',
      });
    }

    let module: any;
    try {
      module = await import('./_billingHandler.js');
    } catch (error: any) {
      console.error('[HEXA billing bootstrap] implementation import failed', error);
      return res.status(500).json({
        error: 'The billing implementation could not be loaded by the Vercel function.',
        code: 'BILLING_IMPLEMENTATION_IMPORT_FAILED',
        stage: 'implementation_import',
        apiRevision: API_REVISION,
        runtime: { node: process.version },
        detail: errorDetails(error),
      });
    }

    if (typeof module?.default !== 'function') {
      return res.status(500).json({
        error: 'The billing implementation loaded but did not export a default handler.',
        code: 'BILLING_HANDLER_EXPORT_MISSING',
        stage: 'handler_resolution',
        apiRevision: API_REVISION,
      });
    }

    try {
      return await module.default(req, res);
    } catch (error: any) {
      console.error('[HEXA billing bootstrap] uncaught handler failure', error);
      if (res.headersSent) return;
      return res.status(500).json({
        error: 'The billing handler threw before returning a response.',
        code: 'BILLING_HANDLER_UNCAUGHT',
        stage: 'handler_execution',
        apiRevision: API_REVISION,
        detail: errorDetails(error),
      });
    }
  } catch (error: any) {
    // Last-resort response for failures in the zero-import wrapper itself.
    try {
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'The minimal billing bootstrap failed.',
          code: 'BILLING_BOOTSTRAP_FAILED',
          stage: 'bootstrap',
          apiRevision: API_REVISION,
          detail: errorDetails(error),
        });
      }
    } catch {
      // Nothing else can safely be written.
    }
    throw error;
  }
}
