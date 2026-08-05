/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { 
  initializeFirestore, 
  Firestore, 
  collection, 
  doc, 
  FirestoreDataConverter, 
  DocumentData, 
  QueryDocumentSnapshot,
  SnapshotOptions,
  enableNetwork
} from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { UserProfile, IELTSPracticeSession, IELTSEvaluation, SpeechChunk } from '../types';

// Client-side environment configurations
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let enabled = false;

// Safe browser-only initialization. Never reference Node's `process` object in a Vite bundle.
try {
  const isTest = import.meta.env.MODE === 'test';
  const hasRequiredConfig = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    firebaseConfig.apiKey !== 'MY_FIREBASE_API_KEY'
  );

  if (hasRequiredConfig && !isTest) {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);

    // Ignore optional fields whose value is `undefined` instead of rejecting the
    // entire write. Some candidate profile fields are intentionally optional.
    // Long-polling can be forced for hosting networks/proxies that block
    // Firestore's default streaming transport.
    const forceLongPolling = import.meta.env.VITE_FIREBASE_FORCE_LONG_POLLING === 'true';
    db = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      ...(forceLongPolling
        ? { experimentalForceLongPolling: true }
        : { experimentalAutoDetectLongPolling: true })
    });

    storage = getStorage(app);
    enabled = true;
    console.log('Firebase client successfully initialized.');
  } else {
    console.warn('Firebase web configuration is incomplete or tests are running. Using offline client sandbox mode.');
  }
} catch (error) {
  console.error('Failed to initialize Firebase client SDK:', error);
}

export function isFirebaseEnabled(): boolean {
  return enabled;
}

/** Returns true for Firestore transport failures that should not trap local UI flows. */
export function isFirestoreConnectivityError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  const code = candidate?.code || '';
  const message = (candidate?.message || String(error || '')).toLowerCase();

  return (
    code === 'unavailable' ||
    code === 'firestore/unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'firestore/deadline-exceeded' ||
    message.includes('client is offline') ||
    message.includes('failed to get document because the client is offline') ||
    message.includes('failed to get documents because the client is offline') ||
    message.includes('could not reach cloud firestore backend') ||
    message.includes('network error')
  );
}

/** Best-effort network restart used after browsers/proxies interrupt WebChannel. */
export async function reconnectFirebaseNetwork(): Promise<void> {
  if (!db) return;
  try {
    await enableNetwork(db);
  } catch (error) {
    console.warn('Could not explicitly re-enable the Firestore network:', error);
  }
}

export function getFirebaseApp(): FirebaseApp {
  if (!app) throw new Error('Firebase client App is not initialized.');
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) throw new Error('Firebase client Auth is not initialized.');
  return auth;
}

export function getFirebaseDb(): Firestore {
  if (!db) throw new Error('Firebase client Firestore is not initialized.');
  return db;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!storage) throw new Error('Firebase client Storage is not initialized.');
  return storage;
}

/** Returns a fresh Firebase ID token for authenticated API requests, or null in sandbox mode. */
export async function getFirebaseIdToken(): Promise<string | null> {
  if (!enabled || !auth?.currentUser) return null;
  return auth.currentUser.getIdToken();
}

// Helper to construct a generic converter for TypeScript safety
function createConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject: T): DocumentData {
      return modelObject;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options: SnapshotOptions): T {
      const data = snapshot.data(options);
      return data as T;
    }
  };
}

// 1. User Profiles Collection
export interface FirestoreUserProfile extends UserProfile {
  createdAt: number;
  role: 'student' | 'admin';
}
export const userConverter = createConverter<FirestoreUserProfile>();
export const getUsersCollection = (firestore: Firestore) => 
  collection(firestore, 'users').withConverter(userConverter);

// 2. Question Sets Collection
export interface FirestoreQuestionSet {
  id: string;
  title: string;
  description: string;
  active: boolean;
  createdAt: number;
}
export const questionSetConverter = createConverter<FirestoreQuestionSet>();
export const getQuestionSetsCollection = (firestore: Firestore) => 
  collection(firestore, 'questionSets').withConverter(questionSetConverter);

