/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Route Definitions
export type RoutePath =
  | '/'
  | '/login'
  | '/onboarding'
  | '/dashboard'
  | '/practice/setup'
  | '/practice' // generic base
  | '/results'  // generic base
  | '/history'
  | '/billing'
  | '/settings'
  | '/privacy'
  | '/admin'
  | '/admin/billing';

export interface Route {
  path: RoutePath;
  params?: Record<string, string>;
}


// Paid test access / billing
export type TestAccessType = 'credits' | 'unlimited';
export type PaymentProvider = 'development' | 'sslcommerz';

export interface TestEntitlement {
  userId: string;
  creditBalance: number;
  unlimited: boolean;
  unlimitedUntil: number | null;
  totalPurchased: number;
  totalGranted: number;
  totalConsumed: number;
  createdAt: number;
  updatedAt: number;
}

export interface TestPackage {
  id: string;
  name: string;
  description: string;
  accessType: TestAccessType;
  tests: number;
  unlimitedDays: number | null;
  priceBdt: number;
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface BillingSettings {
  signupFreeTests: number;
  currency: 'BDT';
  developmentPaymentsEnabled: boolean;
  activeProvider: PaymentProvider;
  updatedAt: number;
}

export interface PaymentOrder {
  id: string;
  userId: string;
  packageId: string;
  packageSnapshot: {
    name: string;
    accessType: TestAccessType;
    tests: number;
    unlimitedDays: number | null;
    priceBdt: number;
  };
  amountBdt: number;
  currency: 'BDT';
  provider: PaymentProvider;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'review';
  createdAt: number;
  updatedAt: number;
  paidAt?: number;
}

// User Profile
export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  targetBand?: number;
  onboarded: boolean;
  nativeLanguage?: string;
  currentEstimatedBand?: number;
  examDate?: string;
  timezone?: string;
}

// IELTS Exam Parts
export enum IELTSExamPart {
  PART_1 = 'PART_1',
  PART_2 = 'PART_2',
  PART_3 = 'PART_3',
}

// State Machine States
export enum ExamState {
  IDLE = 'IDLE',
  PRECHECK = 'PRECHECK',
  CONNECTING = 'CONNECTING',
  INTRO = 'INTRO',
  PART1_ASKING = 'PART1_ASKING',
  PART1_LISTENING = 'PART1_LISTENING',
  PART1_COMPLETED = 'PART1_COMPLETED',
  PART2_INSTRUCTIONS = 'PART2_INSTRUCTIONS',
  PART2_PREPARATION = 'PART2_PREPARATION',
  PART2_LONG_TURN = 'PART2_LONG_TURN',
  PART2_CLOSING = 'PART2_CLOSING',
  PART2_COMPLETED = 'PART2_COMPLETED',
  PART3_ASKING = 'PART3_ASKING',
  PART3_LISTENING = 'PART3_LISTENING',
  PART3_COMPLETED = 'PART3_COMPLETED',
  FINALIZING = 'FINALIZING',
  EVALUATING = 'EVALUATING',
  COMPLETE = 'COMPLETE',
  RECOVERING = 'RECOVERING',
  ABANDONED = 'ABANDONED',
  FAILED = 'FAILED',
}

// IELTS Cue Card for Part 2
export interface Part2CueCard {
  id: string;
  topic: string;
  bulletPoints: string[];
  followUpQuestions: string[];
}

// Deterministic Test Set Selection Snapshot types
export interface SelectedTestQuestion {
  id: string;
  text: string;
  type?: string;
}

export interface SelectedTestPart1Group {
  id: string;
  title: string;
  questions: SelectedTestQuestion[];
}

export interface SelectedTestPart2Card {
  id: string;
  title: string;
  taskStatement: string;
  bulletPrompts: string[];
  closingQuestion: string;
}

export interface SelectedTestPart3Question {
  id: string;
  text: string;
  type: 'explanation' | 'comparison' | 'causes' | 'effects' | 'future_speculation';
  category?: string;
}

export interface SelectedTestSnapshot {
  seed: string;
  mode: 'full' | 'part1' | 'part2' | 'part3';
  /**
   * Part 1 uses multiple familiar-topic frames in the real test.  Keep
   * `part1Topic` below as the flattened backwards-compatible view used by the
   * deterministic engine, while `part1Topics` preserves topic boundaries for
   * examiner phrasing and natural topic transitions.
   */
  part1Topics?: SelectedTestPart1Group[];
  part1Topic?: SelectedTestPart1Group;
  part2CueCard?: SelectedTestPart2Card;
  part3Questions?: SelectedTestPart3Question[];
}

// Transcribed speech chunk
export interface SpeechChunk {
  id: string;
  timestamp: number;
  speaker: 'examiner' | 'candidate';
  text: string;
  isFinal: boolean;
  sequence?: number;
  eventId?: string;
  startTime?: number;
  endTime?: number;
  interrupted?: boolean;
  questionId?: string;
}

