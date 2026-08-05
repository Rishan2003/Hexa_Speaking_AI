/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '../config';
import { MockAuthService, MockPracticeService } from '../services/mockService';
import { IELTSExamPart, ExamState } from '../types';

describe('SpeakReady IELTS Smoke Tests', () => {
  it('should successfully load APP_CONFIG properties', () => {
    expect(APP_CONFIG).toBeDefined();
    expect(APP_CONFIG.geminiVoiceModel).toBe('gemini-3.1-flash-live-preview');
    expect(APP_CONFIG.geminiEvaluationModel).toBe('gemini-3.6-flash');
  });

  it('should verify Mock Authentication states', () => {
    // Starts unauthenticated
    MockAuthService.logout();
    expect(MockAuthService.getCurrentUser()).toBeNull();

    // Simulates quick login
    const user = MockAuthService.login('candidate@test.com', 8.0);
    expect(user).toBeDefined();
    expect(user.uid).toBe('mock-user-id');
    expect(user.targetBand).toBe(8.0);
    expect(user.onboarded).toBe(true);

    // Retains user profile in LocalStorage simulation
    const retrieved = MockAuthService.getCurrentUser();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.email).toBe('candidate@test.com');
  });

  it('should verify IELTS session generation and deterministic grading', () => {
    // Generate new mock practice session
    const session = MockPracticeService.createSession('Describe a valuable piece of advice', 'cue-3');
    expect(session).toBeDefined();
    expect(session.id).toContain('session-');
    expect(session.currentPart).toBe(IELTSExamPart.PART_1);
    expect(session.currentState).toBe(ExamState.IDLE);

    // Simulate speaking session completion with transcripts
    const mockTranscript = [
      { id: 't1', timestamp: Date.now(), speaker: 'examiner' as const, text: 'Welcome to the speaking test.', isFinal: true },
      { id: 't2', timestamp: Date.now() + 1000, speaker: 'candidate' as const, text: 'Hello, I would like to tell you about my studies.', isFinal: true },
    ];

    const updatedSession = MockPracticeService.updateSessionState(
      session.id,
      ExamState.COMPLETE,
      IELTSExamPart.PART_3,
      mockTranscript
    );

    expect(updatedSession.status).toBe('completed');
    expect(updatedSession.currentState).toBe(ExamState.COMPLETE);

    // Generate diagnostic evaluation report
    const evaluation = MockPracticeService.generateEvaluation(session.id);
    expect(evaluation).toBeDefined();
    expect(evaluation.sessionId).toBe(session.id);
    expect(evaluation.estimatedOverallBand).toBeGreaterThanOrEqual(4.0);
    expect(evaluation.estimatedOverallBand).toBeLessThanOrEqual(9.0);
    expect(evaluation.criteria.fluencyAndCoherence.score).toBeDefined();
    expect(evaluation.criteria.grammaticalRangeAccuracy.corrections.length).toBeGreaterThan(0);
    expect(evaluation.actionPlan.length).toBeGreaterThan(0);
  });
});
