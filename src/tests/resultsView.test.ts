/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { MockPracticeService } from '../services/mockService';
import { validateAndRepairEvaluation } from '../services/serverEvaluationPipeline';

function completeEvaluation(criteria: any) {
  return {
    estimatedOverallBand: 7.0,
    confidence: 0.7,
    bandRange: '6.5 - 7.5',
    examinerNote: 'The candidate shows a generally effective language resource, with clear areas that still limit the next band.',
    evidence: ['I enjoy visiting new places because it helps me learn about different cultures.'],
    strengths: ['Answers are relevant to the questions.', 'Ideas are generally easy to follow.'],
    priorities: ['Increase grammatical range in extended answers.', 'Use more precise vocabulary instead of repeated basic wording.'],
    partFeedback: [],
    actionPlan: ['Extend answers with a reason and example.', 'Review recurring grammar errors from the transcript.'],
    criteria,
  };
}

describe('ResultsView & Evaluation State Presentation Unit Tests', () => {
  it('should format estimated practice band and criteria scores accurately without fake precision', () => {
    const rawEval = completeEvaluation({
      fluencyAndCoherence: { score: 7.5, feedback: 'The candidate develops answers clearly and keeps ideas logically connected across the sample.', examples: [] },
      lexicalResource: { score: 7.0, feedback: 'Vocabulary is varied enough to express meaning precisely across the available responses.', improvedPhrases: [] },
      grammaticalRangeAccuracy: { score: 6.5, feedback: 'A useful range is visible, although control of more complex structures is still inconsistent.', corrections: [] },
      pronunciation: { score: 0, status: 'not_assessed', feedback: 'Audio unavailable for pronunciation analysis.', problemWords: [] }
    });

    const repaired = validateAndRepairEvaluation(rawEval, 'test-sess-1', 'test-user-1', false);

    expect(repaired.estimatedOverallBand).toBe(7.0);
    expect(repaired.criteria.pronunciation.status).toBe('not_assessed');
    expect(repaired.criteria.pronunciation.score).toBe(0);
    expect(repaired.disclaimer).toContain('Estimated Practice Band');
  });

  it('should include raw audio evidence when present and mark pronunciation as assessed', () => {
    const rawEval = completeEvaluation({
      fluencyAndCoherence: { score: 7.0, feedback: 'Ideas remain clearly connected and the candidate sustains the response without losing direction.', examples: [] },
      lexicalResource: { score: 7.0, feedback: 'The candidate uses enough precise vocabulary to discuss the topic without obvious restriction.', improvedPhrases: [] },
      grammaticalRangeAccuracy: { score: 7.0, feedback: 'The candidate uses both simple and complex structures with generally effective grammatical control.', corrections: [] },
      pronunciation: { score: 7.5, status: 'assessed', feedback: 'Speech is clear and intelligible, with effective stress and intonation across the recording.', problemWords: ['specifically'] }
    });

    const repaired = validateAndRepairEvaluation(rawEval, 'test-sess-2', 'test-user-2', true);

    expect(repaired.criteria.pronunciation.status).toBe('assessed');
    expect(repaired.criteria.pronunciation.score).toBe(7.5);
    expect(repaired.estimatedOverallBand).toBe(7.0);
  });

  it('should retrieve seeded session evaluation for ResultsView display', () => {
    const evalData = MockPracticeService.getEvaluationForSession('session-prev-1');
    expect(evalData).not.toBeNull();
    if (evalData) {
      expect(evalData.estimatedOverallBand).toBe(7.0);
      expect(evalData.criteria.fluencyAndCoherence.score).toBeGreaterThanOrEqual(1.0);
      expect(evalData.actionPlan.length).toBeGreaterThan(0);
    }
  });
});
