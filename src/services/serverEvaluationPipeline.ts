/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import {
  IELTSPracticeSession,
  IELTSEvaluation,
  EvaluationStatus,
  EvaluationEvidenceStats,
  EvaluationEngine,
} from '../types';
import { getFirebaseAdmin, isFirebaseServerEnabled, isFirestoreServerAvailable, markFirestoreServerUnavailable } from './firebaseServer';
import { MockPracticeService } from './mockService';

// Production IELTS evaluation models. Gemini 2.x evaluation models are no longer
// available to some new API users, so stale environment values are migrated to
// current full-Flash models instead of failing with a provider 404.
const LEGACY_EVALUATION_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-lite-001',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);

function resolveEvaluationModel(configured: string | undefined, replacement: string): string {
  const requested = configured?.trim();
  if (!requested) return replacement;
  if (LEGACY_EVALUATION_MODELS.has(requested)) {
    console.warn(`[EvaluationPipeline] Legacy evaluation model ${requested} is no longer reliable for new Gemini API users; using ${replacement}.`);
    return replacement;
  }
  return requested;
}

export const EVALUATION_MODEL = resolveEvaluationModel(process.env.GEMINI_EVALUATION_MODEL, 'gemini-3.6-flash');
export const EVALUATION_FALLBACK_MODEL = resolveEvaluationModel(process.env.GEMINI_EVALUATION_FALLBACK_MODEL, 'gemini-3.5-flash');
// v3 intentionally invalidates every v2 cached report. v2 could silently return
// generic 6.x/7.x bands when the provider failed, so those reports must not be
// reused after this fix.
export const SCHEMA_VERSION = 'v3';
export const RUBRIC_VERSION = 'IELTS-speaking-public-descriptors-2026-08';

// Rate Limiter: Max 10 evaluations per user per hour
const userRateLimits: Map<string, number[]> = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 10;

export function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetTimeMs: number } {
  const now = Date.now();
  const timestamps = userRateLimits.get(userId) || [];
  
  // Clean expired timestamps
  const validTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  userRateLimits.set(userId, validTimestamps);

  if (validTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = validTimestamps[0];
    const resetTimeMs = oldest + RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, remaining: 0, resetTimeMs };
  }

  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - validTimestamps.length, resetTimeMs: 0 };
}

export function recordRateLimitUsage(userId: string): void {
  const timestamps = userRateLimits.get(userId) || [];
  timestamps.push(Date.now());
  userRateLimits.set(userId, timestamps);
}

// Record usageEvent to Firestore or server log
export async function recordUsageEvent(userId: string, sessionId: string, eventType: string, metadata: any = {}): Promise<void> {
  const event = {
    userId,
    sessionId,
    eventType,
    timestamp: Date.now(),
    model: EVALUATION_MODEL,
    schemaVersion: SCHEMA_VERSION,
    metadata
  };

  if (isFirebaseServerEnabled()) {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('usageEvents').add(event);
    } catch (err) {
      console.warn('[UsageEvent] Failed to log usage event to Firestore:', err);
    }
  } else {
    console.log(`[UsageEvent Log - Sandbox] ${eventType} for user ${userId}, session ${sessionId}`);
  }
}

// Structured IELTS Evaluation Response Schema
export const IELTS_EVALUATION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    estimatedOverallBand: {
      type: Type.NUMBER,
      description: 'Estimated overall band score from 1.0 to 9.0 in steps of 0.5 (e.g., 6.0, 6.5, 7.0).'
    },
    bandRange: {
      type: Type.STRING,
      description: 'Estimated band range string, e.g. "6.0 - 6.5"'
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Confidence score between 0.0 and 1.0'
    },
    disclaimer: {
      type: Type.STRING,
      description: 'Must state: Estimated Practice Band - Simulated assessment, not official IELTS score.'
    },
    assessmentBasis: {
      type: Type.STRING,
      description: 'transcript_only or transcript_and_audio'
    },
    examinerNote: {
      type: Type.STRING,
      description: 'Constructive summary note written in official IELTS examiner tone.'
    },
    evidence: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Direct transcript quotes or timing evidence observed.'
    },
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-4 key strengths displayed by candidate.'
    },
    priorities: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-4 key priority areas for improvement.'
    },
    partFeedback: {
      type: Type.ARRAY,
      description: 'Part-by-part diagnostic feedback for every test part that has candidate evidence.',
      items: {
        type: Type.OBJECT,
        properties: {
          part: { type: Type.STRING, description: 'Part 1, Part 2, or Part 3' },
          summary: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['part', 'summary', 'strengths', 'improvements', 'evidence']
      }
    },
    actionPlan: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3-4 highly actionable study goals or 7-day study plan steps.'
    },
    criteria: {
      type: Type.OBJECT,
      properties: {
        fluencyAndCoherence: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER, description: 'Score from 1.0 to 9.0 in 0.5 steps' },
            feedback: { type: Type.STRING },
            examples: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '1-3 short, exact candidate transcript excerpts that support the fluency/coherence judgment.'
            }
          },
          required: ['score', 'feedback', 'examples']
        },
        lexicalResource: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER, description: 'Score from 1.0 to 9.0 in 0.5 steps' },
            feedback: { type: Type.STRING },
            improvedPhrases: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING, description: 'Exact wording used by the candidate.' },
                  improved: { type: Type.STRING },
                  explanation: { type: Type.STRING }
                },
                required: ['original', 'improved', 'explanation']
              }
            }
          },
          required: ['score', 'feedback', 'improvedPhrases']
        },
        grammaticalRangeAccuracy: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER, description: 'Score from 1.0 to 9.0 in 0.5 steps' },
            feedback: { type: Type.STRING },
            corrections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  incorrect: { type: Type.STRING, description: 'Exact or minimally trimmed wording used by the candidate.' },
                  correct: { type: Type.STRING },
                  ruleExplanation: { type: Type.STRING }
                },
                required: ['incorrect', 'correct', 'ruleExplanation']
              }
            }
          },
          required: ['score', 'feedback', 'corrections']
        },
        pronunciation: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER, description: 'Score 1.0 to 9.0 if assessed, or 0 if not_assessed due to missing audio' },
            status: { type: Type.STRING, description: 'assessed or not_assessed' },
            feedback: { type: Type.STRING },
            problemWords: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['score', 'status', 'feedback', 'problemWords']
        }
      },
      required: ['fluencyAndCoherence', 'lexicalResource', 'grammaticalRangeAccuracy', 'pronunciation']
    }
  },
  required: ['estimatedOverallBand', 'bandRange', 'confidence', 'disclaimer', 'assessmentBasis', 'examinerNote', 'evidence', 'strengths', 'priorities', 'partFeedback', 'actionPlan', 'criteria']
};

