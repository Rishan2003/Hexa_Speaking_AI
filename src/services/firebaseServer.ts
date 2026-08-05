/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

let initializationAttempted = false;
let isServerFirebaseInitialized = false;
let firestoreSuppressedUntil = 0;
const FIRESTORE_RETRY_COOLDOWN_MS = 60 * 1000;

interface ServiceAccountShape {
  projectId?: string;
  project_id?: string;
  clientEmail?: string;
  client_email?: string;
  privateKey?: string;
  private_key?: string;
}

function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

function parseServiceAccountValue(rawValue: string): ServiceAccountShape | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  try {
    candidates.push(Buffer.from(trimmed, 'base64').toString('utf8'));
  } catch {
    // Keep the original JSON candidate only.
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ServiceAccountShape;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Try the next supported representation.
    }
  }

  return null;
}

function getExplicitServiceAccount(): ServiceAccountShape | null {
  const bundled = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (bundled) {
    const parsed = parseServiceAccountValue(bundled);
    if (!parsed) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT must be valid JSON or base64-encoded JSON.');
    }
    return parsed;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

function hasApplicationDefaultCredentialContext(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.K_SERVICE ||
    process.env.FUNCTION_TARGET ||
    process.env.GAE_ENV ||
    process.env.FIREBASE_CONFIG
  );
}

function initializeFirebaseAdmin(): boolean {
  if (initializationAttempted) return isServerFirebaseInitialized;
  initializationAttempted = true;

  if (isTestEnvironment()) {
    console.log('Test environment detected. Firebase Admin remains in offline simulated mode.');
    return false;
  }

  try {
    if (getApps().length > 0) {
      isServerFirebaseInitialized = true;
      return true;
    }

    const explicitAccount = getExplicitServiceAccount();
    const configuredProjectId =
      explicitAccount?.projectId ||
      explicitAccount?.project_id ||
      process.env.FIREBASE_PROJECT_ID;
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

    if (explicitAccount) {
      const clientEmail = explicitAccount.clientEmail || explicitAccount.client_email;
      const privateKey = (explicitAccount.privateKey || explicitAccount.private_key)?.replace(/\\n/g, '\n');

      if (!configuredProjectId || !clientEmail || !privateKey) {
        throw new Error('The Firebase service account is missing project_id, client_email, or private_key.');
      }

      initializeApp({
        credential: cert({
          projectId: configuredProjectId,
          clientEmail,
          privateKey,
        }),
        ...(storageBucket ? { storageBucket } : {}),
      });
      isServerFirebaseInitialized = true;
      console.log('Firebase Admin initialized with an explicit service account.');
      return true;
    }

    if (hasApplicationDefaultCredentialContext()) {
      initializeApp({
        credential: applicationDefault(),
        ...(configuredProjectId ? { projectId: configuredProjectId } : {}),
        ...(storageBucket ? { storageBucket } : {}),
      });
      isServerFirebaseInitialized = true;
      console.log('Firebase Admin initialized with Application Default Credentials.');
      return true;
    }

    console.warn(
      'Firebase Admin credentials are unavailable. Server is using offline sandbox persistence. ' +
      'Set FIREBASE_SERVICE_ACCOUNT, the three service-account fields, or GOOGLE_APPLICATION_CREDENTIALS.'
    );
    return false;
  } catch (error) {
    isServerFirebaseInitialized = false;
    console.error('Failed to initialize Firebase Admin SDK:', error);
    return false;
  }
}

export function isFirebaseServerEnabled(): boolean {
  return initializeFirebaseAdmin();
}


/**
 * Firebase Auth/Admin can be healthy while Cloud Firestore is disabled or its API
 * has not been created yet. Keep those states separate so authentication and
 * Gemini token minting continue to work while persistence falls back locally.
 */
