/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  IELTSEvaluation,
  IELTSPracticeSession,
  IELTSExamPart,
  ExamState,
  UserProfile,
  SpeechChunk,
  Part2CueCard,
  SelectedTestSnapshot
} from '../types';
import { LOCAL_HISTORY_STORAGE_KEY, LOCAL_USER_STORAGE_KEY } from '../config.shared';
import { generateTestSnapshot, CUE_CARDS_BANK } from './questionBank';

// Base helper for standard uuid generation
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// Mock database storage in LocalStorage
const SESSIONS_KEY = LOCAL_HISTORY_STORAGE_KEY;
const USER_KEY = LOCAL_USER_STORAGE_KEY;

// Memory fallback for environments without localStorage (such as Node.js test runs)
const memoryStore: Record<string, string> = {};

const safeStorage = {
  getItem(key: string): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return memoryStore[key] || null;
  },
  setItem(key: string, value: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
    memoryStore[key] = value;
  },
  removeItem(key: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
    delete memoryStore[key];
  }
};

// Mock cue card database for Part 2 topics derived from our unified Question Bank
export const MOCK_CUE_CARDS: Part2CueCard[] = CUE_CARDS_BANK.map((card) => ({
  id: card.id,
  topic: card.taskStatement,
  bulletPoints: card.bulletPrompts,
  followUpQuestions: card.part3Questions.map(q => q.text)
}));

// Initial mock data if empty
const INITIAL_MOCK_SESSIONS: IELTSPracticeSession[] = [];
const INITIAL_MOCK_EVALUATIONS: Record<string, IELTSEvaluation> = {};

// We seed default evaluation mocks for demonstration
const SEEDED_EVALUATIONS: Record<string, IELTSEvaluation> = {
  'mock-eval-1': {
    id: 'mock-eval-1',
    sessionId: 'session-prev-1',
    userId: 'mock-user-id',
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    estimatedOverallBand: 7.0,
    criteria: {
      fluencyAndCoherence: {
        score: 7.5,
        feedback: 'Speaks fluently with only occasional self-correction or repetition. Speaks at length easily, though coherence degrades slightly when dealing with highly complex topics in Part 3.',
        examples: [
          'Excellent transition markers: "Moving on to...", "On the flip side..."',
          'Only minor hesitation when choosing vocabulary for abstract topics.'
        ]
      },
      lexicalResource: {
        score: 7.0,
        feedback: 'Uses a wide vocabulary to discuss topics flexibly. Makes good use of collocations, but has a slight tendency to overuse common idiomatic clichés.',
        improvedPhrases: [
          { original: 'hard and stressful job', improved: 'highly demanding profession', explanation: 'Conveys a more professional and natural vocabulary choice.' },
          { original: 'very big problem', improved: 'significant challenge / critical issue', explanation: 'Upgrades basic adjectives to advanced academic terms.' }
        ]
      },
      grammaticalRangeAccuracy: {
        score: 6.5,
        feedback: 'Good mix of simple and complex sentence structures, but commits frequent minor grammatical errors with prepositions and perfect tenses.',
        corrections: [
          { incorrect: 'I have visited there since five years.', correct: 'I visited there five years ago / I have been visiting it for five years.', ruleExplanation: 'Present perfect shouldn\'t be paired with a simple past duration unless using "for".' },
          { incorrect: 'He describe me about...', correct: 'He described to me / He explained...', ruleExplanation: '"Describe" is a transitive verb; it does not take "about".' }
        ]
      },
      pronunciation: {
        score: 7.0,
        feedback: 'Generally easy to understand throughout. Good use of word stress and sentence stress, although some consonant clusters were simplified.',
        problemWords: ['unforgettable', 'specifically', 'colleague']
      }
    },
    examinerNote: 'The candidate was communicative and confident. They demonstrated an ability to organize their responses logically, but need to consolidate grammatical accuracy under pressure to secure a solid Band 7.5+.',
    actionPlan: [
      'Review rules for transitive verb structures and prepositions of time/place.',
      'Incorporate a wider range of academic cohesive markers instead of relying solely on conversational ones.',
      'Practice pacing your speech in Part 2 so you do not run out of key cue card points before the 2-minute mark.'
    ]
  }
};