/**
 * Rounds a numeric score strictly to standard IELTS 0.5 increments between 1.0 and 9.0
 */
export function clampIeltsScore(score: any, fallback = 6.0): number {
  const num = typeof score === 'number' && !isNaN(score) ? score : parseFloat(score) || fallback;
  const clamped = Math.max(1.0, Math.min(9.0, num));
  return Math.round(clamped * 2) / 2;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function normalizeEvidenceText(value: string): string {
  return tokenize(value).join(' ');
}

function isGroundedInCandidateText(candidateText: string, value: string): boolean {
  const needle = normalizeEvidenceText(value);
  if (!needle) return false;
  return normalizeEvidenceText(candidateText).includes(needle);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function buildEvaluationEvidenceStats(session: IELTSPracticeSession): EvaluationEvidenceStats {
  const candidateTurns = session.transcript.filter((turn) => turn.speaker === 'candidate');
  const turnWordCounts = candidateTurns.map((turn) => tokenize(turn.text || '').length);
  const allTokens = candidateTurns.flatMap((turn) => tokenize(turn.text || ''));
  const uniqueTokens = new Set(allTokens);
  const timedCandidateResponses = candidateTurns.filter((turn) =>
    typeof turn.startTime === 'number' &&
    typeof turn.endTime === 'number' &&
    turn.endTime > turn.startTime
  ).length;

  return {
    candidateWords: allTokens.length,
    candidateResponseTurns: candidateTurns.length,
    averageWordsPerResponse: candidateTurns.length
      ? Math.round((allTokens.length / candidateTurns.length) * 10) / 10
      : 0,
    medianWordsPerResponse: Math.round(median(turnWordCounts) * 10) / 10,
    longestResponseWords: Math.max(0, ...turnWordCounts),
    veryShortResponses: turnWordCounts.filter((count) => count <= 5).length,
    lexicalDiversity: allTokens.length
      ? Math.round((uniqueTokens.size / allTokens.length) * 1000) / 1000
      : 0,
    timedCandidateResponses,
    ...(typeof session.part2Meta?.longTurnDuration === 'number'
      ? { part2LongTurnSeconds: Math.round(session.part2Meta.longTurnDuration * 10) / 10 }
      : {}),
  };
}

function buildCandidateResponseIndex(session: IELTSPracticeSession): string {
  let previousExaminerText = '';
  let candidateIndex = 0;
  const lines: string[] = [];

  for (const turn of session.transcript) {
    if (turn.speaker === 'examiner') {
      previousExaminerText = turn.text || '';
      continue;
    }

    candidateIndex += 1;
    const words = tokenize(turn.text || '').length;
    const timing = typeof turn.startTime === 'number' && typeof turn.endTime === 'number' && turn.endTime > turn.startTime
      ? `${Math.round((turn.endTime - turn.startTime) / 100) / 10}s`
      : 'n/a';
    lines.push([
      `Response ${candidateIndex}`,
      `Question: ${previousExaminerText || '[question context unavailable]'}`,
      `Answer (${words} words; timing ${timing}): ${turn.text || '[empty]'}`,
    ].join('\n'));
  }

  return lines.length ? lines.join('\n\n') : '[No candidate responses recorded]';
}

function requireObject(value: any, label: string): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Evaluation response is missing ${label}.`);
  }
  return value;
}

function requireNonEmptyString(value: any, label: string, minLength = 8): string {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new Error(`Evaluation response contains an unusable ${label}.`);
  }
  return value.trim();
}

function requireScore(value: any, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Evaluation response is missing a numeric ${label} score.`);
  }
  return clampIeltsScore(numeric);
}

