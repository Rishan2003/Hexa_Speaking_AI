import { describe, expect, it } from 'vitest';
import {
  appendExaminerControlText,
  detectExaminerBoundary,
  normalizeExaminerControlText,
} from '../services/examCompletion';

describe('exam completion transcript detection', () => {
  it('detects a final IELTS test conclusion split across Gemini transcription chunks', () => {
    let buffer = '';
    buffer = appendExaminerControlText(buffer, 'Thank you very much. That concludes');
    expect(detectExaminerBoundary(buffer)).toBeNull();
    buffer = appendExaminerControlText(buffer, 'the IELTS Speaking test.');
    expect(detectExaminerBoundary(buffer)).toBe('test');
  });

  it('detects Part 1 and Part 2 conclusion variants', () => {
    expect(detectExaminerBoundary('Thank you. That concludes Part One of the test.')).toBe('part1');
    expect(detectExaminerBoundary('Thank you. This is the end of Part 2.')).toBe('part2');
  });

  it('normalizes punctuation and whitespace before phrase matching', () => {
    expect(normalizeExaminerControlText('  That concludes, the IELTS Speaking TEST!  '))
      .toBe('that concludes the ielts speaking test');
  });
});