export interface Part2SessionMeta {
  prepStartTime?: number;
  prepEndTime?: number;
  longTurnStartTime?: number;
  longTurnEndTime?: number;
  longTurnDuration?: number;
  interrupted?: boolean;
  interruptionReason?: string;
  notes?: string;
}

export type SessionStatus = 'active' | 'completed' | 'abandoned' | 'incomplete' | 'failed';

export interface RecordingMetadata {
  recordingId: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed' | 'skipped' | 'deleted';
  consentActive: boolean;
  createdAt: number;
  uploadedAt?: number;
  error?: string;
}

export interface ProviderMetadata {
  providerName: string;
  modelAlias: string;
  transport: string;
  sampleRate: number;
}

// Active IELTS Speaking Practice Session
export interface IELTSPracticeSession {
  id: string;
  userId: string;
  createdAt: number;
  status: SessionStatus;
  currentPart: IELTSExamPart;
  currentState: ExamState;
  transcript: SpeechChunk[];
  topic: string;
  cueCard?: Part2CueCard;
  selectedTestSnapshot?: SelectedTestSnapshot;
  part2Meta?: Part2SessionMeta;
  draftNotes?: string;
  evaluationId?: string;
  recordingMetadata?: RecordingMetadata;
  providerMetadata?: ProviderMetadata;
  billingReservationId?: string;
}

// IELTS Detailed Criteria
export interface CriteriaDetails {
  score: number;
  feedback: string;
  examplesOrProblemWords?: string[]; // strings or problem words
}

export interface LexicalResourceDetails {
  score: number;
  feedback: string;
  improvedPhrases: Array<{
    original: string;
    improved: string;
    explanation: string;
  }>;
}

export interface GrammaticalRangeDetails {
  score: number;
  feedback: string;
  corrections: Array<{
    incorrect: string;
    correct: string;
    ruleExplanation: string;
  }>;
}

export type EvaluationStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface PronunciationDetails {
  score: number;
  status?: 'assessed' | 'assumed' | 'not_assessed';
  feedback: string;
  problemWords: string[];
}

export interface IELTSEvaluationCriteria {
  fluencyAndCoherence: {
    score: number;
    feedback: string;
    examples: string[];
  };
  lexicalResource: LexicalResourceDetails;
  grammaticalRangeAccuracy: GrammaticalRangeDetails;
  pronunciation: PronunciationDetails;
}

export interface IELTSPartFeedback {
  part: 'Part 1' | 'Part 2' | 'Part 3';
  summary: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
}

export type EvaluationAssessmentBasis = 'transcript_only' | 'transcript_and_audio';
export type EvaluationEngine = 'gemini' | 'sandbox';

export interface EvaluationEvidenceStats {
  candidateWords: number;
  candidateResponseTurns: number;
  averageWordsPerResponse: number;
  medianWordsPerResponse: number;
  longestResponseWords: number;
  veryShortResponses: number;
  lexicalDiversity: number;
  timedCandidateResponses: number;
  part2LongTurnSeconds?: number;
}

// Combined Evaluation Output (Matches the strict JSON schema from GEMINI.md)
export interface IELTSEvaluation {
  id: string;
  sessionId: string;
  userId: string;
  createdAt: number;
  estimatedOverallBand: number;
  bandRange?: string;
  confidence?: number;
  disclaimer?: string;
  assessmentBasis?: EvaluationAssessmentBasis;
  evaluationEngine?: EvaluationEngine;
  evaluationModel?: string;
  rubricVersion?: string;
  evidenceStats?: EvaluationEvidenceStats;
  qualityWarnings?: string[];
  criteria: IELTSEvaluationCriteria;
  examinerNote: string;
  evidence?: string[];
  strengths?: string[];
  priorities?: string[];
  partFeedback?: IELTSPartFeedback[];
  actionPlan: string[];
  status?: EvaluationStatus;
  error?: string;
}

// Browser Audio Controller States & Interfaces
export interface AudioDeviceState {
  permissionState: 'prompt' | 'granted' | 'denied' | 'unsupported';
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  isMuted: boolean;
  inputLevel: number;
  error: string | null;
}

export interface LocalRecordingState {
  isRecording: boolean;
  isSupported: boolean;
  consentGiven: boolean;
  durationSeconds: number;
  recordingBlob: Blob | null;
  recordingUrl: string | null;
  mimeType: string | null;
}

export interface BrowserAudioControllerOptions {
  sampleRate?: number;
  deviceId?: string;
  userConsentForRecording?: boolean;
  onInputLevelChange?: (level: number) => void;
  onStateChange?: (state: AudioDeviceState) => void;
  onRecordingStateChange?: (state: LocalRecordingState) => void;
  onAudioChunk?: (chunk: Int16Array) => void;
}