interface EvaluationValidationContext {
  candidateText?: string;
  evidenceStats?: EvaluationEvidenceStats;
  engine?: EvaluationEngine;
  qualityWarnings?: string[];
}

/**
 * Runtime schema validator and bounded repair function.
 * Guarantees valid structural shape, score ranges, disclaimer, and pronunciation rule enforcement.
 */
export function validateAndRepairEvaluation(
  parsed: any,
  sessionId: string,
  userId: string,
  hasAudioEvidence: boolean,
  context: EvaluationValidationContext = {}
): IELTSEvaluation {
  const safeObj = requireObject(parsed, 'top-level JSON object');
  const crit = requireObject(safeObj.criteria, 'criteria object');
  const rawFluency = requireObject(crit.fluencyAndCoherence, 'Fluency and Coherence criterion');
  const rawLexical = requireObject(crit.lexicalResource, 'Lexical Resource criterion');
  const rawGrammar = requireObject(crit.grammaticalRangeAccuracy, 'Grammatical Range and Accuracy criterion');

  const candidateText = context.candidateText || '';
  const qualityWarnings = [...(context.qualityWarnings || [])];

  const rawFluencyExamples = Array.isArray(rawFluency.examples)
    ? rawFluency.examples.map(String).map((item: string) => item.trim()).filter(Boolean)
    : [];
  const groundedFluencyExamples = candidateText
    ? rawFluencyExamples.filter((item: string) => isGroundedInCandidateText(candidateText, item))
    : rawFluencyExamples;
  if (rawFluencyExamples.length > groundedFluencyExamples.length) {
    qualityWarnings.push('Removed fluency examples that could not be found in the candidate transcript.');
  }

  const fluency = {
    score: requireScore(rawFluency.score, 'Fluency and Coherence'),
    feedback: requireNonEmptyString(rawFluency.feedback, 'Fluency and Coherence feedback', 25),
    examples: groundedFluencyExamples.slice(0, 4),
  };

  const rawImprovedPhrases = Array.isArray(rawLexical.improvedPhrases) ? rawLexical.improvedPhrases : [];
  const groundedImprovedPhrases = rawImprovedPhrases
    .map((p: any) => ({
      original: typeof p?.original === 'string' ? p.original.trim() : '',
      improved: typeof p?.improved === 'string' ? p.improved.trim() : '',
      explanation: typeof p?.explanation === 'string' ? p.explanation.trim() : '',
    }))
    .filter((p: any) => p.original && p.improved && p.explanation)
    .filter((p: any) => !candidateText || isGroundedInCandidateText(candidateText, p.original))
    .slice(0, 5);
  if (rawImprovedPhrases.length > groundedImprovedPhrases.length) {
    qualityWarnings.push('Removed vocabulary examples that were not grounded in the candidate transcript.');
  }

  const lexical = {
    score: requireScore(rawLexical.score, 'Lexical Resource'),
    feedback: requireNonEmptyString(rawLexical.feedback, 'Lexical Resource feedback', 25),
    improvedPhrases: groundedImprovedPhrases,
  };

  const rawCorrections = Array.isArray(rawGrammar.corrections) ? rawGrammar.corrections : [];
  const groundedCorrections = rawCorrections
    .map((c: any) => ({
      incorrect: typeof c?.incorrect === 'string' ? c.incorrect.trim() : '',
      correct: typeof c?.correct === 'string' ? c.correct.trim() : '',
      ruleExplanation: typeof c?.ruleExplanation === 'string' ? c.ruleExplanation.trim() : '',
    }))
    .filter((c: any) => c.incorrect && c.correct && c.ruleExplanation)
    .filter((c: any) => !candidateText || isGroundedInCandidateText(candidateText, c.incorrect))
    .slice(0, 6);
  if (rawCorrections.length > groundedCorrections.length) {
    qualityWarnings.push('Removed grammar corrections whose source wording was not present in the candidate transcript.');
  }

  const grammar = {
    score: requireScore(rawGrammar.score, 'Grammatical Range and Accuracy'),
    feedback: requireNonEmptyString(rawGrammar.feedback, 'Grammatical Range and Accuracy feedback', 25),
    corrections: groundedCorrections,
  };

  // PRONUNCIATION RULE: If usable audio evidence is absent, pronunciation MUST be not_assessed
  let pronunciation;
  if (!hasAudioEvidence) {
    pronunciation = {
      score: 0,
      status: 'not_assessed' as const,
      feedback: 'Pronunciation was not assessed as raw audio recording evidence was unavailable for analysis.',
      problemWords: []
    };
  } else {
    const rawPronunciation = requireObject(crit.pronunciation, 'Pronunciation criterion');
    const rawPronScore = rawPronunciation.score;
    const isNotAssessed = rawPronunciation.status === 'not_assessed' || rawPronScore === 0;
    pronunciation = {
      score: isNotAssessed ? 0 : requireScore(rawPronScore, 'Pronunciation'),
      status: isNotAssessed ? ('not_assessed' as const) : ('assessed' as const),
      feedback: requireNonEmptyString(rawPronunciation.feedback, 'Pronunciation feedback', 20),
      problemWords: Array.isArray(rawPronunciation.problemWords)
        ? rawPronunciation.problemWords.map(String)
        : []
    };
  }

  // Calculate overall band as average of assessed criteria
  const assessedScores = [fluency.score, lexical.score, grammar.score];
  if (pronunciation.status === 'assessed' && pronunciation.score > 0) {
    assessedScores.push(pronunciation.score);
  }
  const avg = assessedScores.reduce((a, b) => a + b, 0) / assessedScores.length;
  const overallBand = clampIeltsScore(avg);

  const evaluationId = `eval_${sessionId}_${SCHEMA_VERSION}`;
  const assessmentBasis = hasAudioEvidence ? ('transcript_and_audio' as const) : ('transcript_only' as const);
  const rawConfidence = typeof safeObj.confidence === 'number' && safeObj.confidence >= 0 && safeObj.confidence <= 1
    ? safeObj.confidence
    : (hasAudioEvidence ? 0.86 : 0.68);
  // A transcript-only report cannot directly assess pronunciation, so cap confidence
  // instead of presenting the same certainty as a four-criterion audio-backed report.
  const confidence = hasAudioEvidence ? rawConfidence : Math.min(rawConfidence, 0.72);

  const validParts = new Set(['Part 1', 'Part 2', 'Part 3']);
  const partFeedback = Array.isArray(safeObj.partFeedback)
    ? safeObj.partFeedback
        .filter((part: any) => validParts.has(String(part?.part || '')))
        .map((part: any) => ({
          part: String(part.part) as 'Part 1' | 'Part 2' | 'Part 3',
          summary: String(part?.summary || '').trim(),
          strengths: Array.isArray(part?.strengths) ? part.strengths.map(String).filter(Boolean) : [],
          improvements: Array.isArray(part?.improvements) ? part.improvements.map(String).filter(Boolean) : [],
          evidence: Array.isArray(part?.evidence) ? part.evidence.map(String).filter(Boolean) : []
        }))
    : [];

  const strengths = Array.isArray(safeObj.strengths)
    ? safeObj.strengths.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 5)
    : [];
  const priorities = Array.isArray(safeObj.priorities)
    ? safeObj.priorities.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 5)
    : [];
  const actionPlan = Array.isArray(safeObj.actionPlan)
    ? safeObj.actionPlan.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 6)
    : [];
  const evidence = Array.isArray(safeObj.evidence)
    ? safeObj.evidence.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 8)
    : [];

  if (strengths.length < 2) throw new Error('Evaluation response did not contain enough evidence-based strengths.');
  if (priorities.length < 2) throw new Error('Evaluation response did not contain enough evidence-based priorities.');
  if (actionPlan.length < 2) throw new Error('Evaluation response did not contain a usable action plan.');
  if (candidateText && fluency.examples.length === 0 && evidence.length === 0) {
    throw new Error('Evaluation response did not cite candidate evidence.');
  }

  return {
    id: evaluationId,
    sessionId,
    userId,
    createdAt: Date.now(),
    estimatedOverallBand: overallBand,
    bandRange: `${Math.max(1.0, overallBand - 0.5).toFixed(1)} - ${Math.min(9.0, overallBand + 0.5).toFixed(1)}`,
    confidence,
    disclaimer: hasAudioEvidence
      ? 'Estimated Practice Band - Simulated assessment, not official IELTS score.'
      : 'Estimated Practice Band - Transcript-based simulated assessment; pronunciation was not assessed, so this is not a complete IELTS Speaking score.',
    assessmentBasis,
    evaluationEngine: context.engine || 'gemini',
    rubricVersion: RUBRIC_VERSION,
    ...(context.evidenceStats ? { evidenceStats: context.evidenceStats } : {}),
    ...(qualityWarnings.length ? { qualityWarnings } : {}),
    criteria: {
      fluencyAndCoherence: fluency,
      lexicalResource: lexical,
      grammaticalRangeAccuracy: grammar,
      pronunciation
    },
    examinerNote: requireNonEmptyString(safeObj.examinerNote, 'examiner note', 35),
    evidence,
    strengths,
    priorities,
    partFeedback,
    actionPlan,
    status: 'completed'
  };
}

