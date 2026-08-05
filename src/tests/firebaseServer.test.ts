/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFirebaseEnabled } from '../services/firebaseClient';
import {
  isFirebaseServerEnabled,
  deleteSessionRecursively,
  isFirestoreAvailabilityError,
  markFirestoreServerUnavailable,
} from '../services/firebaseServer';
import { FirebaseRepository } from '../services/firebaseRepository';
import { ExamState, IELTSExamPart } from '../types';

describe('Firebase Integration and Sandbox Safety Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should run inside sandbox fallback modes safely if environment variables are not loaded', () => {
    // True or False depending on run configuration, but must not crash
    const clientEnabled = isFirebaseEnabled();
    const serverEnabled = isFirebaseServerEnabled();

    expect(typeof clientEnabled).toBe('boolean');
    expect(typeof serverEnabled).toBe('boolean');
  });

  it('recognizes disabled Firestore API errors and activates graceful persistence fallback', () => {
    const apiDisabledError = {
      code: 7,
      message: 'PERMISSION_DENIED: Cloud Firestore API has not been used in project demo before or it is disabled.'
    };

    expect(isFirestoreAvailabilityError(apiDisabledError)).toBe(true);
    expect(markFirestoreServerUnavailable(apiDisabledError)).toBe(true);
    expect(isFirestoreAvailabilityError(new Error('Invalid session payload'))).toBe(false);
  });

  it('should resolve fallback operations on client-side repository when disabled', async () => {
    // If firebase is disabled, client repository should fall back to mock services without crashing
    const userId = 'sandbox-student-123';
    
    const limit = await FirebaseRepository.getOrCreateUserLimit(userId);
    expect(limit).toBeDefined();
    expect(limit.userId).toBe(userId);
    expect(limit.dailySessionsCount).toBe(0);
    expect(limit.maxSessionsPerDay).toBe(5);
  });

  it('should simulate recursive deletions perfectly in offline fallback environments', async () => {
    const mockSessionId = 'session-mock-999';
    const mockUserId = 'user-mock-888';

    // Executes helper - returns success true under mock environment
    const result = await deleteSessionRecursively(mockSessionId, mockUserId);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBeGreaterThan(0);
  });
});