export function isFirestoreAvailabilityError(error: unknown): boolean {
  const candidate = error as { code?: string | number; message?: string; details?: string } | null;
  const code = String(candidate?.code ?? '').toLowerCase();
  const message = `${candidate?.message || ''} ${candidate?.details || ''}`.toLowerCase();

  return (
    code === '4' ||
    code === '7' ||
    code === '14' ||
    code === 'deadline-exceeded' ||
    code === 'permission-denied' ||
    code === 'unavailable' ||
    code === 'firestore/deadline-exceeded' ||
    code === 'firestore/permission-denied' ||
    code === 'firestore/unavailable' ||
    message.includes('cloud firestore api has not been used') ||
    message.includes('firestore.googleapis.com') ||
    message.includes('the database (default) does not exist') ||
    message.includes('database does not exist') ||
    message.includes('could not reach cloud firestore backend')
  );
}

export function markFirestoreServerUnavailable(error: unknown): boolean {
  if (!isFirestoreAvailabilityError(error)) return false;
  firestoreSuppressedUntil = Math.max(
    firestoreSuppressedUntil,
    Date.now() + FIRESTORE_RETRY_COOLDOWN_MS
  );
  return true;
}

export function isFirestoreServerAvailable(): boolean {
  return isFirebaseServerEnabled() && Date.now() >= firestoreSuppressedUntil;
}

export function getFirebaseAdmin(): any {
  if (!initializeFirebaseAdmin()) {
    throw new Error('Firebase Admin is not initialized or is running in mock fallback mode.');
  }

  // Preserve the small namespace-style surface used by the existing server code
  // while relying on Firebase Admin's supported modular ESM imports.
  const firestore = Object.assign(() => getFirestore(), { FieldValue });
  return {
    auth: () => getAuth(),
    firestore,
    storage: () => getStorage(),
  };
}

export function getAdminDb(): any {
  if (!initializeFirebaseAdmin()) {
    throw new Error('Firebase Admin is not initialized or is running in mock fallback mode.');
  }
  return getFirestore();
}

export function getAdminStorage(): any {
  if (!initializeFirebaseAdmin()) {
    throw new Error('Firebase Admin is not initialized or is running in mock fallback mode.');
  }
  return getStorage();
}

/**
 * Recursively deletes a speaking session, its known subcollections, associated
 * evaluations, and recording objects owned by the same user.
 */
export async function deleteSessionRecursively(
  sessionId: string,
  userId: string
): Promise<{ success: boolean; deletedCount: number; errors?: string[] }> {
  const errors: string[] = [];
  let deletedCount = 0;

  if (!isFirebaseServerEnabled()) {
    console.warn(`Sandbox deletion requested for session ${sessionId}; simulating success.`);
    return { success: true, deletedCount: 1 };
  }

  try {
    const db = getAdminDb();
    const sessionRef = db.collection('speakingSessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();

    if (!sessionSnap.exists) {
      return { success: false, deletedCount: 0, errors: ['Session document does not exist.'] };
    }

    const ownerId = sessionSnap.data()?.userId;
    if (ownerId && ownerId !== userId) {
      return { success: false, deletedCount: 0, errors: ['Session ownership verification failed.'] };
    }

    const [partsSnap, turnsSnap, evalsSnap] = await Promise.all([
      sessionRef.collection('parts').get(),
      sessionRef.collection('turns').get(),
      db.collection('evaluations').where('sessionId', '==', sessionId).get(),
    ]);

    const documentRefs = [
      ...partsSnap.docs.map((document: any) => document.ref),
      ...turnsSnap.docs.map((document: any) => document.ref),
      ...evalsSnap.docs.map((document: any) => document.ref),
      sessionRef,
    ];

    // Firestore permits at most 500 writes per batch.
    for (let index = 0; index < documentRefs.length; index += 450) {
      const batch = db.batch();
      const slice = documentRefs.slice(index, index + 450);
      slice.forEach((ref: any) => batch.delete(ref));
      await batch.commit();
      deletedCount += slice.length;
    }

    try {
      const bucket = getAdminStorage().bucket();
      await bucket.deleteFiles({
        prefix: `speaking-recordings/${userId}/${sessionId}/`,
        force: true,
      });
    } catch (storageError: any) {
      console.error('Failed to purge session recordings:', storageError);
      errors.push(`Cloud Storage deletion error: ${storageError.message}`);
    }

    return {
      success: errors.length === 0,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    console.error(`Critical error deleting session ${sessionId}:`, error);
    return {
      success: false,
      deletedCount,
      errors: [error.message || 'Unknown recursive deletion error.'],
    };
  }
}