/**
 * Executes the server-side post-test evaluation pipeline with Gemini structured JSON output
 */
export async function runServerEvaluationPipeline(
  session: IELTSPracticeSession,
  options: { forceRetry?: boolean } = {}
): Promise<IELTSEvaluation> {
  const sessionId = session.id;
  const userId = session.userId || 'user-unknown';
  const evaluationId = `eval_${sessionId}_${SCHEMA_VERSION}`;

  // 1. Check idempotency: Return existing completed evaluation unless forceRetry is true
  if (!options.forceRetry) {
    if (isFirestoreServerAvailable()) {
      try {
        const db = getFirebaseAdmin().firestore();
        const evalDoc = await db.collection('evaluations').doc(evaluationId).get();
        if (evalDoc.exists) {
          const data = evalDoc.data() as IELTSEvaluation;
          if (data && data.status === 'completed') {
            console.log(`[EvaluationPipeline] Idempotent hit: Returning existing evaluation ${evaluationId}`);
            MockPracticeService.saveEvaluation(data);
            return data;
          }
        }
      } catch (err) {
        markFirestoreServerUnavailable(err);
        console.warn('[EvaluationPipeline] Error checking Firestore evaluation idempotency; using recovery cache:', err);
      }
    }
    const existing = MockPracticeService.getEvaluationForSession(sessionId);
    if (existing && existing.status === 'completed') {
      console.log(`[EvaluationPipeline] Recovery-cache hit: Returning existing evaluation ${evaluationId}`);
      return existing;
    }
  }

  // 2. Enforce Rate Limiting
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(rateLimit.resetTimeMs / 1000)} seconds before requesting another evaluation.`);
  }

  // 3. Persist evaluation status as 'processing'
  await setEvaluationStatusInStore(sessionId, userId, 'processing', evaluationId);

  // 4. Gather transcript and evidence metadata
  const candTurns = session.transcript.filter(t => t.speaker === 'candidate');
  const evidenceStats = buildEvaluationEvidenceStats(session);
  const wordCount = evidenceStats.candidateWords;
  const totalTurns = session.transcript.length;

  if (candTurns.length === 0 || wordCount === 0) {
    await setEvaluationStatusInStore(sessionId, userId, 'failed', evaluationId);
    throw new Error('There is no candidate speech in the transcript to evaluate.');
  }
  
  // This pipeline currently sends transcript text only. Recording metadata is not audio evidence,
  // and consent alone must never be used to fabricate a pronunciation assessment.
  // Pronunciation remains not_assessed until the stored audio bytes are securely attached to this request.
  const hasAudioEvidence = false;

  // Preserve evidence metadata so the evaluator can tie every observation to the
  // actual session instead of producing generic IELTS coaching text.
  const formattedTranscript = session.transcript.length > 0
    ? JSON.stringify(session.transcript.map((t) => ({
        sequence: t.sequence,
        speaker: t.speaker,
        questionId: t.questionId || null,
        text: t.text,
        timestamp: t.timestamp,
        startTime: t.startTime ?? null,
        endTime: t.endTime ?? null,
        interrupted: Boolean(t.interrupted)
      })), null, 2)
    : '[No transcript recorded]';
  const candidateText = candTurns.map((turn) => turn.text || '').filter(Boolean).join('\n');
  const responseIndex = buildCandidateResponseIndex(session);

  const testSnapshotSummary = session.selectedTestSnapshot
    ? JSON.stringify({
        mode: session.selectedTestSnapshot.mode,
        part1Topics: session.selectedTestSnapshot.part1Topics?.map((topic) => ({
          title: topic.title,
          questions: topic.questions.map((q) => ({ id: q.id, text: q.text }))
        })) || (session.selectedTestSnapshot.part1Topic ? [{
          title: session.selectedTestSnapshot.part1Topic.title,
          questions: session.selectedTestSnapshot.part1Topic.questions.map((q) => ({ id: q.id, text: q.text }))
        }] : []),
        part2CueCard: session.selectedTestSnapshot.part2CueCard ? {
          title: session.selectedTestSnapshot.part2CueCard.title,
          taskStatement: session.selectedTestSnapshot.part2CueCard.taskStatement,
          bulletPrompts: session.selectedTestSnapshot.part2CueCard.bulletPrompts,
          closingQuestion: session.selectedTestSnapshot.part2CueCard.closingQuestion
        } : null,
        part3Questions: session.selectedTestSnapshot.part3Questions?.map((q) => ({ id: q.id, text: q.text, type: q.type })) || []
      }, null, 2)
    : JSON.stringify({ topic: session.topic });

  const part2TimingSummary = session.part2Meta
    ? JSON.stringify({
        preparationStartedAt: session.part2Meta.prepStartTime || null,
        preparationEndedAt: session.part2Meta.prepEndTime || null,
        longTurnStartedAt: session.part2Meta.longTurnStartTime || null,
        longTurnEndedAt: session.part2Meta.longTurnEndTime || null,
        longTurnDurationSeconds: session.part2Meta.longTurnDuration ?? null,
        interruptedAtTimeLimit: Boolean(session.part2Meta.interrupted),
        interruptionReason: session.part2Meta.interruptionReason || null
      }, null, 2)
    : 'null';

  // 5. Construct evaluation prompt
  const systemInstruction = `You are a strict IELTS Speaking PRACTICE evaluator. You are not the live examiner and you must never claim this is an official IELTS result.

