/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ExamState, IELTSExamPart } from '../types';
import { generateTestSnapshot } from '../services/questionBank';
import {
  createInitialContext,
  examEngineReducer,
  serializeRecoverySnapshot,
  PART1_QUESTION_LIMIT,
  PART3_QUESTION_LIMIT
} from '../services/examEngine';

describe('Deterministic IELTS Exam State Machine Tests', () => {
  const mockSnapshot = generateTestSnapshot('test-seed-123', 'full');

  it('should initialize to IDLE and transition through HAPPY path correctly', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-1');
    expect(context.currentState).toBe(ExamState.IDLE);
    expect(context.currentPart).toBe(IELTSExamPart.PART_1);

    // 1. Start Exam
    context = examEngineReducer(context, { type: 'START_EXAM', userId: 'user-1', snapshot: mockSnapshot });
    expect(context.currentState).toBe(ExamState.PRECHECK);

    // 2. Precheck Complete
    context = examEngineReducer(context, { type: 'PRECHECK_COMPLETE' });
    expect(context.currentState).toBe(ExamState.CONNECTING);

    // 3. Connection Established
    context = examEngineReducer(context, { type: 'CONNECTION_ESTABLISHED' });
    expect(context.currentState).toBe(ExamState.INTRO);

    // 4. Examiner Spoke Intro Welcome Text
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Welcome to the exam.' });
    expect(context.currentState).toBe(ExamState.PART1_ASKING);
    expect(context.transcript.length).toBe(1);
    expect(context.transcript[0].speaker).toBe('examiner');

    // 5. Part 1 Question 1 Candidate Speaks
    context = examEngineReducer(context, { type: 'CANDIDATE_SPEECH_START' });
    expect(context.currentState).toBe(ExamState.PART1_LISTENING);

    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'My name is John and I live in Paris.' });
    expect(context.currentState).toBe(ExamState.PART1_COMPLETED);
    expect(context.currentPart1QuestionIndex).toBe(1);
    expect(context.completedQuestionIds).toContain(mockSnapshot.part1Topic?.questions[0].id);

    // 6. Question 2
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Do you prefer morning or evening?' });
    expect(context.currentState).toBe(ExamState.PART1_ASKING);

    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'I prefer morning.' });
    expect(context.currentState).toBe(ExamState.PART1_COMPLETED);
    expect(context.currentPart1QuestionIndex).toBe(2);

    // 7. Question 3
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'What is your hobby?' });
    expect(context.currentState).toBe(ExamState.PART1_ASKING);

    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'I like reading books.' });
    expect(context.currentState).toBe(ExamState.PART1_COMPLETED);
    expect(context.currentPart1QuestionIndex).toBe(3);

    // Continue through the remaining stored Part 1 questions. The realistic
    // Part 1 flow now contains two topic frames x four questions = 8 total.
    for (let i = 3; i < PART1_QUESTION_LIMIT; i++) {
      context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: `Part 1 question ${i + 1}?` });
      expect(context.currentState).toBe(ExamState.PART1_ASKING);
      context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: `Part 1 answer ${i + 1}.` });
      expect(context.currentState).toBe(ExamState.PART1_COMPLETED);
      expect(context.currentPart1QuestionIndex).toBe(i + 1);
    }

    // 8. Transition to Part 2 after all 8 Part 1 questions
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'That concludes Part 1. We will now proceed to Part 2.' });
    expect(context.currentState).toBe(ExamState.PART2_INSTRUCTIONS);
    expect(context.currentPart).toBe(IELTSExamPart.PART_2);

    // 9. Examiner instructions completed
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Here is your card.' });
    expect(context.currentState).toBe(ExamState.PART2_PREPARATION);
    expect(context.prepSecondsLeft).toBe(60);

    // 10. Timer ticks during preparation
    context = examEngineReducer(context, { type: 'TIMER_TICK', prepSecondsDelta: 30 });
    expect(context.prepSecondsLeft).toBe(30);

    // Timer completes
    context = examEngineReducer(context, { type: 'TIMER_TICK', prepSecondsDelta: 30 });
    expect(context.currentState).toBe(ExamState.PART2_LONG_TURN);
    expect(context.speakingSecondsElapsed).toBe(0);

    // 11. Timer ticks during speaking
    context = examEngineReducer(context, { type: 'TIMER_TICK', speakingSecondsDelta: 45 });
    expect(context.speakingSecondsElapsed).toBe(45);

    // Candidate speaks in between
    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'I want to speak about a memorable historic site...' });
    expect(context.speakingSecondsElapsed).toBe(45);

    // Speak ends via user action or 120s timer
    context = examEngineReducer(context, { type: 'LONG_TURN_COMPLETE' });
    expect(context.currentState).toBe(ExamState.PART2_CLOSING);

    // Candidate answers closing question
    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'Yes, I would definitely visit again.' });
    expect(context.currentState).toBe(ExamState.PART2_COMPLETED);

    // Transition to Part 3
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Proceeding to Part 3.' });
    expect(context.currentState).toBe(ExamState.PART3_ASKING);
    expect(context.currentPart).toBe(IELTSExamPart.PART_3);

    // Part 3 Questions loop up to PART3_QUESTION_LIMIT
    for (let i = 0; i < PART3_QUESTION_LIMIT; i++) {
      if (i > 0) {
        context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: `Question ${i + 1} text?` });
        expect(context.currentState).toBe(ExamState.PART3_ASKING);
      }
      context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: `Abstract answer ${i + 1}.` });
      expect(context.currentState).toBe(ExamState.PART3_COMPLETED);
      expect(context.currentPart3QuestionIndex).toBe(i + 1);
    }

    // Transition to FINALIZING (reached limit)
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'That concludes the exam. Finalizing...' });
    expect(context.currentState).toBe(ExamState.FINALIZING);

    // Start evaluation
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Calculating band scores...' });
    expect(context.currentState).toBe(ExamState.EVALUATING);

    // Complete evaluation
    context = examEngineReducer(context, { type: 'EVALUATION_COMPLETE', evaluationId: 'eval-unique-999' });
    expect(context.currentState).toBe(ExamState.COMPLETE);
    expect(context.evaluationId).toBe('eval-unique-999');
  });

  it('should handle timer-driven auto transitions correctly', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-1');
    context.currentState = ExamState.PART2_PREPARATION;
    context.prepSecondsLeft = 60;

    // Tick 60 seconds
    context = examEngineReducer(context, { type: 'TIMER_TICK', prepSecondsDelta: 60 });
    expect(context.currentState).toBe(ExamState.PART2_LONG_TURN);
    expect(context.speakingSecondsElapsed).toBe(0);

    // Tick 120 seconds in speaking
    context = examEngineReducer(context, { type: 'TIMER_TICK', speakingSecondsDelta: 120 });
    expect(context.currentState).toBe(ExamState.PART2_CLOSING);
  });

  it('should handle network drops and successful recoveries', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-1');
    context.currentState = ExamState.PART1_ASKING;
    context.currentPart1QuestionIndex = 2;

    // Disconnect happens
    context = examEngineReducer(context, { type: 'DISCONNECT' });
    expect(context.currentState).toBe(ExamState.RECOVERING);
    expect(context.preDisconnectState).toBe(ExamState.PART1_ASKING);

    // Reconnection succeeded
    context = examEngineReducer(context, { type: 'CONNECTION_ESTABLISHED' });
    expect(context.currentState).toBe(ExamState.PART1_ASKING);
    expect(context.reconnectAttempts).toBe(1);
    expect(context.currentPart1QuestionIndex).toBe(2);
  });

  it('should support serializable recovery snapshot and restoration', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-1');
    context.currentState = ExamState.PART3_ASKING;
    context.currentPart3QuestionIndex = 2;
    context.completedQuestionIds = ['p3-q-0', 'p3-q-1'];

    const snapshotString = serializeRecoverySnapshot(context);

    // Create a blank/new context and recover it
    let recoveredContext = createInitialContext('user-1', mockSnapshot, 'session-2');
    recoveredContext = examEngineReducer(recoveredContext, { type: 'RECOVER', snapshotString });

    expect(recoveredContext.sessionId).toBe('session-1');
    expect(recoveredContext.currentState).toBe(ExamState.PART3_ASKING);
    expect(recoveredContext.currentPart3QuestionIndex).toBe(2);
    expect(recoveredContext.completedQuestionIds).toEqual(['p3-q-0', 'p3-q-1']);
  });

  it('should handle abandonment gracefully', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-1');
    context.currentState = ExamState.PART2_PREPARATION;

    context = examEngineReducer(context, { type: 'ABANDON' });
    expect(context.currentState).toBe(ExamState.ABANDONED);
  });

  it('should support Part 2 typed notes without generating spoken transcript turns', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-p2-notes');
    context.currentState = ExamState.PART2_PREPARATION;

    context = examEngineReducer(context, { type: 'UPDATE_NOTES', notes: 'Key point 1: Clean air\nKey point 2: Friendly people' });

    expect(context.draftNotes).toBe('Key point 1: Clean air\nKey point 2: Friendly people');
    expect(context.part2Meta.notes).toBe('Key point 1: Clean air\nKey point 2: Friendly people');
    expect(context.transcript.length).toBe(0); // Notes MUST NOT be added to transcript as spoken turns
  });

  it('should support manual early start policy during Part 2 preparation', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-p2-early');
    context.currentState = ExamState.PART2_PREPARATION;
    context.prepSecondsLeft = 45; // 15s into prep

    context = examEngineReducer(context, { type: 'PREPARATION_COMPLETE' });

    expect(context.currentState).toBe(ExamState.PART2_LONG_TURN);
    expect(context.prepSecondsLeft).toBe(0);
    expect(context.part2Meta.prepEndTime).toBeDefined();
  });

  it('should record interruption marker and reason when 2-minute limit is reached', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-p2-interrupt');
    context.currentState = ExamState.PART2_LONG_TURN;
    context.speakingSecondsElapsed = 119;

    context = examEngineReducer(context, { type: 'TIMER_TICK', speakingSecondsDelta: 1 });

    expect(context.currentState).toBe(ExamState.PART2_CLOSING);
    expect(context.speakingSecondsElapsed).toBe(120);
    expect(context.part2Meta.interrupted).toBe(true);
    expect(context.part2Meta.interruptionReason).toBe('MAX_DURATION_EXCEEDED');
    expect(context.part2Meta.longTurnDuration).toBe(120);
  });

  it('should recalculate preparation time accurately upon reconnection during prep', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-p2-recon-prep');
    const prepStart = Date.now() - 25000; // 25 seconds ago
    context.currentState = ExamState.PART2_PREPARATION;
    context.part2Meta = { prepStartTime: prepStart };

    const snapshotString = serializeRecoverySnapshot(context);

    let recovered = createInitialContext('user-1', mockSnapshot, 'session-p2-recon-prep');
    recovered = examEngineReducer(recovered, { type: 'RECOVER', snapshotString });

    expect(recovered.currentState).toBe(ExamState.PART2_PREPARATION);
    expect(recovered.prepSecondsLeft).toBeGreaterThanOrEqual(34);
    expect(recovered.prepSecondsLeft).toBeLessThanOrEqual(35);
  });

  it('should recalculate long turn speaking time accurately upon reconnection during speech', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-p2-recon-turn');
    const speechStart = Date.now() - 50000; // 50 seconds ago
    context.currentState = ExamState.PART2_LONG_TURN;
    context.part2Meta = { longTurnStartTime: speechStart };

    const snapshotString = serializeRecoverySnapshot(context);

    let recovered = createInitialContext('user-1', mockSnapshot, 'session-p2-recon-turn');
    recovered = examEngineReducer(recovered, { type: 'RECOVER', snapshotString });

    expect(recovered.currentState).toBe(ExamState.PART2_LONG_TURN);
    expect(recovered.speakingSecondsElapsed).toBeGreaterThanOrEqual(49);
    expect(recovered.speakingSecondsElapsed).toBeLessThanOrEqual(51);
  });

  it('should handle failures gracefully', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-1');
    context.currentState = ExamState.CONNECTING;

    context = examEngineReducer(context, { type: 'FAIL', error: 'WebSocket creation timed out' });
    expect(context.currentState).toBe(ExamState.FAILED);
    expect(context.errorMessage).toBe('WebSocket creation timed out');
  });

  it('should reject invalid transitions and duplicate events safely without changing state', () => {
    let context = createInitialContext('user-1', mockSnapshot, 'session-1');
    expect(context.currentState).toBe(ExamState.IDLE);

    // Duplicate START_EXAM
    context = examEngineReducer(context, { type: 'START_EXAM', userId: 'user-1', snapshot: mockSnapshot });
    expect(context.currentState).toBe(ExamState.PRECHECK);

    // Calling duplicate START_EXAM should do nothing
    const current = context;
    context = examEngineReducer(context, { type: 'START_EXAM', userId: 'user-1', snapshot: mockSnapshot });
    expect(context).toBe(current); // strictly unchanged

    // Calling random event (CANDIDATE_SPOKE) during PRECHECK state (invalid transition) should be rejected
    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'Hello' });
    expect(context.currentState).toBe(ExamState.PRECHECK);
  });

  it('should run standalone Part 3 deterministically with exact question references', () => {
    const part3Snapshot = generateTestSnapshot('part3-seed-1', 'part2'); // cueCard + theme-linked part3Questions
    part3Snapshot.mode = 'part3';

    let context = createInitialContext('user-1', part3Snapshot, 'session-p3-standalone');
    expect(context.currentPart).toBe(IELTSExamPart.PART_3);

    // Initialize and move to Part 3 Asking
    context = examEngineReducer(context, { type: 'START_EXAM', userId: 'user-1', snapshot: part3Snapshot });
    context = examEngineReducer(context, { type: 'PRECHECK_COMPLETE' });
    context = examEngineReducer(context, { type: 'CONNECTION_ESTABLISHED' });

    // Examiner Welcome
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'Welcome to Part 3.' });
    expect(context.currentState).toBe(ExamState.PART3_ASKING);

    // Examiner asks Q1
    const p3Qs = part3Snapshot.part3Questions || [];
    expect(p3Qs.length).toBeGreaterThanOrEqual(4);

    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: p3Qs[0].text });
    expect(context.currentState).toBe(ExamState.PART3_ASKING);
    expect(context.transcript[context.transcript.length - 1].questionId).toBe(p3Qs[0].id);

    // Candidate answers Q1
    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'Answer to Q1' });
    expect(context.currentState).toBe(ExamState.PART3_COMPLETED);
    expect(context.currentPart3QuestionIndex).toBe(1);
    expect(context.completedQuestionIds).toContain(p3Qs[0].id);
    expect(context.transcript[context.transcript.length - 1].questionId).toBe(p3Qs[0].id);

    // Loop through remaining questions
    for (let i = 1; i < PART3_QUESTION_LIMIT; i++) {
      context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: p3Qs[i].text });
      expect(context.currentState).toBe(ExamState.PART3_ASKING);
      expect(context.transcript[context.transcript.length - 1].questionId).toBe(p3Qs[i].id);

      context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: `Answer to Q${i + 1}` });
      expect(context.currentState).toBe(ExamState.PART3_COMPLETED);
      expect(context.currentPart3QuestionIndex).toBe(i + 1);
      expect(context.completedQuestionIds).toContain(p3Qs[i].id);
    }

    // Examiner concludes Part 3
    context = examEngineReducer(context, { type: 'EXAMINER_SPOKE', text: 'That concludes the IELTS Speaking test.' });
    expect(context.currentState).toBe(ExamState.FINALIZING);
  });

  it('should handle Part 3 candidate speech start (barge-in) without skipping questions', () => {
    const part3Snapshot = generateTestSnapshot('part3-seed-2', 'part2');
    part3Snapshot.mode = 'part3';
    let context = createInitialContext('user-1', part3Snapshot, 'session-p3-bargein');
    context.currentState = ExamState.PART3_ASKING;

    // Candidate starts speaking mid-question
    context = examEngineReducer(context, { type: 'CANDIDATE_SPEECH_START' });
    expect(context.currentState).toBe(ExamState.PART3_LISTENING);
    expect(context.currentPart3QuestionIndex).toBe(0); // Question index preserved!

    // Candidate finishes speaking
    const p3Qs = part3Snapshot.part3Questions || [];
    context = examEngineReducer(context, { type: 'CANDIDATE_SPOKE', text: 'Interrupted response...' });
    expect(context.currentState).toBe(ExamState.PART3_COMPLETED);
    expect(context.currentPart3QuestionIndex).toBe(1);
    expect(context.completedQuestionIds).toContain(p3Qs[0].id);
  });

  it('should restore session in Part 3 at the exact unanswered question without duplication', () => {
    const part3Snapshot = generateTestSnapshot('part3-seed-3', 'part2');
    part3Snapshot.mode = 'part3';
    const p3Qs = part3Snapshot.part3Questions || [];

    let context = createInitialContext('user-1', part3Snapshot, 'session-p3-recover');
    context.currentState = ExamState.PART3_ASKING;
    context.currentPart = IELTSExamPart.PART_3;
    context.completedQuestionIds = [p3Qs[0].id, p3Qs[1].id]; // First 2 questions answered

    const snapshotString = serializeRecoverySnapshot(context);

    let recovered = createInitialContext('user-1', part3Snapshot, 'session-p3-recover');
    recovered = examEngineReducer(recovered, { type: 'RECOVER', snapshotString });

    expect(recovered.currentState).toBe(ExamState.PART3_ASKING);
    expect(recovered.currentPart3QuestionIndex).toBe(2); // Resumes at index 2 (Question 3)!
  });
});
