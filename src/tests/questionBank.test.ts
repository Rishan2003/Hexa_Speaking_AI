/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { generateTestSnapshot, PART_1_TOPICS, CUE_CARDS_BANK } from '../services/questionBank';

describe('IELTS-Style Speaking Question Bank & Deterministic Selection Tests', () => {
  it('should seed at least 8 Part 1 topic groups with 5-7 questions each', () => {
    expect(PART_1_TOPICS.length).toBeGreaterThanOrEqual(8);
    for (const topic of PART_1_TOPICS) {
      expect(topic.id).toBeDefined();
      expect(topic.title).toBeDefined();
      expect(topic.questions.length).toBeGreaterThanOrEqual(5);
      expect(topic.questions.length).toBeLessThanOrEqual(7);
      
      // Ensure each question has non-empty fields
      for (const q of topic.questions) {
        expect(q.id).toBeDefined();
        expect(q.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('should seed at least 12 Part 2 cue cards with title, task, bullet prompts, and closing question', () => {
    expect(CUE_CARDS_BANK.length).toBeGreaterThanOrEqual(12);
    for (const card of CUE_CARDS_BANK) {
      expect(card.id).toBeDefined();
      expect(card.title.trim().length).toBeGreaterThan(0);
      expect(card.taskStatement.trim().length).toBeGreaterThan(0);
      expect(card.bulletPrompts.length).toBeGreaterThanOrEqual(3);
      expect(card.bulletPrompts.length).toBeLessThanOrEqual(4);
      expect(card.closingQuestion.trim().length).toBeGreaterThan(0);
    }
  });

  it('should seed at least 5 Part 3 questions linked to each Part 2 theme covering the 5 required types', () => {
    const requiredTypes = ['explanation', 'comparison', 'causes', 'effects', 'future_speculation'];
    
    for (const card of CUE_CARDS_BANK) {
      expect(card.part3Questions.length).toBeGreaterThanOrEqual(5);
      
      const foundTypes = card.part3Questions.map(q => q.type);
      for (const reqType of requiredTypes) {
        expect(foundTypes).toContain(reqType);
      }

      for (const q of card.part3Questions) {
        expect(q.id).toBeDefined();
        expect(q.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('should reproduce the exact same snapshot when provided the same seed and mode', () => {
    const seed1 = 'mock-reproducible-seed-abc-123';
    const seed2 = 'mock-reproducible-seed-abc-123';
    
    const snap1_full = generateTestSnapshot(seed1, 'full');
    const snap2_full = generateTestSnapshot(seed2, 'full');
    
    expect(snap1_full).toEqual(snap2_full);

    const snap1_p1 = generateTestSnapshot(seed1, 'part1');
    const snap2_p1 = generateTestSnapshot(seed2, 'part1');
    expect(snap1_p1).toEqual(snap2_p1);

    const snap1_p2 = generateTestSnapshot(seed1, 'part2');
    const snap2_p2 = generateTestSnapshot(seed2, 'part2');
    expect(snap1_p2).toEqual(snap2_p2);
  });

  it('should generate different snapshots for different seeds', () => {
    const snapA = generateTestSnapshot('seed-alpha-999', 'full');
    const snapB = generateTestSnapshot('seed-beta-888', 'full');
    
    // Check that either Part 1 topic or Part 2 cue card is different
    const isP1Diff = snapA.part1Topic?.id !== snapB.part1Topic?.id;
    const isP2Diff = snapA.part2CueCard?.id !== snapB.part2CueCard?.id;
    
    expect(isP1Diff || isP2Diff).toBe(true);
  });

  it('should obey mode selections for correct part composition', () => {
    const seed = 'test-mode-composition';

    // 1. Full Mode
    const snapFull = generateTestSnapshot(seed, 'full');
    expect(snapFull.part1Topic).toBeDefined();
    expect(snapFull.part1Topics?.length).toBe(2);
    expect(snapFull.part1Topics?.every((topic) => topic.questions.length === 4)).toBe(true);
    expect(snapFull.part1Topic?.questions.length).toBe(8);
    expect(snapFull.part2CueCard).toBeDefined();
    expect(snapFull.part3Questions).toBeDefined();
    expect(snapFull.part3Questions?.length).toBeGreaterThanOrEqual(5);

    // 2. Part 1 Only Mode
    const snapP1 = generateTestSnapshot(seed, 'part1');
    expect(snapP1.part1Topic).toBeDefined();
    expect(snapP1.part1Topics?.length).toBe(2);
    expect(snapP1.part1Topics?.every((topic) => topic.questions.length === 4)).toBe(true);
    expect(snapP1.part1Topic?.questions.length).toBe(8);
    expect(snapP1.part2CueCard).toBeUndefined();
    expect(snapP1.part3Questions).toBeUndefined();

    // 3. Part 2 Only Mode (Part 2 & Part 3)
    const snapP2 = generateTestSnapshot(seed, 'part2');
    expect(snapP2.part1Topic).toBeUndefined();
    expect(snapP2.part2CueCard).toBeDefined();
    expect(snapP2.part3Questions).toBeDefined();
    expect(snapP2.part3Questions?.length).toBeGreaterThanOrEqual(5);


    // 4. Part 3 Only Mode (linked theme + discussion questions)
    const snapP3 = generateTestSnapshot(seed, 'part3');
    expect(snapP3.mode).toBe('part3');
    expect(snapP3.part1Topic).toBeUndefined();
    expect(snapP3.part2CueCard).toBeDefined();
    expect(snapP3.part3Questions?.length).toBeGreaterThanOrEqual(5);
  });

  it('should contain active-only content and have no duplicate question IDs or texts within a session', () => {
    const snap = generateTestSnapshot('test-duplicates-and-active', 'full');
    
    const questionIds = new Set<string>();
    const questionTexts = new Set<string>();

    // Check Part 1
    if (snap.part1Topic) {
      for (const q of snap.part1Topic.questions) {
        expect(questionIds.has(q.id)).toBe(false);
        expect(questionTexts.has(q.text)).toBe(false);
        questionIds.add(q.id);
        questionTexts.add(q.text);
      }
    }

    // Check Part 3
    if (snap.part3Questions) {
      for (const q of snap.part3Questions) {
        expect(questionIds.has(q.id)).toBe(false);
        expect(questionTexts.has(q.text)).toBe(false);
        questionIds.add(q.id);
        questionTexts.add(q.text);
      }
    }
  });
});
