/**
 * Helpers for detecting examiner-owned exam boundaries from Gemini Live
 * transcription. Live output transcription can arrive in several short chunks,
 * so boundary detection must operate on a rolling buffer rather than a single
 * callback payload.
 */

export type ExaminerBoundary = 'part1' | 'part2' | 'test' | null;

export function normalizeExaminerControlText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function appendExaminerControlText(
  currentBuffer: string,
  chunk: string,
  maxCharacters = 1600
): string {
  const combined = `${currentBuffer} ${chunk}`.replace(/\s+/g, ' ').trim();
  if (combined.length <= maxCharacters) return combined;
  return combined.slice(combined.length - maxCharacters);
}

export function detectExaminerBoundary(value: string): ExaminerBoundary {
  const text = normalizeExaminerControlText(value);

  const finalTestPatterns = [
    'concludes the ielts speaking test',
    'concludes your ielts speaking test',
    'concludes your mock speaking test',
    'concludes the mock speaking test',
    'concludes the speaking test',
    'speaking test is now complete',
    'speaking test is complete',
    'end of the ielts speaking test',
    'end of your ielts speaking test',
    'end of the speaking test',
    'concludes the exam',
  ];
  if (finalTestPatterns.some((pattern) => text.includes(pattern))) return 'test';

  const part2Patterns = [
    'concludes part 2',
    'concludes part two',
    'end of part 2',
    'end of part two',
    'part 2 is complete',
    'part two is complete',
    'proceed to part 3',
    'proceed to part three',
  ];
  if (part2Patterns.some((pattern) => text.includes(pattern))) return 'part2';

  const part1Patterns = [
    'concludes part 1',
    'concludes part one',
    'end of part 1',
    'end of part one',
    'part 1 is complete',
    'part one is complete',
    'proceed to part 2',
    'proceed to part two',
  ];
  if (part1Patterns.some((pattern) => text.includes(pattern))) return 'part1';

  return null;
}