Your job is to produce a rigorous, evidence-based post-test report using the official IELTS Speaking assessment dimensions:
- Fluency and Coherence
- Lexical Resource
- Grammatical Range and Accuracy
- Pronunciation

CALIBRATION — USE THESE BAND ANCHORS, NOT A DEFAULT "SAFE" BAND:
- Band 9: exceptionally flexible, precise and fully developed language; only rare natural slips.
- Band 8: fluent and well-developed with a wide, flexible resource; most grammar is error-free and lapses are occasional.
- Band 7: sustains long answers without obvious effort; ideas are coherent; vocabulary is flexible enough for precise discussion; complex structures are used with many error-free sentences, though some errors remain.
- Band 6: can speak at length and keep communication going, but coherence/flexibility is inconsistent; vocabulary is adequate and paraphrase is generally possible; both simple and complex grammar appear, with noticeable errors in more complex forms.
- Band 5: relies more on repetition, self-correction or slower formulation; vocabulary and grammar are adequate for familiar meaning but flexibility is limited and complex language is error-prone.
- Band 4 or below: frequent breakdowns, restricted language, short/simple production or errors that substantially limit development or clarity.

Use 0.5 only when the performance genuinely sits between two adjacent anchors. Never start from 6.5 and adjust. Decide each criterion independently from the evidence first, then assign its band.

