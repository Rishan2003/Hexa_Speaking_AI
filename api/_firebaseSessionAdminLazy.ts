interface ServiceAccountShape {
  projectId?: string;
  project_id?: string;
  clientEmail?: string;
  client_email?: string;
  privateKey?: string;
  private_key?: string;
}

function parseServiceAccount(raw: string): ServiceAccountShape | null {
  const candidates = [raw.trim()];
  try {
    candidates.push(Buffer.from(raw.trim(), 'base64').toString('utf8'));
  } catch {
    // Try the original value only.
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as ServiceAccountShape;
    } catch {
      // Try the next supported representation.
    }
  }
  return null;
}

function configuredServiceAccount(): Required<Pick<ServiceAccountShape, 'projectId' | 'clientEmail' | 'privateKey'>> {
  let account: ServiceAccountShape | null = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT?.trim()) {
    account = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!account) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON or base64-encoded JSON.');
    }
  } else {
    account = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
    };
  }

  const projectId = account.projectId || account.project_id;
  const clientEmail = account.clientEmail || account.client_email;
  const privateKey = (account.privateKey || account.private_key)?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase Admin credentials are incomplete. Expected project_id, client_email and private_key.');
  }
  return { projectId, clientEmail, privateKey };
}

type AdminHandles = { auth: any; db: any };
let adminHandlesPromise: Promise<AdminHandles> | null = null;

/**
 * Lazy Firebase Admin bootstrap for Vercel billing functions.
 *
 * IMPORTANT: firebase-admin is intentionally dynamically imported only after
 * the request handler has started. This prevents an SDK/module-load problem
 * from crashing the Vercel Function before our handler can return diagnostic
 * JSON (FUNCTION_INVOCATION_FAILED).
 */
export async function ensureSessionFirebaseAdmin(): Promise<AdminHandles> {
  if (!adminHandlesPromise) {
    adminHandlesPromise = (async () => {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import('firebase-admin/app'),
        import('firebase-admin/auth'),
        import('firebase-admin/firestore'),
      ]);

      if (appModule.getApps().length === 0) {
        const account = configuredServiceAccount();
        appModule.initializeApp({
          credential: appModule.cert({
            projectId: account.projectId,
            clientEmail: account.clientEmail,
            privateKey: account.privateKey,
          }),
          ...(process.env.FIREBASE_STORAGE_BUCKET
            ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET }
            : {}),
        });
      }

      return {
        auth: authModule.getAuth(),
        db: firestoreModule.getFirestore(),
      };
    })().catch((error) => {
      // Allow a later request to retry after an environment/deployment fix.
      adminHandlesPromise = null;
      throw error;
    });
  }

  return adminHandlesPromise;
}