const SEEDED_SESSIONS: IELTSPracticeSession[] = [
  {
    id: 'session-prev-1',
    userId: 'mock-user-id',
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    status: 'completed',
    currentPart: IELTSExamPart.PART_3,
    currentState: ExamState.COMPLETE,
    topic: 'Travel and Childhood',
    evaluationId: 'mock-eval-1',
    transcript: [
      { id: '1', timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000, speaker: 'examiner', text: 'Good morning. Welcome to the speaking test. Can you tell me about your hometown?', isFinal: true },
      { id: '2', timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 5000, speaker: 'candidate', text: 'Good morning. My hometown is a very big city. It has a lot of skyscrapers and busy streets, but it is also a very stress place to live.', isFinal: true },
      { id: '3', timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 15000, speaker: 'examiner', text: 'I see. Now let\'s transition to Part 2. I have a card for you...', isFinal: true },
      { id: '4', timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 20000, speaker: 'candidate', text: 'I would like to describe a valuable advice from my grandmother. She told me to study hard.', isFinal: true }
    ]
  }
];

// Initialize storage if empty
if (!safeStorage.getItem(SESSIONS_KEY)) {
  safeStorage.setItem(SESSIONS_KEY, JSON.stringify(SEEDED_SESSIONS));
}
if (!safeStorage.getItem('speakready_evals_mock')) {
  safeStorage.setItem('speakready_evals_mock', JSON.stringify(SEEDED_EVALUATIONS));
}

// User authentication mock service
export const MockAuthService = {
  getCurrentUser(): UserProfile | null {
    const raw = safeStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  },

  login(email: string, targetBand: number): UserProfile {
    const user: UserProfile = {
      uid: 'mock-user-id',
      email,
      displayName: email.split('@')[0],
      photoURL: `https://api.dicebear.com/7.x/adventurer/svg?seed=${email}`,
      targetBand,
      onboarded: true
    };
    safeStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  },

  logout(): void {
    safeStorage.removeItem(USER_KEY);
  },

  updateOnboarding(onboarded: boolean): UserProfile | null {
    const user = this.getCurrentUser();
    if (user) {
      user.onboarded = onboarded;
      safeStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    }
    return null;
  }
};

