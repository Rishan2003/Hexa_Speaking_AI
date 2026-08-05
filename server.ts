/**
 * Local/container entrypoint.
 * The implementation lives in api/_server.ts so Vercel can trace and bundle it
 * from inside the Functions source tree. Importing the module starts the local
 * listener automatically whenever VERCEL is not set.
 */
import handler from './api/_server';
export default handler;
