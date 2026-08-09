/**
 * Verify a Firebase Web ID token without importing firebase-admin/auth.
 *
 * Firebase Admin 14.x currently pulls jwks-rsa 4.x -> jose 6.x in the Auth
 * module. On the Vercel Node 22 runtime used by this project that dependency
 * chain can fail during CommonJS/ESM interop. The Identity Toolkit account
 * lookup endpoint validates the Firebase ID token and returns the owning user,
 * so the paid-access functions can authenticate without loading that chain.
 */

export interface VerifiedFirebaseUser {
  uid: string;
  sub: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
  [key: string]: any;
}

function firebaseWebApiKey(): string {
  return String(
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY ||
    ''
  ).trim();
}

function authError(message: string, code: string, status = 401): any {
  const error: any = new Error(message);
  error.code = code;
  error.httpStatus = status;
  return error;
}

export async function verifyFirebaseIdTokenViaLookup(token: string): Promise<VerifiedFirebaseUser> {
  const idToken = String(token || '').trim();
  if (!idToken) throw authError('Authentication token is empty.', 'AUTH_TOKEN_EMPTY');

  const apiKey = firebaseWebApiKey();
  if (!apiKey) {
    throw authError(
      'Firebase Web API key is not available to the server function. Set FIREBASE_WEB_API_KEY or VITE_FIREBASE_API_KEY in Vercel.',
      'FIREBASE_WEB_API_KEY_MISSING',
      503
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      }
    );
  } catch (cause: any) {
    if (cause?.name === 'AbortError') {
      throw authError('Firebase authentication verification timed out.', 'FIREBASE_AUTH_TIMEOUT', 502);
    }
    const error = authError('Could not reach Firebase Authentication to verify the user.', 'FIREBASE_AUTH_NETWORK_ERROR', 502);
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    // Keep an empty payload and use the status below.
  }

  const user = Array.isArray(payload?.users) ? payload.users[0] : null;
  if (!response.ok || !user?.localId) {
    const upstreamCode = String(payload?.error?.message || 'INVALID_ID_TOKEN');
    const error = authError('Your sign-in session could not be verified. Sign in again and retry.', 'AUTH_INVALID');
    error.upstreamCode = upstreamCode;
    error.upstreamStatus = response.status;
    throw error;
  }

  let customClaims: Record<string, any> = {};
  if (typeof user.customAttributes === 'string' && user.customAttributes.trim()) {
    try {
      const parsed = JSON.parse(user.customAttributes);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) customClaims = parsed;
    } catch {
      // Invalid custom attributes should not invalidate an otherwise valid user.
    }
  }

  return {
    ...customClaims,
    uid: String(user.localId),
    sub: String(user.localId),
    ...(user.email ? { email: String(user.email) } : {}),
    ...(user.displayName ? { name: String(user.displayName) } : {}),
    ...(typeof user.emailVerified === 'boolean' ? { email_verified: user.emailVerified } : {}),
  };
}
