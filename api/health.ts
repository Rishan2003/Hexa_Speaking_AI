const bootTime = Date.now();

export default function health(_req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    runtime: 'vercel',
    apiRevision: '1.1.9',
    timestamp: Date.now(),
    uptimeSeconds: Math.floor((Date.now() - bootTime) / 1000),
  });
}
