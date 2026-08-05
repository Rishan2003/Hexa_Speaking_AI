/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildPart1SystemInstruction, buildPart2SystemInstruction } from '../services/examinerPrompts';
import { generateTestSnapshot } from '../services/questionBank';

describe('Examiner prompt orchestration', () => {
  it('builds Part 1 from two stored topic frames and all eight questions', () => {
    const snapshot = generateTestSnapshot('prompt-part1-eight-questions', 'part1');
    const prompt = buildPart1SystemInstruction(snapshot);

    expect(snapshot.part1Topics).toHaveLength(2);
    expect(snapshot.part1Topic?.questions).toHaveLength(8);
    expect(prompt).toContain('approximately 4 to 5 minutes');
    expect(prompt).toContain('Ask all 8 stored questions');

    for (const question of snapshot.part1Topic?.questions || []) {
      expect(prompt).toContain(question.text);
    }
  });

  it('makes Part 2 application-timer events authoritative', () => {
    const snapshot = generateTestSnapshot('prompt-part2-timer-controls', 'part2');
    const prompt = buildPart2SystemInstruction(snapshot);

    expect(prompt).toContain('[CONTROL:PART2_PREP_COMPLETE]');
    expect(prompt).toContain('ONE application-controlled user activity');
    expect(prompt).toContain('NEVER use a pause by itself as evidence that the candidate has finished');
    expect(prompt).toContain('YOU DO NOT OWN THE WALL-CLOCK TIMER');
    expect(prompt).toContain('Do not wait for the candidate to speak before saying this.');
  });
});