EVIDENCE DISCIPLINE — NON-NEGOTIABLE:
1. Evaluate ONLY the candidate's language. Examiner wording must never affect the candidate score.
2. Every quoted example, grammar correction, vocabulary upgrade, strength, and priority must be supported by the supplied candidate transcript or timing metadata. Never invent candidate sentences.
3. When you provide a grammar correction, the "incorrect" field must be an exact or minimally trimmed phrase that actually appears in the candidate transcript. If there is no defensible correction, return an empty corrections array.
4. When you provide a vocabulary improvement, the "original" field must be wording actually used by the candidate. Do not manufacture weak phrases merely to fill the array.
5. Do not penalize the candidate's opinion, factual stance, accent, or topic choice. Assess communicative language performance only.
6. Treat obvious speech-to-text punctuation/capitalization mistakes cautiously; do not automatically count likely transcription artifacts as grammar errors.

SCORING RULES:
1. Use IELTS-style bands from 1.0 to 9.0 in 0.5 increments for each assessable criterion.
2. Raw usable audio evidence available = ${hasAudioEvidence}.
3. If audio evidence is FALSE, pronunciation MUST be { status: "not_assessed", score: 0 }. Do not infer pronunciation, stress, intonation, accent, or intelligibility from text.
4. If audio evidence is FALSE, the overall number is a TRANSCRIPT-BASED PRACTICE ESTIMATE from Fluency/Coherence, Lexical Resource, and Grammar only. Keep confidence conservative because one official criterion is unavailable.
5. For transcript-only Fluency & Coherence, assess idea development, logical sequencing, visible repetition/self-repair, answer extension, and cohesion. Do not claim to have measured pause length, speech rate, rhythm, or hesitation unless reliable timing/audio evidence explicitly supports it.
6. Score the performance globally across the available test evidence. Do not reward verbosity by itself and do not mechanically calculate scores from word count, lexical diversity, or response length.
7. Treat the supplied evidence statistics only as cross-checks. The transcript and question-answer context are the primary evidence.
8. A short but accurate answer and a long but weak answer must not receive the same score merely because of length.
9. Distinguish Band 5/6/7/8 explicitly. Your criterion feedback must say what observed behavior places the candidate near the chosen band and what prevents the next band when applicable.

FEEDBACK QUALITY:
1. Make feedback diagnostic, specific, and useful for the next attempt.
2. Return 3-4 genuine strengths and 3-4 highest-priority improvements where evidence supports them. Avoid stock advice that could apply to any learner.
3. Generate partFeedback only for Parts that contain candidate evidence. Each Part entry must include a concise summary, evidence-backed strengths, improvements, and short transcript excerpts.
4. Part 1 feedback should focus on directness, natural extension, and handling familiar questions.
5. Part 2 feedback should focus on long-turn development, organization, coverage of the cue card, and ability to sustain the response.
6. Part 3 feedback should focus on explanation, justification, comparison/speculation where relevant, and development of abstract ideas.
7. actionPlan must contain concrete practice actions, not generic encouragement. Keep it to 3-5 steps.
8. examinerNote should summarize the candidate's current performance and the single biggest change most likely to raise the next practice band.
9. Fluency examples must be short exact excerpts from candidate answers. Grammar "incorrect" and lexical "original" strings must be exact/minimally trimmed candidate wording.
10. If there is no defensible grammar correction or lexical upgrade, return an empty array instead of inventing one.
11. Return strict JSON matching the provided schema and no extra prose outside the JSON.`;

  const userPrompt = `Evaluate this completed IELTS Speaking practice session.

SESSION METADATA
- Session ID: ${sessionId}
- Candidate ID: ${userId}
- Selected mode: ${session.selectedTestSnapshot?.mode || session.currentPart || 'unknown'}
- Completion status: ${session.status}
- Candidate words: ${wordCount}
- Candidate response turns: ${candTurns.length}
- Total transcript turns: ${totalTurns}
- Usable raw audio evidence: ${hasAudioEvidence}

EVIDENCE STATISTICS (diagnostic only; DO NOT score mechanically from these)
${JSON.stringify(evidenceStats, null, 2)}

TEST SNAPSHOT
${testSnapshotSummary}

PART 2 TIMING METADATA
${part2TimingSummary}

QUESTION / CANDIDATE RESPONSE INDEX
${responseIndex}

TRANSCRIPT JSON
${formattedTranscript}

