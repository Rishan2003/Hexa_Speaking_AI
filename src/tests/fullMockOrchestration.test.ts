/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExamState, IELTSExamPart } from '../types';
import { generateTestSnapshot } from '../services/questionBank';
import {
  createInitialContext,
  examEngineReducer,
  serializeRecoverySnapshot,
  MockRealtimeProvider,
  PART1_QUESTION_LIMIT,
  PART3_QUESTION_LIMIT
} from '../services/examEngine';
import { SessionLeaseManager } from '../services/sessionLease';
import { MockPracticeService } from '../services/mockService';

describe('Full Mock Orchestration Across Parts 1, 2, and 3', () => {
  const fullSnapshot = generateTestSnapshot('orchestration-seed-123', 'full');

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('1. should complete a full mock test across Parts 1, 2, and 3 once, storing all parts without repeating questions or showing intermediate feedback', async () => {
    // Register mock session in MockPracticeService
    MockPracticeService.createSession(fullSnapshot.part1Topic?.title || 'General Topic', undefined, fullSnapshot, 'sess-full-1');

    let context = createInitialContext('user-orch-1', fullSnapshot, 'sess-full-1');
    expect(context.mode).toBe('full');
    expect(context.currentState).toBe(ExamState.IDLE);

    // Initialize provider with MockRealtimeProvider
    let ctxChangeCount = 0;
    const provider = new MockRealtimeProvider('user-orch-1', fullSnapshot, 'sess-full-1', (updatedCtx) => {
      context = updatedCtx;
      ctxChangeCount++;
    });

    await provider.initialize({
      sampleRate: 16000,
      onTranscript: () => {},
      onError: () => {},
      onStatusChange: () => {}
    });

    // Provider initialization completes startup automatically and reaches PART1_ASKING
    expect(context.currentState).toBe(ExamState.PART1_ASKING);
    expect(context.currentPart).toBe(IELTSExamPart.PART_1);

    // Answer Part 1 Questions 1, 2, 3
    for (let i = 0; i < PART1_QUESTION_LIMIT; i++) {
      context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: `Part 1 Answer ${i + 1}` });
      expect(context.currentState).toBe(ExamState.PART1_COMPLETED);

      const nextText = i < PART1_QUESTION_LIMIT - 1
        ? `Part 1 Question ${i + 2}`
        : 'That concludes Part 1. Moving to Part 2.';
      context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: nextText });
    }

    // Should transition seamlessly to Part 2 INSTRUCTIONS without intermediate feedback or score
    expect(context.currentState).toBe(ExamState.PART2_INSTRUCTIONS);
    expect(context.currentPart).toBe(IELTSExamPart.PART_2);
    expect(context.evaluationId).toBeUndefined(); // NO intermediate feedback!

    // Examiner delivers cue card instructions
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Here is your topic card...' });
    expect(context.currentState).toBe(ExamState.PART2_PREPARATION);
    expect(context.prepSecondsLeft).toBe(60);

    // User inputs draft notes during preparation
    context = examEngineReducer(context, { type: 'UPDATE_NOTES', notes: 'Key points: History, Location, Feeling.' });
    expect(context.draftNotes).toBe('Key points: History, Location, Feeling.');

    // Prep time ends -> Long Turn starts
    context = examEngineReducer(context, { type: 'PREPARATION_COMPLETE' });
    expect(context.currentState).toBe(ExamState.PART2_LONG_TURN);

    // Candidate speaks for 120s
    context = examEngineReducer(context, { type: 'TIMER_TICK', speakingSecondsDelta: 120 });
    expect(context.currentState).toBe(ExamState.PART2_CLOSING);

    // Candidate answers closing question
    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'Yes, I would.' });
    expect(context.currentState).toBe(ExamState.PART2_COMPLETED);

    // Part 2 concludes, transitions seamlessly to Part 3
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Thank you. Moving to Part 3.' });
    expect(context.currentState).toBe(ExamState.PART3_ASKING);
    expect(context.currentPart).toBe(IELTSExamPart.PART_3);
    expect(context.evaluationId).toBeUndefined(); // NO intermediate feedback!

    // Answer Part 3 Questions 1 to 5
    const p3Questions = fullSnapshot.part3Questions || [];
    expect(p3Questions.length).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < PART3_QUESTION_LIMIT; i++) {
      context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: `Part 3 Answer ${i + 1}` });
      expect(context.currentState).toBe(ExamState.PART3_COMPLETED);
      expect(context.completedQuestionIds).toContain(p3Questions[i].id);

      const nextText = i < PART3_QUESTION_LIMIT - 1
        ? p3Questions[i + 1].text
        : 'That concludes the entire speaking exam.';
      context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: nextText });
    }

    // Test finishes, moves to FINALIZING -> EVALUATING -> COMPLETE
    expect(context.currentState).toBe(ExamState.FINALIZING);

    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Evaluation in progress...' });
    expect(context.currentState).toBe(ExamState.EVALUATING);

    context = examEngineReducer(context, { type: 'EVALUATION_COMPLETE', evaluationId: 'eval-123' });
    expect(context.currentState).toBe(ExamState.COMPLETE);
    expect(context.evaluationId).toBe('eval-123');

    // Verify all 3 parts stored in transcript and completed question IDs
    expect(context.completedQuestionIds.length).toBe(PART1_QUESTION_LIMIT + PART3_QUESTION_LIMIT);
    expect(context.transcript.length).toBeGreaterThan(10);
  });

  it('2. should recover exact state on page refresh in each section (Part 1, Part 2 Prep, Part 2 Long Turn, Part 3)', () => {
    let context = createInitialContext('user-refresh', fullSnapshot, 'sess-refresh');

    // Case A: Refresh in Part 1
    context.currentState = ExamState.PART1_ASKING;
    context.currentPart1QuestionIndex = 1;
    context.completedQuestionIds = ['p1-q1'];
    let snapStr = serializeRecoverySnapshot(context);

    let restored = createInitialContext('user-refresh', fullSnapshot, 'sess-refresh');
    restored = examEngineReducer(restored, { type: 'RECOVER', snapshotString: snapStr });
    expect(restored.currentState).toBe(ExamState.PART1_ASKING);
    expect(restored.currentPart1QuestionIndex).toBe(1);
    expect(restored.completedQuestionIds).toContain('p1-q1');

    // Case B: Refresh in Part 2 Preparation (with 25s elapsed)
    const now = Date.now();
    context.currentState = ExamState.PART2_PREPARATION;
    context.currentPart = IELTSExamPart.PART_2;
    context.draftNotes = 'Draft notes for cue card';
    context.part2Meta = { prepStartTime: now - 25000, notes: 'Draft notes for cue card' };
    snapStr = serializeRecoverySnapshot(context);

    restored = createInitialContext('user-refresh', fullSnapshot, 'sess-refresh');
    restored = examEngineReducer(restored, { type: 'RECOVER', snapshotString: snapStr });
    expect(restored.currentState).toBe(ExamState.PART2_PREPARATION);
    expect(restored.prepSecondsLeft).toBe(35); // 60 - 25 = 35s remaining
    expect(restored.draftNotes).toBe('Draft notes for cue card');

    // Case C: Refresh in Part 2 Long Turn (with 50s elapsed)
    context.currentState = ExamState.PART2_LONG_TURN;
    context.part2Meta = { longTurnStartTime: now - 50000 };
    snapStr = serializeRecoverySnapshot(context);

    restored = createInitialContext('user-refresh', fullSnapshot, 'sess-refresh');
    restored = examEngineReducer(restored, { type: 'RECOVER', snapshotString: snapStr });
    expect(restored.currentState).toBe(ExamState.PART2_LONG_TURN);
    expect(restored.speakingSecondsElapsed).toBe(50);

    // Case D: Refresh in Part 3
    const p3Qs = fullSnapshot.part3Questions || [];
    context.currentState = ExamState.PART3_ASKING;
    context.currentPart = IELTSExamPart.PART_3;
    context.completedQuestionIds = [p3Qs[0].id, p3Qs[1].id];
    snapStr = serializeRecoverySnapshot(context);

    restored = createInitialContext('user-refresh', fullSnapshot, 'sess-refresh');
    restored = examEngineReducer(restored, { type: 'RECOVER', snapshotString: snapStr });
    expect(restored.currentState).toBe(ExamState.PART3_ASKING);
    expect(restored.currentPart3QuestionIndex).toBe(2);
  });

  it('3. should enter RECOVERING on temporary network loss and resume from unanswered step upon reconnection', () => {
    let context = createInitialContext('user-net', fullSnapshot, 'sess-net');
    context.currentState = ExamState.PART3_ASKING;
    context.currentPart = IELTSExamPart.PART_3;
    context.currentPart3QuestionIndex = 2;

    // Simulate network loss event
    context = examEngineReducer(context, { type: 'DISCONNECT' });
    expect(context.currentState).toBe(ExamState.RECOVERING);
    expect(context.preDisconnectState).toBe(ExamState.PART3_ASKING);

    // Reconnection succeeds
    context = examEngineReducer(context, { type: 'CONNECTION_ESTABLISHED' });
    expect(context.currentState).toBe(ExamState.PART3_ASKING);
    expect(context.currentPart3QuestionIndex).toBe(2);
    expect(context.reconnectAttempts).toBe(1);
  });

  it('4. should reject duplicate startup/connect events idempotently without mutating state', () => {
    let context = createInitialContext('user-idem', fullSnapshot, 'sess-idem');
    context.currentState = ExamState.PART2_LONG_TURN;
    context.speakingSecondsElapsed = 40;

    // Dispatch invalid START_EXAM event in the middle of Part 2
    const before = { ...context };
    context = examEngineReducer(context, { type: 'START_EXAM', userId: 'user-idem', snapshot: fullSnapshot });

    expect(context.currentState).toBe(ExamState.PART2_LONG_TURN);
    expect(context.speakingSecondsElapsed).toBe(40);
  });

  it('5. should handle unrecoverable failure or abandonment cleanly while preserving transcript data', () => {
    let context = createInitialContext('user-fail', fullSnapshot, 'sess-fail');
    context.currentState = ExamState.PART2_LONG_TURN;
    context.transcript = [
      { id: '1', timestamp: Date.now(), speaker: 'examiner', text: 'Question 1', isFinal: true },
      { id: '2', timestamp: Date.now(), speaker: 'candidate', text: 'Answer 1', isFinal: true }
    ];

    // Hardware failure
    context = examEngineReducer(context, { type: 'FAIL', error: 'Microphone hardware disconnected' });
    expect(context.currentState).toBe(ExamState.FAILED);
    expect(context.errorMessage).toBe('Microphone hardware disconnected');
    expect(context.transcript.length).toBe(2); // Transcript PRESERVED!

    // User abandons
    context = examEngineReducer(context, { type: 'ABANDON' });
    expect(context.currentState).toBe(ExamState.ABANDONED);
    expect(context.transcript.length).toBe(2); // Transcript PRESERVED!
  });

  it('6. should prevent concurrent tab execution using SessionLeaseManager lock', () => {
    const sessionId = 'sess-multi-tab-test';
    const tab1 = 'tab-primary-111';
    const tab2 = 'tab-secondary-222';

    // Tab 1 acquires lease
    const result1 = SessionLeaseManager.acquireLease(sessionId, tab1);
    expect(result1.acquired).toBe(true);
    expect(result1.ownerTabId).toBe(tab1);

    // Tab 2 attempts to acquire lease for the same session
    const result2 = SessionLeaseManager.acquireLease(sessionId, tab2);
    expect(result2.acquired).toBe(false);
    expect(result2.ownerTabId).toBe(tab1);

    // Tab 2 checks lock status
    const isLocked = SessionLeaseManager.isTabLocked(sessionId, tab2);
    expect(isLocked).toBe(true);

    // Tab 1 releases lease
    SessionLeaseManager.releaseLease(sessionId, tab1);

    // Tab 2 acquires lease now
    const result2Retry = SessionLeaseManager.acquireLease(sessionId, tab2);
    expect(result2Retry.acquired).toBe(true);
    expect(SessionLeaseManager.isTabLocked(sessionId, tab2)).toBe(false);
  });
});
