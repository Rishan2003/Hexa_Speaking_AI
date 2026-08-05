/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { IELTSEvaluation, IELTSPracticeSession } from '../types';
import { isFirebaseEnabled, getFirebaseAuth } from './firebaseClient';
import { MockPracticeService } from './mockService';
import { APP_CONFIG } from '../config';

const DEFAULT_LOOKUP_TIMEOUT_MS = 12000;
const DEFAULT_GENERATION_TIMEOUT_MS = 60000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('The evaluation service took too long to respond. Please retry the evaluation.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const EvaluationApiService = {
  /**
   * Triggers the authenticated server-side post-test evaluation pipeline
   */
  async generateEvaluation(
    sessionId: string,
    forceRetry = false,
    sessionEvidence?: IELTSPracticeSession
  ): Promise<IELTSEvaluation> {
    if (APP_CONFIG.useMocks) {
      return MockPracticeService.generateEvaluation(sessionId);
    }

    // Never silently downgrade a real evaluation request to the canned mock
    // evaluator just because Firebase client initialization failed. A mock band
    // can look like a genuine IELTS assessment, which is much worse than an
    // explicit configuration error.
    if (!isFirebaseEnabled()) {
      throw new Error('Real evaluation is unavailable because Firebase authentication is not configured in this browser build. Mock scoring was not substituted.');
    }

    const auth = getFirebaseAuth();
    if (!auth.currentUser) {
      throw new Error('Your sign-in session has expired. Please sign in again.');
    }
    const token = await withTimeout(
      auth.currentUser.getIdToken(),
      DEFAULT_LOOKUP_TIMEOUT_MS,
      'Authentication timed out. Please retry the evaluation.'
    );

    const response = await fetchWithTimeout('/api/evaluations/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        sessionId,
        forceRetry,
        sessionEvidence: sessionEvidence
          ? {
              id: sessionEvidence.id,
              userId: sessionEvidence.userId,
              status: sessionEvidence.status,
              currentState: sessionEvidence.currentState,
              currentPart: sessionEvidence.currentPart,
              selectedTestSnapshot: sessionEvidence.selectedTestSnapshot,
              transcript: sessionEvidence.transcript,
              part2Meta: sessionEvidence.part2Meta,
              draftNotes: sessionEvidence.draftNotes
            }
          : undefined
      })
    }, DEFAULT_GENERATION_TIMEOUT_MS);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({} as any));
      const requestId = errorData.requestId || response.headers.get('X-Request-ID');
      const code = errorData.code || `HTTP_${response.status}`;
      const baseMessage = errorData.error || `Evaluation request failed (${response.status}).`;
      const diagnosticSuffix = [
        code ? `Code: ${code}` : '',
        requestId ? `Request ID: ${requestId}` : '',
      ].filter(Boolean).join(' · ');
      throw new Error(diagnosticSuffix ? `${baseMessage}\n${diagnosticSuffix}` : baseMessage);
    }

    const evaluation = await response.json() as IELTSEvaluation;
    // Cache only the actual server result. This provides reload resilience and
    // never invokes the deterministic mock evaluator.
    MockPracticeService.saveEvaluation(evaluation);
    return evaluation;
  },

  /**
   * Fetches existing evaluation for session
   */
  async getEvaluation(sessionId: string): Promise<IELTSEvaluation | null> {
    if (APP_CONFIG.useMocks) {
      return MockPracticeService.getEvaluationForSession(sessionId) || null;
    }


    if (!isFirebaseEnabled()) {
      throw new Error('Real evaluation lookup is unavailable because Firebase authentication is not configured.');
    }

    const auth = getFirebaseAuth();
    if (!auth.currentUser) {
      throw new Error('Your sign-in session has expired. Please sign in again.');
    }
    const token = await withTimeout(
      auth.currentUser.getIdToken(),
      DEFAULT_LOOKUP_TIMEOUT_MS,
      'Authentication timed out while loading feedback.'
    );

    const response = await fetchWithTimeout(`/api/evaluations/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }, DEFAULT_LOOKUP_TIMEOUT_MS);

    if (response.status === 404) {
      const cached = MockPracticeService.getEvaluationForSession(sessionId);
      return cached?.evaluationEngine === 'gemini' ? cached : null;
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({} as any));
      const cached = MockPracticeService.getEvaluationForSession(sessionId);
      if (cached?.evaluationEngine === 'gemini') {
        console.warn('[EvaluationApiService] Server lookup failed; using cached genuine Gemini evaluation.', errorData);
        return cached;
      }
      const requestId = errorData.requestId || response.headers.get('X-Request-ID');
      const code = errorData.code || `HTTP_${response.status}`;
      const baseMessage = errorData.error || `Evaluation lookup failed (${response.status}).`;
      const diagnosticSuffix = [code ? `Code: ${code}` : '', requestId ? `Request ID: ${requestId}` : ''].filter(Boolean).join(' · ');
      throw new Error(diagnosticSuffix ? `${baseMessage}\n${diagnosticSuffix}` : baseMessage);
    }

    const evaluation = await response.json() as IELTSEvaluation;
    MockPracticeService.saveEvaluation(evaluation);
    return evaluation;
  }
};
