/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  clampIeltsScore,
  validateAndRepairEvaluation,
  buildEvaluationEvidenceStats,
  checkRateLimit,
  recordRateLimitUsage,
  runServerEvaluationPipeline,
  SCHEMA_VERSION,
} from '../services/serverEvaluationPipeline';
import { IELTSPracticeSession, ExamState, IELTSExamPart } from '../types';

describe('Phase 12: Server-Side Post-Test Evaluation Pipeline Tests', () => {
  const mockUserId = 'test-eval-user-999';
  const mockSessionId = 'test-session-eval-123';

  const mockSession: IELTSPracticeSession = {
    id: mockSessionId,
    userId: mockUserId,
    createdAt: Date.now(),
    topic: 'Environment and Technology',
    status: 'completed',
    currentState: ExamState.COMPLETE,
    currentPart: IELTSExamPart.PART_1,
    transcript: [
      { id: 't1', speaker: 'examiner', text: 'Let us discuss environmental protection.', timestamp: Date.now() - 10000, isFinal: true, sequence: 1 },
      { id: 't2', speaker: 'candidate', text: 'I believe renewable energy is essential to mitigate global warming risks.', timestamp: Date.now() - 8000, isFinal: true, sequence: 2 },
      { id: 't3', speaker: 'examiner', text: 'What actions do people take locally?', timestamp: Date.now() - 5000, isFinal: true, sequence: 3 },
      { id: 't4', speaker: 'candidate', text: 'Many households recycle plastics and conserve water daily.', timestamp: Date.now() - 2000, isFinal: true, sequence: 4 }
    ],
    selectedTestSnapshot: {
      seed: 'test-seed-1',
      mode: 'full',
      part1Topic: { id: 'p1', title: 'Recycling and Energy', questions: [] },
      part2CueCard: { id: 'p2', title: 'Describe an eco-friendly action', taskStatement: 'Describe an eco action', bulletPrompts: [], closingQuestion: 'How often do you do this?' },
      part3Questions: [{ id: 'p3', text: 'Global Climate Policies', type: 'explanation' }]
    }
  };

  const completeModelOutput = (criteria: any) => ({
    estimatedOverallBand: 7.0,
    bandRange: '6.5 - 7.5',
    confidence: 0.74,
    disclaimer: 'Estimated Practice Band - Simulated assessment, not official IELTS score.',
    assessmentBasis: 'transcript_only',
    examinerNote: 'The candidate communicates clearly overall, but the available transcript is brief, so the estimate should be treated cautiously.',
    evidence: ['I believe renewable energy is essential to mitigate global warming risks.'],
    strengths: ['The candidate gives directly relevant answers.', 'Several topic-specific words are used accurately.'],
    priorities: ['Develop answers with more supporting detail.', 'Show a wider range of grammatical structures across responses.'],
    partFeedback: [],
    actionPlan: ['Extend each Part 1 answer with a reason or example.', 'Practice combining simple and complex sentence forms accurately.'],
    criteria,
  });

  it('1. Score Bounding: Clamps and rounds scores strictly to 0.5 increments between 1.0 and 9.0', () => {
    expect(clampIeltsScore(6.2)).toBe(6.0);
    expect(clampIeltsScore(6.3)).toBe(6.5);
    expect(clampIeltsScore(6.8)).toBe(7.0);
    expect(clampIeltsScore(10.5)).toBe(9.0);
    expect(clampIeltsScore(-2.0)).toBe(1.0);
    expect(clampIeltsScore('invalid')).toBe(6.0);
  });

  it('2. Pronunciation Rule: Forces status = not_assessed and score = 0 when audio evidence is absent', () => {
    const rawModelOutput = completeModelOutput({
      fluencyAndCoherence: {
        score: 7.0,
        feedback: 'The answers remain relevant and logically connected across the available transcript.',
        examples: []
      },
      lexicalResource: {
        score: 7.5,
        feedback: 'The candidate uses precise environmental vocabulary and expresses meaning accurately.',
        improvedPhrases: []
      },
      grammaticalRangeAccuracy: {
        score: 6.5,
        feedback: 'The observed sentences are accurate, but the short sample shows only a limited structural range.',
        corrections: []
      },
      pronunciation: { score: 7.5, feedback: 'Invented pronunciation score', problemWords: ['word'] }
    });

    const resultNoAudio = validateAndRepairEvaluation(rawModelOutput, mockSessionId, mockUserId, false);

    expect(resultNoAudio.criteria.pronunciation.status).toBe('not_assessed');
    expect(resultNoAudio.criteria.pronunciation.score).toBe(0);
    expect(resultNoAudio.criteria.pronunciation.feedback).toContain('not assessed');
    expect(resultNoAudio.assessmentBasis).toBe('transcript_only');
    expect(resultNoAudio.confidence).toBeLessThanOrEqual(0.72);
    expect(resultNoAudio.estimatedOverallBand).toBe(7.0);
  });

  it('3. Pronunciation Rule: Assesses pronunciation when audio evidence is present', () => {
    const rawModelOutput = completeModelOutput({
      fluencyAndCoherence: {
        score: 7.0,
        feedback: 'The candidate maintains clear progression and relevance across the available responses.',
        examples: []
      },
      lexicalResource: {
        score: 7.0,
        feedback: 'Vocabulary is sufficiently precise for the topic and meaning remains consistently clear.',
        improvedPhrases: []
      },
      grammaticalRangeAccuracy: {
        score: 7.0,
        feedback: 'The candidate controls the observed sentence forms accurately in this short language sample.',
        corrections: []
      },
      pronunciation: {
        score: 7.0,
        status: 'assessed',
        feedback: 'Speech is consistently intelligible with clear articulation and controlled intonation.',
        problemWords: ['climate']
      }
    });

    const resultWithAudio = validateAndRepairEvaluation(rawModelOutput, mockSessionId, mockUserId, true);

    expect(resultWithAudio.criteria.pronunciation.status).toBe('assessed');
    expect(resultWithAudio.criteria.pronunciation.score).toBe(7.0);
    expect(resultWithAudio.criteria.pronunciation.feedback).toContain('intelligible');
    expect(resultWithAudio.assessmentBasis).toBe('transcript_and_audio');
  });

  it('4. Quality Gate: rejects missing criterion data instead of inventing a generic report', () => {
    expect(() => validateAndRepairEvaluation({}, mockSessionId, mockUserId, false))
      .toThrow(/missing criteria object/i);
  });

  it('4b. Evidence statistics describe transcript evidence without assigning a band', () => {
    const stats = buildEvaluationEvidenceStats(mockSession);
    expect(stats.candidateResponseTurns).toBe(2);
    expect(stats.candidateWords).toBeGreaterThan(10);
    expect(stats.longestResponseWords).toBeGreaterThan(5);
  });

  it('5. Rate Limiting: Restricts user evaluation requests to 10 per hour window', () => {
    const rateLimitUser = 'rate-limit-test-user-123';

    for (let i = 0; i < 10; i++) {
      const check = checkRateLimit(rateLimitUser);
      expect(check.allowed).toBe(true);
      recordRateLimitUsage(rateLimitUser);
    }

    const check11 = checkRateLimit(rateLimitUser);
    expect(check11.allowed).toBe(false);
    expect(check11.remaining).toBe(0);
    expect(check11.resetTimeMs).toBeGreaterThan(0);
  });

  it('6. Full Pipeline Execution & Idempotency: Executes sandbox only when explicitly allowed in tests', async () => {
    const eval1 = await runServerEvaluationPipeline(mockSession);

    expect(eval1.sessionId).toBe(mockSessionId);
    expect(eval1.estimatedOverallBand).toBeGreaterThanOrEqual(1.0);
    expect(eval1.estimatedOverallBand).toBeLessThanOrEqual(9.0);
    expect(eval1.status).toBe('completed');
    expect(eval1.evaluationEngine).toBe('sandbox');
    expect(eval1.qualityWarnings?.join(' ')).toContain('Sandbox/demo evaluator');
    expect(eval1.id).toBe(`eval_${mockSessionId}_${SCHEMA_VERSION}`);

    const eval2 = await runServerEvaluationPipeline(mockSession);
    expect(eval2.id).toBe(eval1.id);
    expect(eval2.createdAt).toBe(eval1.createdAt);
  });
});