// 3. Topics Collection
export interface FirestoreTopic {
  id: string;
  questionSetId: string;
  part: number;
  title: string;
  subtopics?: string[];
  createdAt: number;
}
export const topicConverter = createConverter<FirestoreTopic>();
export const getTopicsCollection = (firestore: Firestore) => 
  collection(firestore, 'topics').withConverter(topicConverter);

// 4. Questions Collection
export interface FirestoreQuestion {
  id: string;
  topicId: string;
  part: number;
  text: string;
  order: number;
  bulletPoints?: string[];
  createdAt: number;
}
export const questionConverter = createConverter<FirestoreQuestion>();
export const getQuestionsCollection = (firestore: Firestore) => 
  collection(firestore, 'questions').withConverter(questionConverter);

// 5. Speaking Sessions Collection
export interface FirestoreSpeakingSession extends IELTSPracticeSession {
  updatedAt: number;
}
export const speakingSessionConverter = createConverter<FirestoreSpeakingSession>();
export const getSpeakingSessionsCollection = (firestore: Firestore) => 
  collection(firestore, 'speakingSessions').withConverter(speakingSessionConverter);

// 6. Session Parts Subcollection
export interface FirestoreSessionPart {
  id: string;
  sessionId: string;
  partIndex: number;
  status: 'idle' | 'active' | 'completed';
  startedAt: number;
  completedAt?: number;
}
export const partConverter = createConverter<FirestoreSessionPart>();
export const getPartsSubcollection = (firestore: Firestore, sessionId: string) => 
  collection(firestore, 'speakingSessions', sessionId, 'parts').withConverter(partConverter);

// 7. Session Turns Subcollection (idempotent client-generated speech events)
export interface FirestoreSessionTurn extends SpeechChunk {
  sessionId: string;
  partId: string;
  recordingUrl?: string;
  audioBlobPath?: string; // cloud storage path if uploaded
}
export const turnConverter = createConverter<FirestoreSessionTurn>();
export const getTurnsSubcollection = (firestore: Firestore, sessionId: string) => 
  collection(firestore, 'speakingSessions', sessionId, 'turns').withConverter(turnConverter);

// 8. Evaluations Collection
export interface FirestoreEvaluation extends IELTSEvaluation {}
export const evaluationConverter = createConverter<FirestoreEvaluation>();
export const getEvaluationsCollection = (firestore: Firestore) => 
  collection(firestore, 'evaluations').withConverter(evaluationConverter);

// 9. Feedback Collection
export interface FirestoreFeedback {
  id: string;
  userId: string;
  sessionId: string;
  rating: number; // 1-5 stars
  comment: string;
  createdAt: number;
}
export const feedbackConverter = createConverter<FirestoreFeedback>();
export const getFeedbackCollection = (firestore: Firestore) => 
  collection(firestore, 'feedback').withConverter(feedbackConverter);

// 10. Usage Events (For logs and auditing)
export interface FirestoreUsageEvent {
  id: string;
  userId: string;
  eventType: string; // e.g. 'practice_started', 'eval_requested', 'error_logged'
  timestamp: number;
  metadata?: Record<string, any>;
}
export const usageEventConverter = createConverter<FirestoreUsageEvent>();
export const getUsageEventsCollection = (firestore: Firestore) => 
  collection(firestore, 'usageEvents').withConverter(usageEventConverter);

// 11. User Limits (Daily sessions tracking)
export interface FirestoreUserLimit {
  userId: string;
  dailySessionsCount: number;
  lastActiveDate: string; // YYYY-MM-DD
  maxSessionsPerDay: number;
}
export const userLimitConverter = createConverter<FirestoreUserLimit>();
export const getUserLimitsCollection = (firestore: Firestore) => 
  collection(firestore, 'userLimits').withConverter(userLimitConverter);
