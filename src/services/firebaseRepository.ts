/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  getFirebaseDb, 
  isFirebaseEnabled,
  getUsersCollection,
  getSpeakingSessionsCollection,
  getPartsSubcollection,
  getTurnsSubcollection,
  getEvaluationsCollection,
  getUserLimitsCollection,
  FirestoreUserProfile,
  FirestoreSpeakingSession,
  FirestoreSessionPart,
  FirestoreSessionTurn,
  FirestoreEvaluation,
  FirestoreUserLimit,
  getFirebaseIdToken,
  isFirestoreConnectivityError,
  reconnectFirebaseNetwork
} from './firebaseClient';
import { 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  updateDoc 
} from 'firebase/firestore';
import { IELTSPracticeSession, IELTSEvaluation, SpeechChunk, ExamState, IELTSExamPart, UserProfile, RecordingMetadata, ProviderMetadata, SessionStatus } from '../types';
import { generateTestSnapshot } from './questionBank';
import { MockPracticeService } from './mockService';
import { APP_CONFIG } from '../config';

export { isFirebaseEnabled } from './firebaseClient';

const shouldUseLocalSandbox = (): boolean => APP_CONFIG.useMocks || !isFirebaseEnabled();

const stripUndefined = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export const FirebaseRepository = {
  /**
   * Save or update a user's profile in Firestore.
   */
  async saveUserProfile(profile: UserProfile): Promise<void> {
    if (shouldUseLocalSandbox()) {
      // Local fallback
      console.log('[FirebaseRepository] Mock fallback for saveUserProfile');
      return;
    }

    try {
      const db = getFirebaseDb();
      const userRef = doc(getUsersCollection(db), profile.uid);
      
      const firestoreProfile: FirestoreUserProfile = {
        ...profile,
        createdAt: Date.now(),
        role: 'student'
      };

      await setDoc(userRef, firestoreProfile, { merge: true });
    } catch (err) {
      console.error('Failed to save user profile in Firestore:', err);
      throw err;
    }
  },

  /**
   * Get or initialize a student's daily session limit limits.
   */
  async getOrCreateUserLimit(userId: string): Promise<FirestoreUserLimit> {
    const today = new Date().toISOString().split('T')[0];

    if (shouldUseLocalSandbox()) {
      console.log('[FirebaseRepository] Mock fallback for getOrCreateUserLimit');
      return {
        userId,
        dailySessionsCount: 0,
        lastActiveDate: today,
        maxSessionsPerDay: 5
      };
    }

    try {
      const db = getFirebaseDb();
      const limitRef = doc(getUserLimitsCollection(db), userId);
      const docSnap = await getDoc(limitRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.lastActiveDate !== today) {
          // Reset daily count on a new day
          const updated = {
            ...data,
            dailySessionsCount: 0,
            lastActiveDate: today
          };
          // Try to update on client (rules might restrict if client writes to limits are admin-only,
          // but we can have it read-only for clients, and we use a server proxy for updates)
          return updated;
        }
        return data;
      } else {
        // Return default limits
        return {
          userId,
          dailySessionsCount: 0,
          lastActiveDate: today,
          maxSessionsPerDay: 5
        };
      }
    } catch (err) {
      console.error('Failed to get or create user limit:', err);
      throw err;
    }
  },

  /**
   * Create a new IELTS Speaking Practice Session in Firestore.
   */
  async createSpeakingSession(session: IELTSPracticeSession): Promise<void> {
    // Always retain the complete deterministic snapshot in local recovery storage.
    MockPracticeService.upsertSession(session);

    if (shouldUseLocalSandbox()) {
      return;
    }

    try {
      const db = getFirebaseDb();
      const sessionRef = doc(getSpeakingSessionsCollection(db), session.id);
      const snapshot = session.selectedTestSnapshot;

      // Current Firestore rules intentionally reject client-created selectedTestSnapshot.
      // Persist safe reconstruction metadata instead, while keeping the full snapshot locally.
      const { selectedTestSnapshot: _localOnlySnapshot, ...sessionWithoutSnapshot } = session;
      const firestoreSession = stripUndefined({
        ...sessionWithoutSnapshot,
        updatedAt: Date.now(),
        snapshotSeed: snapshot?.seed,
        practiceMode: snapshot?.mode,
        snapshotCueCardId: snapshot?.part2CueCard?.id
      }) as FirestoreSpeakingSession;

      await setDoc(sessionRef, firestoreSession);

      const parts = [
        { id: 'part-1', sessionId: session.id, partIndex: 1, status: 'idle' as const, startedAt: Date.now() },
        { id: 'part-2', sessionId: session.id, partIndex: 2, status: 'idle' as const, startedAt: Date.now() },
        { id: 'part-3', sessionId: session.id, partIndex: 3, status: 'idle' as const, startedAt: Date.now() }
      ];

      for (const part of parts) {
        const partRef = doc(getPartsSubcollection(db, session.id), part.id);
        await setDoc(partRef, part);
      }
    } catch (err) {
      console.error('Failed to create speaking session in Firestore:', err);
      throw err;
    }
  },

  /**
   * Submit an speech turn idempotently (using a client-generated ID as document key).
   */
  async saveSessionTurn(sessionId: string, turn: SpeechChunk, partId: string): Promise<void> {
    const turnKey = turn.eventId || turn.id;
    const sanitizedTurn: SpeechChunk = {
      ...turn,
      eventId: turnKey
    };

    if (shouldUseLocalSandbox()) {
      MockPracticeService.saveSessionTurn(sessionId, sanitizedTurn);
      return;
    }

    try {
      const db = getFirebaseDb();
      const turnRef = doc(getTurnsSubcollection(db, sessionId), turnKey);
      
      const firestoreTurn: FirestoreSessionTurn = {
        ...sanitizedTurn,
        sessionId,
        partId
      };

      // SetDoc is fully IDEMPOTENT when used with a client-generated document key.
      await setDoc(turnRef, firestoreTurn, { merge: true });
    } catch (err) {
      console.error('Failed to save session turn idempotently:', err);
      throw err;
    }
  },

  /**
   * Save or update progress of a specific subcollection Part.
   */
  async saveSessionPart(sessionId: string, part: FirestoreSessionPart): Promise<void> {
    if (shouldUseLocalSandbox()) {
      console.log('[FirebaseRepository] Mock fallback for saveSessionPart');
      return;
    }

    try {
      const db = getFirebaseDb();
      const partRef = doc(getPartsSubcollection(db, sessionId), part.id);
      await setDoc(partRef, part, { merge: true });
    } catch (err) {
      console.error('Failed to save session part state:', err);
      throw err;
    }
  },

  /**
   * Update speaking session overall state (Part, state machine, and transcript cache).
   * Enforces explicit status rules: 'completed' | 'abandoned' | 'failed' | 'incomplete' | 'active'
   */
  async updateSessionState(
    sessionId: string, 
    state: ExamState, 
    part: IELTSExamPart, 
    transcript?: SpeechChunk[],
    part2Meta?: any,
    draftNotes?: string
  ): Promise<void> {
    // Determine explicit session status
    let mappedStatus: SessionStatus = 'active';
    if (state === ExamState.COMPLETE) {
      mappedStatus = 'completed';
    } else if (state === ExamState.ABANDONED) {
      mappedStatus = 'abandoned';
    } else if (state === ExamState.FAILED) {
      mappedStatus = 'failed';
    } else if (state === ExamState.IDLE) {
      mappedStatus = 'incomplete';
    }

    if (shouldUseLocalSandbox()) {
      MockPracticeService.updateSessionState(sessionId, state, part, transcript || [], part2Meta, draftNotes);
      return;
    }

    try {
      const db = getFirebaseDb();
      const sessionRef = doc(getSpeakingSessionsCollection(db), sessionId);
      
      const updateData: Record<string, any> = {
        currentState: state,
        currentPart: part,
        status: mappedStatus,
        updatedAt: Date.now()
      };

      if (transcript) {
        updateData.transcript = transcript;
      }

      if (part2Meta) {
        updateData.part2Meta = part2Meta;
      }

      if (draftNotes !== undefined) {
        updateData.draftNotes = draftNotes;
      }

      await updateDoc(sessionRef, updateData);
    } catch (err) {
      console.error('Failed to update session state in Firestore:', err);
      throw err;
    }
  },

  /**
   * Store recording metadata for a practice session.
   */
  async saveRecordingMetadata(sessionId: string, recordingMetadata: RecordingMetadata): Promise<void> {
    if (shouldUseLocalSandbox()) {
      console.log('[FirebaseRepository] Mock fallback for saveRecordingMetadata:', recordingMetadata.status);
      MockPracticeService.saveRecordingMetadata(sessionId, recordingMetadata);
      return;
    }

    try {
      const db = getFirebaseDb();
      const sessionRef = doc(getSpeakingSessionsCollection(db), sessionId);
      await updateDoc(sessionRef, {
        recordingMetadata,
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error('Failed to save recording metadata:', err);
      throw err;
    }
  },

  /**
   * Store concise provider metadata only (No credentials or secret tokens!).
   */
  async saveProviderMetadata(sessionId: string, providerMetadata: ProviderMetadata): Promise<void> {
    // Guarantee non-sensitive fields
    const safeMetadata: ProviderMetadata = {
      providerName: providerMetadata.providerName,
      modelAlias: providerMetadata.modelAlias,
      transport: providerMetadata.transport,
      sampleRate: providerMetadata.sampleRate
    };

    if (shouldUseLocalSandbox()) {
      console.log('[FirebaseRepository] Mock fallback for saveProviderMetadata:', safeMetadata.providerName);
      MockPracticeService.saveProviderMetadata(sessionId, safeMetadata);
      return;
    }

    try {
      const db = getFirebaseDb();
      const sessionRef = doc(getSpeakingSessionsCollection(db), sessionId);
      await updateDoc(sessionRef, {
        providerMetadata: safeMetadata,
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error('Failed to save provider metadata:', err);
      throw err;
    }
  },

  /**
   * Reconstruct full session state from speakingSession, parts, and turns documents.
   * Deduplicates turns by eventId/id and reconciles ordering sequentially.
   */
  async restoreFullSessionState(sessionId: string): Promise<IELTSPracticeSession | undefined> {
    const session = await this.getSessionById(sessionId);
    if (!session) return undefined;

    if (shouldUseLocalSandbox()) {
      return session;
    }

    try {
      const db = getFirebaseDb();
      
      // Fetch turns subcollection
      const turnsQuery = query(
        getTurnsSubcollection(db, sessionId),
        orderBy('sequence', 'asc')
      );
      const turnsSnap = await getDocs(turnsQuery);

      const turnMap = new Map<string, SpeechChunk>();
      
      // Seed with session document cached transcript
      if (session.transcript && Array.isArray(session.transcript)) {
        session.transcript.forEach(turn => {
          const key = turn.eventId || turn.id;
          turnMap.set(key, turn);
        });
      }

      // Merge turns from subcollection (idempotent overwrite)
      turnsSnap.docs.forEach(docSnap => {
        const turnData = docSnap.data();
        const key = turnData.eventId || turnData.id || docSnap.id;
        turnMap.set(key, {
          id: turnData.id || key,
          eventId: key,
          timestamp: turnData.timestamp,
          speaker: turnData.speaker,
          text: turnData.text,
          isFinal: turnData.isFinal,
          sequence: turnData.sequence,
          startTime: turnData.startTime,
          endTime: turnData.endTime,
          interrupted: turnData.interrupted,
          questionId: turnData.questionId
        });
      });

      // Sort turns sequentially by sequence then timestamp
      const sortedTurns = Array.from(turnMap.values()).sort((a, b) => {
        if (a.sequence !== undefined && b.sequence !== undefined) {
          return a.sequence - b.sequence;
        }
        return a.timestamp - b.timestamp;
      });

      return {
        ...session,
        transcript: sortedTurns
      };
    } catch (err) {
      console.warn('[FirebaseRepository] Error restoring turns subcollection, returning basic session:', err);
      return session;
    }
  },

  /**
   * Save evaluation details in Firestore.
   */
  async saveEvaluation(evaluation: IELTSEvaluation): Promise<void> {
    if (shouldUseLocalSandbox()) {
      MockPracticeService.saveEvaluation(evaluation);
      MockPracticeService.updateSessionEvaluationStatus(evaluation.sessionId, 'completed', evaluation.id);
      return;
    }

    try {
      const db = getFirebaseDb();
      const evalRef = doc(getEvaluationsCollection(db), evaluation.id);
      await setDoc(evalRef, evaluation);

      // Link evaluation inside session
      const sessionRef = doc(getSpeakingSessionsCollection(db), evaluation.sessionId);
      await updateDoc(sessionRef, { evaluationId: evaluation.id });
    } catch (err) {
      console.error('Failed to save evaluation report:', err);
      throw err;
    }
  },

  /**
   * Fetch full completed speaking history for a student, ordered by creation date descending.
   */
  async getSessionsHistory(userId: string): Promise<IELTSPracticeSession[]> {
    if (shouldUseLocalSandbox()) {
      return MockPracticeService.getSessions();
    }

    try {
      const db = getFirebaseDb();
      // Keep this query on the automatic single-field userId index so a fresh
      // Firebase project does not require a manual composite index just to load
      // the dashboard. Sort the user's usually-small history client-side.
      const q = query(
        getSpeakingSessionsCollection(db),
        where('userId', '==', userId)
      );
      const querySnap = await getDocs(q);
      return querySnap.docs
        .map(doc => doc.data() as IELTSPracticeSession)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    } catch (err) {
      if (isFirestoreConnectivityError(err)) {
        console.warn('[FirebaseRepository] Firestore history is offline; using the local recovery history.');
        void reconnectFirebaseNetwork();
        return MockPracticeService.getSessions();
      }
      console.error('Failed to fetch session histories:', err);
      throw err;
    }
  },

  /**
   * Fetch a completed structured evaluation for a session.
   */
  async getEvaluation(sessionId: string): Promise<IELTSEvaluation | null> {
    if (shouldUseLocalSandbox()) {
      return MockPracticeService.getEvaluationForSession(sessionId) || null;
    }

    try {
      const db = getFirebaseDb();

      // Firestore security rules are not filters. A collection query that only
      // filters by sessionId can be rejected because the rules protect each
      // evaluation by userId. Resolve the already-authorized session document
      // first, then fetch its linked evaluation by exact document ID. This uses
      // two owner-authorized document reads and needs no composite index.
      const sessionRef = doc(getSpeakingSessionsCollection(db), sessionId);
      const sessionSnap = await getDoc(sessionRef);
      if (!sessionSnap.exists()) {
        return MockPracticeService.getEvaluationForSession(sessionId) || null;
      }

      const sessionData = sessionSnap.data() as IELTSPracticeSession & { evaluationId?: string };
      const evaluationId = typeof sessionData.evaluationId === 'string'
        ? sessionData.evaluationId.trim()
        : '';
      if (!evaluationId) {
        return MockPracticeService.getEvaluationForSession(sessionId) || null;
      }

      const evaluationRef = doc(getEvaluationsCollection(db), evaluationId);
      const evaluationSnap = await getDoc(evaluationRef);
      if (!evaluationSnap.exists()) return null;
      return evaluationSnap.data() as IELTSEvaluation;
    } catch (err) {
      if (isFirestoreConnectivityError(err)) {
        console.warn('[FirebaseRepository] Firestore evaluation lookup is offline; using the local recovery copy.');
        void reconnectFirebaseNetwork();
        return MockPracticeService.getEvaluationForSession(sessionId) || null;
      }
      // A stale/legacy session may reference an evaluation that the current
      // user is not allowed to read. That should not break the whole dashboard.
      if ((err as any)?.code === 'permission-denied') {
        console.warn('[FirebaseRepository] Evaluation is not readable for this session; hiding it from the dashboard.');
        return MockPracticeService.getEvaluationForSession(sessionId) || null;
      }
      console.error('Failed to fetch session evaluation:', err);
      throw err;
    }
  },

  /**
   * Fetch a single speaking session by ID from Firestore or mock fallback.
   */
  async getSessionById(sessionId: string): Promise<IELTSPracticeSession | undefined> {
    const localSession = MockPracticeService.getSessionById(sessionId);

    if (shouldUseLocalSandbox()) {
      return localSession;
    }

    try {
      const db = getFirebaseDb();
      const docRef = doc(getSpeakingSessionsCollection(db), sessionId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) {
        return localSession;
      }

      const remote = docSnap.data() as IELTSPracticeSession & {
        snapshotSeed?: string;
        practiceMode?: 'full' | 'part1' | 'part2' | 'part3';
        snapshotCueCardId?: string;
      };

      let selectedTestSnapshot = remote.selectedTestSnapshot || localSession?.selectedTestSnapshot;
      if (!selectedTestSnapshot && remote.snapshotSeed && remote.practiceMode) {
        selectedTestSnapshot = generateTestSnapshot(
          remote.snapshotSeed,
          remote.practiceMode,
          remote.snapshotCueCardId
        );
      }

      const merged = {
        ...localSession,
        ...remote,
        ...(selectedTestSnapshot ? { selectedTestSnapshot } : {}),
      } as IELTSPracticeSession;

      MockPracticeService.upsertSession(merged);
      return merged;
    } catch (err) {
      console.warn('[FirebaseRepository] Firestore session lookup failed; using the local recovery copy.', err);
      if (isFirestoreConnectivityError(err)) {
        void reconnectFirebaseNetwork();
      }
      return localSession;
    }
  },

  /**
   * Deletes voice recordings for the authenticated user.
   */
  async deleteSessionRecordingsForUser(userId: string): Promise<void> {
    if (shouldUseLocalSandbox()) {
      MockPracticeService.deleteRecordingsForUser(userId);
      return;
    }

    const token = await getFirebaseIdToken();
    if (!token) throw new Error('Please sign in again before deleting recordings.');

    const response = await fetch('/api/privacy/recordings', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || payload.error || 'Failed to delete voice recordings.');
    }
  },

  /**
   * Deletes all practice data for the authenticated user while preserving the login account.
   */
  async deleteUserData(userId: string): Promise<void> {
    if (shouldUseLocalSandbox()) {
      MockPracticeService.deleteAllPracticeDataForUser(userId);
      return;
    }

    const token = await getFirebaseIdToken();
    if (!token) throw new Error('Please sign in again before deleting practice data.');

    const response = await fetch('/api/privacy/data', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || payload.error || 'Failed to delete practice data.');
    }
  }
};

export function getFirebaseRepository() {
  return FirebaseRepository;
}
