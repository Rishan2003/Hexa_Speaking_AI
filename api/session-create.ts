const API_REVISION = '1.2.5-session-zero-import-bootstrap';

function setHeaders(res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-HEXA-API-Revision', API_REVISION);
}

export default async function handler(req: any, res: any) {
  setHeaders(res);

  // A direct GET is intentionally a bootstrap probe. It proves the Vercel
  // entrypoint can start before any application/Firebase modules are loaded.
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      stage: 'entrypoint',
      apiRevision: API_REVISION,
      node: process.version,
      runtime: 'vercel-node',
    });
  }

  try {
    const implementation = await import('./_sessionCreateHandler.js');
    const implementationHandler = implementation.default;
    if (typeof implementationHandler !== 'function') {
      return res.status(500).json({
        error: 'The session-create implementation did not export a request handler.',
        code: 'SESSION_IMPLEMENTATION_INVALID',
        stage: 'implementation_import',
        apiRevision: API_REVISION,
      });
    }
    return await implementationHandler(req, res);
  } catch (error: any) {
    console.error('[HEXA session-create bootstrap] implementation import failed', {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({
      error: 'The session-create implementation could not be loaded by the Vercel function.',
      code: 'SESSION_IMPLEMENTATION_IMPORT_FAILED',
      stage: 'implementation_import',
      apiRevision: API_REVISION,
      runtime: { node: process.version },
      detail: {
        name: String(error?.name || 'Error'),
        ...(error?.code ? { code: String(error.code) } : {}),
        message: String(error?.message || 'Unknown module-load error').slice(0, 1200),
      },
    });
  }
}
