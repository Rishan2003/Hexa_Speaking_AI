const API_REVISION = '1.6.0-detailed-evidence-feedback';
const LEGACY_PRONUNCIATION_PLACEHOLDER = 0;
const runtimeEnv: Record<string, string | undefined> = (globalThis as any)?.process?.env || {};

function requestId() {
  return `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function send(res: any, status: number, body: Record<string, unknown>) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-HEXA-Evaluation-Revision', API_REVISION);
  return res.status(status).json(body);
}

async function readJsonSafe(response: Response) {
  const text = await response.text();
  try {
    return { payload: text ? JSON.parse(text) : {}, text };
  } catch {
    return { payload: {}, text };
  }
}

function upstreamMessage(payload: any, fallback: string) {
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}

function roundBand(value: unknown, fallback = 6): number {
  const n = typeof value === 'number' ? value : Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(1, Math.min(9, Math.round(safe * 2) / 2));
}

function words(text: string): string[] {
  return String(text || '').toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function cleanStrings(value: unknown, max = 6): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, max)
    : [];
}

function extractGeminiText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('').trim();
}

function parseJsonText(text: string): any {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Gemini returned an empty evaluation response.');
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(withoutFence);
}

function makeSchema() {
  const stringArray = { type: 'array', items: { type: 'string' } };
  return {
    type: 'object',
    properties: {
      confidence: { type: 'number' },
      examinerNote: { type: 'string' },
      voiceFeedbackBangla: { type: 'string' },
      evidence: stringArray,
      strengths: stringArray,
      priorities: stringArray,
      actionPlan: stringArray,
      problemDiagnostics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            area: { type: 'string' },
            label: { type: 'string' },
            severity: { type: 'string' },
            evidence: { type: 'string' },
            evidenceExamples: stringArray,
            explanation: { type: 'string' },
            howToImprove: { type: 'string' },
            practiceDrill: { type: 'string' },
          },
          required: ['area', 'label', 'severity', 'evidence', 'evidenceExamples', 'explanation', 'howToImprove', 'practiceDrill'],
        },
      },
      partFeedback: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            part: { type: 'string' },
            summary: { type: 'string' },
            strengths: stringArray,
            improvements: stringArray,
            evidence: stringArray,
          },
          required: ['part', 'summary', 'strengths', 'improvements', 'evidence'],
        },
      },
      criteria: {
        type: 'object',
        properties: {
          fluencyAndCoherence: {
            type: 'object',
            properties: {
              score: { type: 'number' },
              feedback: { type: 'string' },
              examples: stringArray,
            },
            required: ['score', 'feedback', 'examples'],
          },
          lexicalResource: {
            type: 'object',
            properties: {
              score: { type: 'number' },
              feedback: { type: 'string' },
              improvedPhrases: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    original: { type: 'string' },
                    improved: { type: 'string' },
                    explanation: { type: 'string' },
                  },
                  required: ['original', 'improved', 'explanation'],
                },
              },
            },
            required: ['score', 'feedback', 'improvedPhrases'],
          },
          grammaticalRangeAccuracy: {
            type: 'object',
            properties: {
              score: { type: 'number' },
              feedback: { type: 'string' },
              corrections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    incorrect: { type: 'string' },
                    correct: { type: 'string' },
                    ruleExplanation: { type: 'string' },
                  },
                  required: ['incorrect', 'correct', 'ruleExplanation'],
                },
              },
            },
            required: ['score', 'feedback', 'corrections'],
          },
        },
        required: ['fluencyAndCoherence', 'lexicalResource', 'grammaticalRangeAccuracy'],
      },
    },
    required: ['confidence', 'examinerNote', 'voiceFeedbackBangla', 'evidence', 'strengths', 'priorities', 'actionPlan', 'problemDiagnostics', 'partFeedback', 'criteria'],
  };
}

function normalizeEvaluation(parsed: any, session: any, uid: string, model: string) {
  const criteria = parsed?.criteria || {};
  const fluencyRaw = criteria?.fluencyAndCoherence || {};
  const lexicalRaw = criteria?.lexicalResource || {};
  const grammarRaw = criteria?.grammaticalRangeAccuracy || {};

  const fluencyScore = roundBand(fluencyRaw.score);
  const lexicalScore = roundBand(lexicalRaw.score);
  const grammarScore = roundBand(grammarRaw.score);
  // This endpoint evaluates transcript-grounded language performance only.
  // Keep the legacy pronunciation field structurally present for older clients,
  // but do not use it in the displayed practice estimate.
  const pronunciationScore = LEGACY_PRONUNCIATION_PLACEHOLDER;
  const overall = roundBand((fluencyScore + lexicalScore + grammarScore) / 3);

  const candidateTurns = Array.isArray(session.transcript)
    ? session.transcript.filter((turn: any) => turn?.speaker === 'candidate')
    : [];
  const allWords = candidateTurns.flatMap((turn: any) => words(turn?.text || ''));
  const uniqueWords = new Set(allWords);
  const wordCounts = candidateTurns.map((turn: any) => words(turn?.text || '').length);
  const sorted = [...wordCounts].sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : 0;

  const sessionId = String(session.id || '').trim();
  const evaluationId = `eval_${sessionId}_v7`;

  const allowedDiagnosticAreas = new Set(['Fluency & Coherence', 'Lexical Resource', 'Grammar', 'General']);
  const allowedSeverities = new Set(['high', 'medium', 'low']);
  const problemDiagnostics = Array.isArray(parsed?.problemDiagnostics)
    ? parsed.problemDiagnostics.slice(0, 4).map((item: any) => ({
        area: allowedDiagnosticAreas.has(String(item?.area)) ? String(item.area) : 'General',
        label: String(item?.label || '').trim(),
        severity: allowedSeverities.has(String(item?.severity).toLowerCase())
          ? String(item.severity).toLowerCase()
          : 'medium',
        evidence: String(item?.evidence || item?.evidenceExamples?.[0] || '').trim(),
        evidenceExamples: cleanStrings(item?.evidenceExamples, 4),
        explanation: String(item?.explanation || '').trim(),
        howToImprove: String(item?.howToImprove || '').trim(),
        practiceDrill: String(item?.practiceDrill || '').trim(),
      })).filter((item: any) => item.label && item.evidence && item.howToImprove && item.practiceDrill)
    : [];

  return {
    id: evaluationId,
    sessionId,
    userId: uid,
    createdAt: Date.now(),
    estimatedOverallBand: overall,
    bandRange: `${Math.max(1, overall - 0.5).toFixed(1)} - ${Math.min(9, overall + 0.5).toFixed(1)}`,
    confidence: Math.max(0.35, Math.min(0.72, Number(parsed?.confidence) || 0.65)),
    disclaimer: 'Transcript-based speaking practice estimate. This is not an official IELTS result.',
    assessmentBasis: 'transcript_only',
    evaluationEngine: 'gemini',
    evaluationModel: model,
    rubricVersion: 'IELTS-speaking-transcript-evidence-2026-08-v5',
    evidenceStats: {
      candidateWords: allWords.length,
      candidateResponseTurns: candidateTurns.length,
      averageWordsPerResponse: candidateTurns.length ? Math.round((allWords.length / candidateTurns.length) * 10) / 10 : 0,
      medianWordsPerResponse: Math.round(median * 10) / 10,
      longestResponseWords: Math.max(0, ...wordCounts),
      veryShortResponses: wordCounts.filter((count) => count <= 5).length,
      lexicalDiversity: allWords.length ? Math.round((uniqueWords.size / allWords.length) * 1000) / 1000 : 0,
      timedCandidateResponses: candidateTurns.filter((turn: any) => Number.isFinite(turn?.startTime) && Number.isFinite(turn?.endTime) && turn.endTime > turn.startTime).length,
      ...(typeof session?.part2Meta?.longTurnDuration === 'number'
        ? { part2LongTurnSeconds: Math.round(session.part2Meta.longTurnDuration * 10) / 10 }
        : {}),
    },
    qualityWarnings: [],
    criteria: {
      fluencyAndCoherence: {
        score: fluencyScore,
        feedback: String(fluencyRaw.feedback || 'The transcript did not provide enough detail for a more specific fluency assessment.').trim(),
        examples: cleanStrings(fluencyRaw.examples, 4),
      },
      lexicalResource: {
        score: lexicalScore,
        feedback: String(lexicalRaw.feedback || 'The transcript did not provide enough detail for a more specific lexical assessment.').trim(),
        improvedPhrases: Array.isArray(lexicalRaw.improvedPhrases)
          ? lexicalRaw.improvedPhrases.slice(0, 5).map((item: any) => ({
              original: String(item?.original || '').trim(),
              improved: String(item?.improved || '').trim(),
              explanation: String(item?.explanation || '').trim(),
            })).filter((item: any) => item.original && item.improved && item.explanation)
          : [],
      },
      grammaticalRangeAccuracy: {
        score: grammarScore,
        feedback: String(grammarRaw.feedback || 'The transcript did not provide enough detail for a more specific grammar assessment.').trim(),
        corrections: Array.isArray(grammarRaw.corrections)
          ? grammarRaw.corrections.slice(0, 6).map((item: any) => ({
              incorrect: String(item?.incorrect || '').trim(),
              correct: String(item?.correct || '').trim(),
              ruleExplanation: String(item?.ruleExplanation || '').trim(),
            })).filter((item: any) => item.incorrect && item.correct && item.ruleExplanation)
          : [],
      },
      pronunciation: {
        score: pronunciationScore,
        status: 'not_assessed',
        feedback: '',
        problemWords: [],
      },
    },
    examinerNote: String(parsed?.examinerNote || 'This transcript-based practice report summarizes the candidate’s observed speaking performance.').trim(),
    voiceFeedbackBangla: `আপনার speaking practice estimate আনুমানিক ${overall.toFixed(1)}। ${String(parsed?.voiceFeedbackBangla || 'এখন আপনার main focus হবে answer একটু বেশি develop করা, vocabulary-তে আরও natural phrase use করা, আর grammar-এর recurring mistakeগুলো ঠিক করা। প্রতিদিন short speaking practice করে নিজের recording শুনবেন এবং যেসব sentence weak লাগছে সেগুলো correct করে আবার বলবেন।').trim()}`.trim(),
    evidence: cleanStrings(parsed?.evidence, 8),
    strengths: cleanStrings(parsed?.strengths, 5),
    priorities: cleanStrings(parsed?.priorities, 5),
    problemDiagnostics,
    partFeedback: Array.isArray(parsed?.partFeedback)
      ? parsed.partFeedback.slice(0, 3).map((item: any) => ({
          part: ['Part 1', 'Part 2', 'Part 3'].includes(String(item?.part)) ? String(item.part) : 'Part 1',
          summary: String(item?.summary || '').trim(),
          strengths: cleanStrings(item?.strengths, 4),
          improvements: cleanStrings(item?.improvements, 4),
          evidence: cleanStrings(item?.evidence, 4),
        })).filter((item: any) => item.summary)
      : [],
    actionPlan: cleanStrings(parsed?.actionPlan, 6),
    status: 'completed',
  };
}

async function verifyFirebaseIdToken(idToken: string) {
  const firebaseWebApiKey = String(runtimeEnv.FIREBASE_WEB_API_KEY || runtimeEnv.VITE_FIREBASE_API_KEY || '').trim();
  if (!firebaseWebApiKey) {
    return { ok: false as const, status: 503, code: 'FIREBASE_WEB_API_KEY_MISSING', error: 'Firebase Web API key is not available to the evaluation function.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      }
    );
    const result = await readJsonSafe(response);
    const uid = result.payload?.users?.[0]?.localId;
    if (!response.ok || typeof uid !== 'string' || !uid) {
      return {
        ok: false as const,
        status: 401,
        code: String(result.payload?.error?.message || 'INVALID_ID_TOKEN'),
        error: 'Your sign-in session could not be verified. Sign in again and retry.',
      };
    }
    return { ok: true as const, uid };
  } catch (error: any) {
    return {
      ok: false as const,
      status: 502,
      code: error?.name === 'AbortError' ? 'FIREBASE_AUTH_TIMEOUT' : 'FIREBASE_AUTH_NETWORK_ERROR',
      error: error?.name === 'AbortError'
        ? 'Firebase authentication verification timed out.'
        : 'Could not reach Firebase Authentication to verify the user.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(model: string, apiKey: string, systemInstruction: string, prompt: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 52_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: makeSchema(),
            maxOutputTokens: 8192,
          },
        }),
        signal: controller.signal,
      }
    );
    const result = await readJsonSafe(response);
    if (!response.ok) {
      const error: any = new Error(upstreamMessage(result.payload, `Gemini returned HTTP ${response.status}.`));
      error.status = response.status;
      error.code = result.payload?.error?.status || `GEMINI_HTTP_${response.status}`;
      throw error;
    }
    return result.payload;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: any, res: any) {
  const rid = requestId();

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, {
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
      stage: 'evaluation_route',
      requestId: rid,
      apiRevision: API_REVISION,
    });
  }

  try {
    const authHeader = String(req.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) {
      return send(res, 401, {
        error: 'Authentication is required to generate an evaluation.',
        code: 'AUTH_REQUIRED',
        stage: 'authentication',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const verified = await verifyFirebaseIdToken(authHeader.slice(7).trim());
    if (!verified.ok) {
      return send(res, verified.status, {
        error: verified.error,
        code: verified.code,
        stage: 'authentication',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sessionId = String(body.sessionId || '').trim();
    const session = body.sessionEvidence && typeof body.sessionEvidence === 'object'
      ? body.sessionEvidence
      : null;

    if (!sessionId || !session || String(session.id || '').trim() !== sessionId) {
      return send(res, 400, {
        error: 'The completed session evidence was not supplied to the evaluator.',
        code: 'EVALUATION_EVIDENCE_MISSING',
        stage: 'session_evidence',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    if (session.userId && String(session.userId) !== verified.uid) {
      return send(res, 403, {
        error: 'This session belongs to another user.',
        code: 'EVALUATION_SESSION_OWNER_MISMATCH',
        stage: 'session_evidence',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const transcript = Array.isArray(session.transcript) ? session.transcript : [];
    const candidateTurns = transcript.filter((turn: any) => turn?.speaker === 'candidate' && String(turn?.text || '').trim());
    if (!candidateTurns.length) {
      return send(res, 422, {
        error: 'There is no candidate speech in the transcript to evaluate.',
        code: 'EVALUATION_TRANSCRIPT_EMPTY',
        stage: 'session_evidence',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const apiKey = String(runtimeEnv.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return send(res, 503, {
        error: 'GEMINI_API_KEY is not configured on the server.',
        code: 'GEMINI_NOT_CONFIGURED',
        stage: 'gemini_configuration',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const primaryModel = String(runtimeEnv.GEMINI_EVALUATION_MODEL || 'gemini-3.6-flash').trim();
    const fallbackModel = String(runtimeEnv.GEMINI_EVALUATION_FALLBACK_MODEL || 'gemini-3.5-flash').trim();

    const evaluationMode = String(session?.selectedTestSnapshot?.mode || session?.currentPart || 'unknown')
      .trim()
      .toLowerCase();
    const isFullTest = evaluationMode === 'full';

    const modernBanglaVoiceStyleInstruction = `VOICE FEEDBACK LANGUAGE STYLE — IMPORTANT:
- Write voiceFeedbackBangla the way an educated modern Bangladeshi IELTS teacher would actually speak to a student today. It must sound conversational and local, not like a formal Bangla translation, textbook, newsreader, or government notice.
- Use respectful standard spoken Bangla with "আপনি/আপনার", short-to-medium natural sentences, and everyday Bangladeshi phrasing. Avoid সাধু/archaic wording, literary phrasing, and unnecessarily formal pure-Bangla synonyms.
- Use NATURAL Bangla-English code-mixing. Keep common IELTS/coaching terms in English (Latin script) when Bangladeshi speakers normally say them in English. Natural examples include: practice estimate, feedback, Fluency and Coherence, Lexical Resource, Grammar, answer, idea, example, Part 1, Part 2, Part 3, practice, improve/improvement, linking words, phrase, complex sentence, tense, mistake, correction, target, recording, and 7-day practice plan.
- Do not force Bengali translations for common English coaching terms if that makes the speech sound unnatural. For example, prefer a style like "আপনার Part 2 answer-এ idea ভালো ছিল, কিন্তু development আরেকটু দরকার" rather than overly formal translated phrasing. This is a STYLE example only; never claim that specific observation unless the transcript supports it.
- Code-mixing must be balanced: Bangla remains the main sentence language, with English terms inserted where they are genuinely normal in modern Bangladeshi speech. Do not turn the feedback into English sentences with a few Bangla words.
- Use natural spoken transitions such as "এখানে একটা ভালো দিক হলো", "তবে একটা জায়গায় কাজ করতে হবে", "আরেকটা important point হলো", "next practice-এ চেষ্টা করবেন" when appropriate. Do not overuse the same transition.
- Keep technical IELTS criterion names in English rather than translating them into stiff Bangla.
- The final script should be easy to listen to aloud and should feel like one teacher talking directly to one learner. Do not use regional dialect, slang, or over-friendly terms such as ভাই/ব্রো.`;

    const banglaVoiceFeedbackInstruction = isFullTest
      ? `Also create voiceFeedbackBangla: a substantially longer, detailed natural spoken coaching review in Bangladeshi Bangla, about 340-420 words. This is a FULL IELTS Speaking test, so the feedback must be clearly more detailed than the feedback for an individual part and should be long enough for roughly 3-4 minutes of spoken coaching. Start with a brief overall interpretation without stating the overall practice estimate. Then review Part 1, Part 2, and Part 3 separately, in that order, using only transcript-grounded evidence from each part. For Part 1, comment on naturalness, answer development, fluency/coherence, vocabulary, and grammar. For Part 2, comment on the long-turn structure, development of ideas, coherence, vocabulary range, and grammar, using the Part 2 metadata when it is relevant. For Part 3, comment on the ability to explain, justify, compare, generalize, and develop more abstract answers, as supported by the transcript. After the three part-level reviews, give an integrated discussion of Fluency and Coherence, Lexical Resource, and Grammatical Range and Accuracy across the whole test. Use several concrete transcript-grounded examples, including corrections or better expressions where useful. Then identify the learner's two strongest points, the three highest-priority improvements, and finish with a practical 7-day practice direction that targets the specific recurring weaknesses found in this test. Make the advice specific and actionable rather than generic. Do not discuss any category that is not assessed from the supplied transcript. Do not invent wording or performance that is not present in the transcript. Do not use markdown, bullet symbols, emojis, headings, or English-only sentences. Do not state the overall practice estimate because the server will prepend it. Do not compress the Full Test feedback into the same length or depth as an individual-part review.`
      : `Also create voiceFeedbackBangla: a detailed natural spoken coaching review in Bangladeshi Bangla, about 240-320 words. This is an INDIVIDUAL IELTS Speaking part, so focus only on the part actually taken; do not discuss or invent performance from untested parts. It should sound like an experienced, supportive IELTS teacher speaking directly to the learner and should be detailed enough for roughly 2-3 minutes of spoken feedback. Start with a brief overall interpretation without stating the overall practice estimate; then discuss Fluency and Coherence with at least two transcript-grounded observations where available; then Lexical Resource with concrete word-choice or collocation examples; then Grammatical Range and Accuracy with concrete recurring patterns and corrections grounded in the transcript. Identify the learner's two strongest points, the three highest-priority improvements, and finish with a practical 7-day practice direction. Do not discuss any category that is not assessed from the supplied transcript. Where possible, refer naturally to specific things the learner actually said, but never invent wording. Make the advice specific and actionable rather than generic. Do not use markdown, bullet symbols, emojis, headings, or English-only sentences. Do not state the overall practice estimate because the server will prepend it. Do not shorten the feedback into a brief summary.`;

    const diagnosticInstruction = `ONE-PAGE DIAGNOSTIC FEEDBACK — IMPORTANT:
- problemDiagnostics must contain exactly 3 of the candidate's HIGHEST-IMPACT recurring problems whenever the transcript provides enough evidence. Do not fill space with tiny one-off slips.
- area must be exactly one of: Fluency & Coherence, Lexical Resource, Grammar, General.
- Use specific labels where evidence supports them, for example: Past tense control, Subject-verb agreement, Article use, Prepositions, Sentence fragments, Limited complex grammar, Lexical misuse, Unnatural collocation, Repetition, Visible filler words, Weak answer development, Weak linking/cohesion, or Self-correction/restarts.
- Choose only issues genuinely visible in candidate language. Never claim a problem simply because it is common among IELTS learners.
- evidence must be the single clearest exact or minimally trimmed candidate example.
- evidenceExamples must contain 2-4 separate transcript-grounded examples for the same recurring problem whenever available. Prefer examples from different answers/parts to prove that the issue is recurring. If only one defensible example exists, include only that one and do not invent another.
- For grammar or lexical issues, evidenceExamples should preserve the candidate wording. Corrections belong in howToImprove, not inside the evidence quote.
- For repetition or visible filler issues, quote the repeated/filler forms actually present in the transcript. Do not infer invisible behaviour from text.
- explanation must briefly connect the recurring pattern to clarity, precision, answer development, or the relevant assessed criterion.
- howToImprove must give a direct, reusable correction strategy AND show at least one corrected/better version when the problem allows it.
- practiceDrill must be a concrete 5-10 minute exercise with a measurable target, such as number of sentences, answers, corrections, or repetitions.
- Prefer a balanced set across Fluency & Coherence, Lexical Resource, and Grammar when the evidence supports it. Do not force all categories.
- Do not mention, score, discuss, or draw attention to any speaking category that is not assessed from the supplied transcript in any student-facing feedback field.

CRITERION FEEDBACK — MORE DETAIL + MORE EVIDENCE:
- Fluency and Coherence feedback should be about 55-90 words. Explain what the candidate does well, the main limiting pattern, and what would move performance higher. Return 2-4 exact/minimally trimmed candidate examples in examples; include both useful strengths and limitations when possible.
- Lexical Resource feedback should be about 55-90 words. Discuss range, precision, repetition, word choice, and collocation only when supported. Return 2-4 high-value improvedPhrases whenever evidence exists. Each item must contain the exact candidate wording, a natural improved version, and a short explanation.
- Grammatical Range and Accuracy feedback should be about 55-90 words. Identify recurring grammar patterns, range of structures, and accuracy. Return 2-4 high-value corrections whenever evidence exists, prioritizing recurring patterns such as tense, agreement, articles, prepositions, sentence structure, or complex-clause control.
- Criterion feedback must use multiple pieces of evidence rather than making broad generic claims. Never invent a quote just to satisfy a count.
- Keep the wording compact enough for a one-page PDF, but do not reduce criterion feedback to one vague sentence.`;

    const systemInstruction = `You are a strict IELTS Speaking practice evaluator. This is not an official IELTS result.\n\nAssess ONLY the candidate language visible in the supplied transcript. Score only Fluency and Coherence, Lexical Resource, and Grammatical Range and Accuracy from 1.0 to 9.0 in 0.5 increments. Do not assess pronunciation because raw audio is not supplied, and do not mention pronunciation or any other unassessed category in student-facing feedback fields.\n\nEvery quotation, correction, vocabulary upgrade, strength, priority, diagnostic, and part-level observation must be grounded in the candidate transcript. Do not invent candidate wording. Ignore examiner language when scoring. Do not mechanically score from word count. Use IELTS-style public band distinctions and explain the limiting feature that prevents the next band when relevant.\n\n${diagnosticInstruction}\n\n${banglaVoiceFeedbackInstruction}\n\n${modernBanglaVoiceStyleInstruction}\n\nReturn detailed but focused diagnostic feedback suitable for a learner. Output must conform to the supplied JSON schema.`;

    const compactTranscript = transcript.map((turn: any) => ({
      speaker: turn?.speaker,
      text: String(turn?.text || ''),
      questionId: turn?.questionId || null,
      sequence: turn?.sequence ?? null,
      startTime: turn?.startTime ?? null,
      endTime: turn?.endTime ?? null,
    }));

    const prompt = `SESSION\nID: ${sessionId}\nMode: ${session?.selectedTestSnapshot?.mode || session?.currentPart || 'unknown'}\nStatus: ${session?.status || 'completed'}\n\nPART 2 METADATA\n${JSON.stringify(session?.part2Meta || null)}\n\nTEST SNAPSHOT\n${JSON.stringify(session?.selectedTestSnapshot || { topic: session?.topic || '' })}\n\nTRANSCRIPT\n${JSON.stringify(compactTranscript)}\n\nGenerate the evidence-based IELTS Speaking practice assessment now.`;

    let model = primaryModel;
    let payload: any;
    try {
      payload = await callGemini(model, apiKey, systemInstruction, prompt);
    } catch (error: any) {
      const unavailable = error?.status === 404 || String(error?.message || '').toLowerCase().includes('not found');
      if (unavailable && fallbackModel && fallbackModel !== primaryModel) {
        model = fallbackModel;
        payload = await callGemini(model, apiKey, systemInstruction, prompt);
      } else {
        throw error;
      }
    }

    let parsed: any;
    try {
      parsed = parseJsonText(extractGeminiText(payload));
    } catch (error: any) {
      return send(res, 502, {
        error: error?.message || 'Gemini returned unusable evaluation JSON.',
        code: 'EVALUATION_RESPONSE_INVALID',
        stage: 'gemini_response',
        requestId: rid,
        apiRevision: API_REVISION,
        evaluationModel: model,
      });
    }

    const evaluation = normalizeEvaluation(parsed, { ...session, id: sessionId, userId: verified.uid }, verified.uid, model);

    return send(res, 200, {
      ...evaluation,
      requestId: rid,
      apiRevision: API_REVISION,
    });
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError';
    const status = timedOut ? 504 : (Number(error?.status) >= 400 ? 502 : 500);
    console.error('[HEXA evaluation zero-imports]', rid, error?.name, error?.message);
    return send(res, status, {
      error: timedOut
        ? 'Gemini evaluation timed out. Please retry the assessment.'
        : (error?.message || 'The evaluation endpoint encountered an unexpected error.'),
      code: timedOut ? 'EVALUATION_TIMEOUT' : (error?.code || 'EVALUATION_UNEXPECTED_ERROR'),
      stage: 'gemini_evaluation',
      upstreamStatus: error?.status || undefined,
      requestId: rid,
      apiRevision: API_REVISION,
    });
  }
}