// Practice practice/history mock service
export const MockPracticeService = {
  getSessions(): IELTSPracticeSession[] {
    const raw = safeStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  getSessionById(id: string): IELTSPracticeSession | undefined {
    return this.getSessions().find(s => s.id === id);
  },

  upsertSession(session: IELTSPracticeSession): IELTSPracticeSession {
    const sessions = this.getSessions();
    const index = sessions.findIndex((existing) => existing.id === session.id);
    if (index === -1) {
      sessions.unshift(session);
    } else {
      sessions[index] = session;
    }
    safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    return session;
  },

  saveSessionTurn(sessionId: string, turn: SpeechChunk): void {
    const sessions = this.getSessions();
    const index = sessions.findIndex((session) => session.id === sessionId);
    if (index === -1) throw new Error('Session not found');

    const turnKey = turn.eventId || turn.id;
    const transcript = Array.isArray(sessions[index].transcript) ? [...sessions[index].transcript] : [];
    const existingIndex = transcript.findIndex((item) => (item.eventId || item.id) === turnKey);
    const normalizedTurn = { ...turn, eventId: turnKey };

    if (existingIndex === -1) transcript.push(normalizedTurn);
    else transcript[existingIndex] = normalizedTurn;

    transcript.sort((a, b) => {
      if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
      return a.timestamp - b.timestamp;
    });

    sessions[index].transcript = transcript;
    safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  },

  createSession(topic: string, cueCardId?: string, customSnapshot?: SelectedTestSnapshot, customSessionId?: string): IELTSPracticeSession {
    const seed = `seed-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const snapshot = customSnapshot || generateTestSnapshot(seed, 'full', cueCardId);
    
    const sessions = this.getSessions();
    const newSession: IELTSPracticeSession = {
      id: customSessionId || `session-${generateId()}`,
      userId: 'mock-user-id',
      createdAt: Date.now(),
      status: 'active',
      currentPart: snapshot.mode === 'part3'
        ? IELTSExamPart.PART_3
        : snapshot.mode === 'part2'
          ? IELTSExamPart.PART_2
          : IELTSExamPart.PART_1,
      currentState: ExamState.IDLE,
      topic: snapshot.part2CueCard?.title || topic,
      cueCard: snapshot.part2CueCard ? {
        id: snapshot.part2CueCard.id,
        topic: snapshot.part2CueCard.taskStatement,
        bulletPoints: snapshot.part2CueCard.bulletPrompts,
        followUpQuestions: snapshot.part3Questions ? snapshot.part3Questions.map(q => q.text) : []
      } : undefined,
      selectedTestSnapshot: snapshot,
      transcript: []
    };
    sessions.unshift(newSession);
    safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    return newSession;
  },

  updateSessionState(
    id: string,
    state: ExamState,
    part: IELTSExamPart,
    transcript: SpeechChunk[],
    part2Meta?: any,
    draftNotes?: string
  ): IELTSPracticeSession {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Session not found');

    sessions[idx].currentState = state;
    sessions[idx].currentPart = part;
    sessions[idx].transcript = transcript;
    if (part2Meta) {
      sessions[idx].part2Meta = { ...sessions[idx].part2Meta, ...part2Meta };
    }
    if (draftNotes !== undefined) {
      sessions[idx].draftNotes = draftNotes;
    }
    
    if (state === ExamState.COMPLETE) {
      sessions[idx].status = 'completed';
    } else if (state === ExamState.ABANDONED) {
      sessions[idx].status = 'abandoned';
    } else if (state === ExamState.FAILED) {
      sessions[idx].status = 'failed';
    } else if (state === ExamState.IDLE) {
      sessions[idx].status = 'incomplete';
    } else {
      sessions[idx].status = 'active';
    }

    safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    return sessions[idx];
  },

  saveRecordingMetadata(sessionId: string, recordingMetadata: any): void {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
      sessions[idx].recordingMetadata = recordingMetadata;
      safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  },

  saveProviderMetadata(sessionId: string, providerMetadata: any): void {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
      sessions[idx].providerMetadata = providerMetadata;
      safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  },

  getEvaluations(): Record<string, IELTSEvaluation> {
    const raw = safeStorage.getItem('speakready_evals_mock');
    return raw ? (JSON.parse(raw) as Record<string, IELTSEvaluation>) : {};
  },

  getEvaluationForSession(sessionId: string): IELTSEvaluation | undefined {
    const evals = this.getEvaluations();
    const values = Object.keys(evals).map((key) => evals[key]);
    return values.find((e) => e.sessionId === sessionId);
  },

  // Generates high-quality mock IELTS evaluations deterministically matching GEMINI.md
  generateEvaluation(sessionId: string): IELTSEvaluation {
    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    const evals = this.getEvaluations();
    const existing = Object.keys(evals)
      .map((k) => evals[k])
      .find((e) => e.sessionId === sessionId);
    if (existing) return existing;

    // Generate score based on student's relative length of transcripts (some fun mock calculation)
    const candSpeech = session.transcript.filter(t => t.speaker === 'candidate');
    const wordCount = candSpeech.reduce((sum, chunk) => sum + chunk.text.split(' ').length, 0);

    let baseScore = 6.0;
    if (wordCount > 150) baseScore = 7.5;
    else if (wordCount > 80) baseScore = 7.0;
    else if (wordCount > 30) baseScore = 6.5;

    const finalBandScore = Math.min(9.0, Math.max(4.0, parseFloat((Math.round(baseScore * 2) / 2).toFixed(1))));

    const newEval: IELTSEvaluation = {
      id: `eval-${generateId()}`,
      sessionId,
      userId: 'mock-user-id',
      createdAt: Date.now(),
      estimatedOverallBand: finalBandScore,
      evaluationEngine: 'sandbox',
      rubricVersion: 'demo-only-mock-evaluator',
      qualityWarnings: ['Mock mode is enabled. This is a demo score, not a genuine AI IELTS language assessment.'],
      confidence: 0.25,
      assessmentBasis: 'transcript_only',
      disclaimer: 'Demo evaluation only - simulated local output, not an official IELTS score or a genuine AI assessment.',
      criteria: {
        fluencyAndCoherence: {
          score: Math.min(9.0, finalBandScore + 0.5),
          feedback: 'Exhibited a very good speaking rate with structured flow. Occasional minor pauses detected when formulation of precise abstract points occurred in Part 3, which is typical of higher bands. Transition devices used to structure arguments were logical.',
          examples: [
            'Solid cohesive links: "If I look back at it...", "Specifically regarding this issue..."',
            'Good structural signposting during Part 2.'
          ]
        },
        lexicalResource: {
          score: finalBandScore,
          feedback: 'Excellent topic-specific vocabulary with good use of collocations and descriptive adverbs. Demonstrated flexibility in paraphrasing when direct vocabulary was temporarily out of grasp.',
          improvedPhrases: [
            { original: 'travel to other places', improved: 'explore exotic destinations', explanation: 'Creates a more descriptive, advanced, and evocative image.' },
            { original: 'a good person who helped me', improved: 'an incredibly supportive mentor', explanation: 'Upgrades basic adjectives into strong, natural IELTS Band 7.5+ collocations.' }
          ]
        },
        grammaticalRangeAccuracy: {
          score: Math.max(4.0, finalBandScore - 0.5),
          feedback: 'Employed a wide variety of sentence structures. Minor slips in relative clauses and occasional confusion with conditional verb forms were observed during the long turn, but meaning was never obscured.',
          corrections: [
            { incorrect: 'When I was small, I have played inside.', correct: 'When I was small, I played inside / used to play inside.', ruleExplanation: 'Completed past actions should use the simple past instead of the present perfect.' },
            { incorrect: 'If it will rain, I stay.', correct: 'If it rains, I will stay / If it were to rain, I would stay.', ruleExplanation: 'First and second conditionals need precise auxiliary structure agreements.' }
          ]
        },
        pronunciation: {
          score: 0,
          status: 'not_assessed',
          feedback: 'Pronunciation is not assessed in mock mode because the demo evaluator does not analyze raw audio.',
          problemWords: []
        }
      },
      examinerNote: `DEMO EVALUATION ONLY: this locally generated score is included for interface testing. It is not a genuine IELTS language judgment and should not be used to estimate an official speaking band.`,
      actionPlan: [
        'Practice timed Part 2 topics strictly with cue card prompts. Practice speaking continuously for a full 2 minutes without pauses.',
        'Review past tense and present perfect tense agreements when discussing chronological childhood events.',
        'Record yourself and listen back specifically for vowel lengthening and consonant ending sounds (like -ed endings).'
      ]
    };

    evals[newEval.id] = newEval;
    safeStorage.setItem('speakready_evals_mock', JSON.stringify(evals));

    // Update session with evaluation ID
    const sessions = this.getSessions();
    const sIdx = sessions.findIndex(s => s.id === sessionId);
    if (sIdx !== -1) {
      sessions[sIdx].evaluationId = newEval.id;
      safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }

    return newEval;
  },

  saveEvaluation(evaluation: IELTSEvaluation): void {
    const evals = this.getEvaluations();
    evals[evaluation.id] = evaluation;
    safeStorage.setItem('speakready_evals_mock', JSON.stringify(evals));
  },

  updateSessionEvaluationStatus(sessionId: string, status: any, evaluationId?: string): void {
    const sessions = this.getSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx !== -1) {
      (sessions[idx] as any).evaluationStatus = status;
      if (evaluationId) {
        sessions[idx].evaluationId = evaluationId;
      }
      safeStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  },

  deleteRecordingsForUser(userId: string): number {
    const sessions = this.getSessions();
    let affected = 0;
    const updated = sessions.map((session) => {
      if (session.userId !== userId || !session.recordingMetadata) return session;
      affected += 1;
      const { recordingMetadata: _removed, ...withoutRecording } = session;
      return withoutRecording as IELTSPracticeSession;
    });
    safeStorage.setItem(SESSIONS_KEY, JSON.stringify(updated));
    return affected;
  },

  deleteAllPracticeDataForUser(userId: string): { deletedSessions: number; deletedEvaluations: number } {
    const sessions = this.getSessions();
    const retainedSessions = sessions.filter((session) => session.userId !== userId);
    const deletedSessionIds = new Set(
      sessions.filter((session) => session.userId === userId).map((session) => session.id)
    );

    const evaluations = this.getEvaluations();
    let deletedEvaluations = 0;
    const retainedEvaluations: Record<string, IELTSEvaluation> = {};
    Object.entries(evaluations as Record<string, IELTSEvaluation>).forEach(([id, evaluation]) => {
      if (evaluation.userId === userId || deletedSessionIds.has(evaluation.sessionId)) {
        deletedEvaluations += 1;
      } else {
        retainedEvaluations[id] = evaluation;
      }
    });

    safeStorage.setItem(SESSIONS_KEY, JSON.stringify(retainedSessions));
    safeStorage.setItem('speakready_evals_mock', JSON.stringify(retainedEvaluations));

    return {
      deletedSessions: sessions.length - retainedSessions.length,
      deletedEvaluations,
    };
  }
};
