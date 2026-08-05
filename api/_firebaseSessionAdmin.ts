import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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
    // Ignore base64 decoding errors and try the original value only.
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

let initialized = false;

export function ensureSessionFirebaseAdmin() {
  if (!initialized) {
    if (getApps().length === 0) {
      const account = configuredServiceAccount();
      initializeApp({
        credential: cert({
          projectId: account.projectId,
          clientEmail: account.clientEmail,
          privateKey: account.privateKey,
        }),
        ...(process.env.FIREBASE_STORAGE_BUCKET
          ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET }
          : {}),
      });
    }
    initialized = true;
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}

export function firebaseCredentialPresence() {
  const hasBundled = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT?.trim());
  const hasSplit = Boolean(
    process.env.FIREBASE_PROJECT_ID?.trim() &&
    process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
    process.env.FIREBASE_PRIVATE_KEY?.trim()
  );
  return hasBundled || hasSplit;
}