Produce the post-test evaluation now. Base every score and feedback point on this evidence. If the evidence is mixed, explain the limiting feature rather than giving generic praise.`;

  // 6. Execute Gemini API call. Deterministic fallback is permitted only in explicit non-production sandbox mode.
  let evaluation: IELTSEvaluation;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const sandboxEvaluationAllowed =
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST) ||
    (process.env.NODE_ENV !== 'production' && process.env.ALLOW_SANDBOX_EVALUATIONS === 'true');

  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });

      console.log(`[EvaluationPipeline] Calling Gemini model ${EVALUATION_MODEL} for session ${sessionId}...`);

      const callModel = async (model: string, prompt: string): Promise<any> => ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: IELTS_EVALUATION_RESPONSE_SCHEMA,
        }
      });

      const isUnavailableModelError = (err: any): boolean => {
        const message = String(err?.message || '').toLowerCase();
        return err?.status === 404 ||
          message.includes('not_found') ||
          message.includes('not found') ||
          message.includes('no longer available') ||
          message.includes('not available to new users');
      };

      let activeModel = EVALUATION_MODEL;
      let response: any;
      try {
        response = await callModel(activeModel, userPrompt);
      } catch (primaryModelErr: any) {
        if (isUnavailableModelError(primaryModelErr) && EVALUATION_FALLBACK_MODEL !== EVALUATION_MODEL) {
          activeModel = EVALUATION_FALLBACK_MODEL;
          console.warn(`[EvaluationPipeline] Primary model ${EVALUATION_MODEL} is unavailable. Retrying with ${activeModel}...`);
          response = await callModel(activeModel, userPrompt);
        } else {
          throw primaryModelErr;
        }
      }

      const parseAndValidate = (rawResponse: any): IELTSEvaluation => {
        const rawText = typeof rawResponse?.text === 'string' ? rawResponse.text : '';
        if (!rawText.trim()) throw new Error('Gemini returned an empty evaluation response.');

        let parsedJson: any;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          throw new Error('Gemini returned malformed evaluation JSON.');
        }

        return validateAndRepairEvaluation(parsedJson, sessionId, userId, hasAudioEvidence, {
          candidateText,
          evidenceStats,
          engine: 'gemini',
        });
      };

      try {
        evaluation = parseAndValidate(response);
      } catch (qualityErr: any) {
        // One bounded retry is preferable to silently repairing missing scores to
        // 6.5. Tell the model exactly why its first report was rejected.
        const retryPrompt = `${userPrompt}\n\nQUALITY RETRY\nYour previous evaluation was rejected by the server quality gate for this reason: ${qualityErr?.message || 'insufficient grounding'}. Regenerate the entire JSON report. Do not reuse generic filler. Every example/correction must be grounded in the candidate transcript.`;
        console.warn('[EvaluationPipeline] Evaluation quality gate rejected first response. Retrying once:', qualityErr?.message);
        response = await callModel(activeModel, retryPrompt);
        evaluation = parseAndValidate(response);
      }

      evaluation.evaluationModel = activeModel;
      recordRateLimitUsage(userId);
    } catch (genAiErr: any) {
      await setEvaluationStatusInStore(sessionId, userId, 'failed', evaluationId);
      // CRITICAL: when a real API key is configured, never hide provider/quality
      // failures behind a canned score. The UI should show a retryable error.
      throw new Error(`Gemini evaluation failed: ${genAiErr?.message || 'Unknown provider error'}`);
    }
  } else {
    if (!sandboxEvaluationAllowed) {
      await setEvaluationStatusInStore(sessionId, userId, 'failed', evaluationId);
      throw new Error('GEMINI_API_KEY is required for evaluations in production.');
    }
    console.log(`[EvaluationPipeline Sandbox] No API key configured. Generating deterministic sandbox evaluation for session ${sessionId}.`);
    evaluation = generateSandboxFallbackEvaluation(session, userId, hasAudioEvidence);
  }

  // 7. Persist completed evaluation and update session state.
  // A provider success is not a completed job until the result is durably stored.
  try {
    await saveCompletedEvaluationToStore(sessionId, userId, evaluation);
  } catch (storageErr) {
    await setEvaluationStatusInStore(sessionId, userId, 'failed', evaluationId);
    throw new Error(`Evaluation was generated but could not be saved: ${storageErr instanceof Error ? storageErr.message : 'Unknown storage error'}`);
  }

  await recordUsageEvent(userId, sessionId, 'evaluation_generated', {
    overallBand: evaluation.estimatedOverallBand,
    hasAudioEvidence
  });

  return evaluation;
}

/**
 * Deterministic sandbox fallback evaluation for unconfigured API key or offline testing
 */
function generateSandboxFallbackEvaluation(
  session: IELTSPracticeSession,
  userId: string,
  hasAudioEvidence: boolean
): IELTSEvaluation {
  const candSpeech = session.transcript.filter(t => t.speaker === 'candidate');
  const evidenceStats = buildEvaluationEvidenceStats(session);
  const wordCount = evidenceStats.candidateWords;

  let baseScore = 6.0;
  if (wordCount > 150) baseScore = 7.5;
  else if (wordCount > 80) baseScore = 7.0;
  else if (wordCount > 30) baseScore = 6.5;

  const mockParsed = {
    estimatedOverallBand: baseScore,
    bandRange: `${(baseScore - 0.5).toFixed(1)} - ${Math.min(9.0, baseScore + 0.5).toFixed(1)}`,
    confidence: 0.35,
    disclaimer: 'Estimated Practice Band - Simulated assessment, not official IELTS score.',
    examinerNote: `DEMO EVALUATION ONLY: this score was produced by the deterministic sandbox evaluator for the topic "${session.topic}". It is not a model-based IELTS judgment and must not be treated as a real band estimate.`,
    evidence: [`Candidate produced ${wordCount} words across ${candSpeech.length} response turns.`],
    strengths: [
      'Good topical relevance and response structure.',
      'Effective use of linking words between main ideas.'
    ],
    priorities: [
      'Incorporate a broader range of complex grammatical structures.',
      'Enhance vocabulary precision with idiomatic collocations.'
    ],
    actionPlan: [
      'Day 1-2: Review vocabulary collocations related to global topics.',
      'Day 3-4: Practice Part 2 speech organization using bullet-point mapping.',
      'Day 5-7: Record complete practice tests to refine speaking pacing.'
    ],
    criteria: {
      fluencyAndCoherence: {
        score: baseScore,
        feedback: 'Good flow and response continuity throughout the conversation.',
        examples: ['Smooth connections between points made.']
      },
      lexicalResource: {
        score: baseScore,
        feedback: 'Sufficient vocabulary range to discuss topics in depth.',
        improvedPhrases: [
          { original: 'very good', improved: 'highly advantageous', explanation: 'Upgrades basic adjective.' }
        ]
      },
      grammaticalRangeAccuracy: {
        score: baseScore,
        feedback: 'Mix of simple and complex sentence forms with minor structural errors.',
        corrections: []
      },
      pronunciation: hasAudioEvidence ? {
        score: baseScore,
        status: 'assessed',
        feedback: 'Clear pronunciation and speech rhythm overall.',
        problemWords: []
      } : {
        score: 0,
        status: 'not_assessed',
        feedback: 'Pronunciation was not assessed as raw audio recording evidence was unavailable.',
        problemWords: []
      }
    }
  };

  return validateAndRepairEvaluation(mockParsed, session.id, userId, hasAudioEvidence, {
    evidenceStats,
    engine: 'sandbox',
    qualityWarnings: ['Sandbox/demo evaluator active: score is deterministic and not a genuine AI language assessment.'],
  });
}

/**
 * Persists status updates to Firestore and/or MockPracticeService
 */
async function setEvaluationStatusInStore(
  sessionId: string,
  userId: string,
  status: EvaluationStatus,
  evaluationId: string
): Promise<void> {
  let cloudUpdated = false;
  if (isFirestoreServerAvailable()) {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('speakingSessions').doc(sessionId).update({
        evaluationStatus: status,
        evaluationId,
        updatedAt: Date.now()
      });
      cloudUpdated = true;
    } catch (err) {
      markFirestoreServerUnavailable(err);
      console.warn('[EvaluationPipeline] Failed to update Firestore session evaluationStatus; recovery cache retained:', err);
    }
  }
  // Always mirror status into the server recovery cache. This does not create a
  // sandbox score and is safe for genuine Gemini evaluations.
  MockPracticeService.updateSessionEvaluationStatus(sessionId, status, evaluationId);
  if (!cloudUpdated && isFirebaseServerEnabled()) {
    console.warn(`[EvaluationPipeline] Cloud status update unavailable for ${sessionId}; continuing with recovery cache.`);
  }
}

/**
 * Saves final completed evaluation document and marks session complete
 */
async function saveCompletedEvaluationToStore(
  sessionId: string,
  userId: string,
  evaluation: IELTSEvaluation
): Promise<void> {
  let cloudSaved = false;
  if (isFirestoreServerAvailable()) {
    try {
      const db = getFirebaseAdmin().firestore();
      const batch = db.batch();

      const evalRef = db.collection('evaluations').doc(evaluation.id);
      batch.set(evalRef, evaluation);

      const sessionRef = db.collection('speakingSessions').doc(sessionId);
      batch.update(sessionRef, {
        evaluationId: evaluation.id,
        evaluationStatus: 'completed',
        status: 'completed',
        updatedAt: Date.now()
      });

      await batch.commit();
      cloudSaved = true;
      console.log(`[EvaluationPipeline] Successfully stored evaluation ${evaluation.id} in Firestore.`);
    } catch (err) {
      if (!markFirestoreServerUnavailable(err)) {
        console.error('[EvaluationPipeline] Firestore rejected evaluation persistence; preserving genuine report in recovery cache:', err);
      } else {
        console.warn('[EvaluationPipeline] Firestore unavailable while saving evaluation; preserving genuine report in recovery cache:', err);
      }
    }
  }

  // A provider-successful, validated evaluation must remain usable even if the
  // persistence layer is temporarily unavailable. This is a recovery copy of
  // the real Gemini result, not the deterministic sandbox evaluator.
  MockPracticeService.saveEvaluation(evaluation);
  MockPracticeService.updateSessionEvaluationStatus(sessionId, 'completed', evaluation.id);
  if (!cloudSaved && isFirebaseServerEnabled()) {
    console.warn(`[EvaluationPipeline] Evaluation ${evaluation.id} is available from recovery cache; Firestore sync did not complete.`);
  }
}
