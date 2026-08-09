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

type AdminHandles = { db: any };
let adminHandlesPromise: Promise<AdminHandles> | null = null;

/**
 * Lazy Firestore-only Firebase Admin bootstrap for Vercel paid-access functions.
 *
 * firebase-admin/auth is deliberately NOT imported. Authentication is handled
 * by api/_firebaseIdTokenLookup.ts so the Vercel runtime never loads the
 * jwks-rsa -> jose dependency path that was failing under Node 22.
 */
export async function ensureSessionFirebaseAdmin(): Promise<AdminHandles> {
  if (!adminHandlesPromise) {
    adminHandlesPromise = (async () => {
      const [appModule, firestoreModule] = await Promise.all([
        import('firebase-admin/app'),
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

      return { db: firestoreModule.getFirestore() };
    })().catch((error) => {
      adminHandlesPromise = null;
      throw error;
    });
  }

  return adminHandlesPromise;
}
