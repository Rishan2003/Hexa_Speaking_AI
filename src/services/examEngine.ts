/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ExamState, SelectedTestSnapshot, SpeechChunk, IELTSExamPart, Part2SessionMeta } from '../types';
import { RealtimeVoiceProvider, RealtimeVoiceConfig } from '../realtime/voiceContract';
import { persistenceQueue } from './persistenceQueue';
import { buildPart1SystemInstruction, buildPart2SystemInstruction, buildPart3SystemInstruction } from './examinerPrompts';

export type ExamEngineEvent =
  | { type: 'START_EXAM'; userId: string; snapshot: SelectedTestSnapshot }
  | { type: 'PRECHECK_COMPLETE' }
  | { type: 'CONNECT' }
  | { type: 'CONNECTION_ESTABLISHED' }
  | { type: 'EXAMINER_SPOKE'; text: string }
  | { type: 'CANDIDATE_SPEECH_START' }
  | { type: 'CANDIDATE_SPOKE'; text: string }
  | { type: 'TIMER_TICK'; prepSecondsDelta?: number; speakingSecondsDelta?: number }
  | { type: 'PREPARATION_COMPLETE' }
  | { type: 'LONG_TURN_COMPLETE' }
  | { type: 'UPDATE_NOTES'; notes: string }
  | { type: 'DISCONNECT' }
  | { type: 'RECOVER'; snapshotString: string }
  | { type: 'ABANDON' }
  | { type: 'FAIL'; error: string }
  | { type: 'START_EVALUATION' }
  | { type: 'EVALUATION_COMPLETE'; evaluationId: string };

export interface ExamEngineContext {
  sessionId: string;
  userId: string;
  createdAt: number;
  mode: 'full' | 'part1' | 'part2' | 'part3';
  currentState: ExamState;
  currentPart: IELTSExamPart;
  snapshot: SelectedTestSnapshot;
  
  // Progress trackers
  currentPart1QuestionIndex: number;
  currentPart3QuestionIndex: number;
  
  // Timers and durations
  prepSecondsLeft: number;
  speakingSecondsElapsed: number;
  
  // Transcripts
  transcript: SpeechChunk[];
  
  // Completed questions tracking
  completedQuestionIds: string[];
  
  // Draft notes for Part 2
  draftNotes: string;
  
  // Part 2 Metadata
  part2Meta: Part2SessionMeta;

  // Recoveries & reconnects
  reconnectAttempts: number;
  preDisconnectState?: ExamState;
  errorMessage?: string;
  evaluationId?: string;
}

// The Part 1 snapshot now carries two topic frames x four questions.  Keeping
// the engine deterministic at eight questions prevents the mock provider from
// ending after only three questions while matching the live examiner prompt.
export const PART1_QUESTION_LIMIT = 8;
export const PART3_QUESTION_LIMIT = 5;

export function createInitialContext(userId: string, snapshot: SelectedTestSnapshot, sessionId?: string): ExamEngineContext {
  return {
    sessionId: sessionId || `session-${Math.random().toString(36).substring(2, 11)}`,
    userId,
    createdAt: Date.now(),
    mode: snapshot.mode,
    currentState: ExamState.IDLE,
    currentPart: snapshot.mode === 'part3' ? IELTSExamPart.PART_3 : (snapshot.mode === 'part2' ? IELTSExamPart.PART_2 : IELTSExamPart.PART_1),
    snapshot,
    currentPart1QuestionIndex: 0,
    currentPart3QuestionIndex: 0,
    prepSecondsLeft: 60,
    speakingSecondsElapsed: 0,
    transcript: [],
    completedQuestionIds: [],
    draftNotes: '',
    part2Meta: {},
    reconnectAttempts: 0,
  };
}

// Function to serialize the context for recovery
export function serializeRecoverySnapshot(context: ExamEngineContext): string {
  return JSON.stringify({
    sessionId: context.sessionId,
    userId: context.userId,
    createdAt: context.createdAt,
    mode: context.mode,
    currentState: context.currentState,
    currentPart: context.currentPart,
    snapshot: context.snapshot,
    currentPart1QuestionIndex: context.currentPart1QuestionIndex,
    currentPart3QuestionIndex: context.currentPart3QuestionIndex,
    prepSecondsLeft: context.prepSecondsLeft,
    speakingSecondsElapsed: context.speakingSecondsElapsed,
    transcript: context.transcript,
    completedQuestionIds: context.completedQuestionIds,
    draftNotes: context.draftNotes,
    part2Meta: context.part2Meta,
    reconnectAttempts: context.reconnectAttempts,
    preDisconnectState: context.preDisconnectState,
    errorMessage: context.errorMessage,
    evaluationId: context.evaluationId
  });
}

export function examEngineReducer(state: ExamEngineContext, event: ExamEngineEvent): ExamEngineContext {
  // If the event is RECOVER, restore state entirely if valid and recalculate timers
  if (event.type === 'RECOVER') {
    try {
      const parsed = JSON.parse(event.snapshotString);
      if (parsed && parsed.sessionId) {
        const restored: ExamEngineContext = { ...parsed };
        const now = Date.now();

        // Calculate prep time remaining if reconnected during preparation
        if (restored.currentState === ExamState.PART2_PREPARATION && restored.part2Meta?.prepStartTime) {
          const elapsed = Math.floor((now - restored.part2Meta.prepStartTime) / 1000);
          const remaining = Math.max(0, 60 - elapsed);
          if (remaining > 0) {
            restored.prepSecondsLeft = remaining;
          } else {
            restored.prepSecondsLeft = 0;
            restored.currentState = ExamState.PART2_LONG_TURN;
            restored.speakingSecondsElapsed = 0;
            restored.part2Meta = {
              ...restored.part2Meta,
              prepEndTime: restored.part2Meta.prepStartTime + 60000
            };
          }
        }

        // Calculate speaking time elapsed if reconnected during long turn
        if (restored.currentState === ExamState.PART2_LONG_TURN && restored.part2Meta?.longTurnStartTime) {
          const elapsed = Math.floor((now - restored.part2Meta.longTurnStartTime) / 1000);
          if (elapsed < 120) {
            restored.speakingSecondsElapsed = elapsed;
          } else {
            restored.speakingSecondsElapsed = 120;
            restored.currentState = ExamState.PART2_CLOSING;
            restored.part2Meta = {
              ...restored.part2Meta,
              longTurnEndTime: restored.part2Meta.longTurnStartTime + 120000,
              longTurnDuration: 120,
              interrupted: true,
              interruptionReason: 'MAX_DURATION_EXCEEDED'
            };
          }
        }

        // Calculate Part 3 completed question count upon reconnection
        if (restored.currentPart === IELTSExamPart.PART_3 || restored.mode === 'part3') {
          const p3QuestionIds = (restored.snapshot.part3Questions || []).map(q => q.id);
          const completedP3Count = restored.completedQuestionIds.filter(id => p3QuestionIds.includes(id)).length;
          restored.currentPart3QuestionIndex = completedP3Count;
          if (restored.currentState === ExamState.PART3_LISTENING) {
            restored.currentState = ExamState.PART3_ASKING;
          }
        }

        return restored;
      }
    } catch (e) {
      console.error('Failed to parse recovery snapshot string', e);
    }
    return state;
  }

  // Handle global events (ABANDON, FAIL, DISCONNECT)
  if (event.type === 'ABANDON') {
    if (state.currentState === ExamState.COMPLETE || state.currentState === ExamState.ABANDONED) {
      return state;
    }
    return {
      ...state,
      currentState: ExamState.ABANDONED
    };
  }

  if (event.type === 'FAIL') {
    if (state.currentState === ExamState.COMPLETE || state.currentState === ExamState.FAILED) {
      return state;
    }
    return {
      ...state,
      currentState: ExamState.FAILED,
      errorMessage: event.error
    };
  }

  if (event.type === 'DISCONNECT') {
    if (
      state.currentState === ExamState.IDLE ||
      state.currentState === ExamState.PRECHECK ||
      state.currentState === ExamState.CONNECTING ||
      state.currentState === ExamState.RECOVERING ||
      state.currentState === ExamState.COMPLETE ||
      state.currentState === ExamState.ABANDONED ||
      state.currentState === ExamState.FAILED ||
      state.currentState === ExamState.EVALUATING
    ) {
      return state;
    }
    // Transition to RECOVERING and save previous state
    return {
      ...state,
      preDisconnectState: state.currentState,
      currentState: ExamState.RECOVERING
    };
  }

  // Handle specific state transitions
  switch (state.currentState) {
    case ExamState.IDLE:
      if (event.type === 'START_EXAM') {
        return {
          ...state,
          userId: event.userId,
          snapshot: event.snapshot,
          mode: event.snapshot.mode,
          currentState: ExamState.PRECHECK,
          currentPart: event.snapshot.mode === 'part3' ? IELTSExamPart.PART_3 : (event.snapshot.mode === 'part2' ? IELTSExamPart.PART_2 : IELTSExamPart.PART_1)
        };
      }
      break;

    case ExamState.PRECHECK:
      if (event.type === 'PRECHECK_COMPLETE') {
        return {
          ...state,
          currentState: ExamState.CONNECTING
        };
      }
      break;

    case ExamState.CONNECTING:
      if (event.type === 'CONNECTION_ESTABLISHED') {
        return {
          ...state,
          currentState: ExamState.INTRO
        };
      }
      break;

    case ExamState.INTRO:
      if (event.type === 'EXAMINER_SPOKE') {
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-intro-${now}`,
          eventId: `evt-intro-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'examiner',
          text: event.text,
          isFinal: true
        };
        const nextState = state.mode === 'part3' ? ExamState.PART3_ASKING : (state.mode === 'part2' ? ExamState.PART2_INSTRUCTIONS : ExamState.PART1_ASKING);
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          currentState: nextState
        };
      }
      break;

    case ExamState.PART1_ASKING:
      if (event.type === 'CANDIDATE_SPEECH_START') {
        return {
          ...state,
          currentState: ExamState.PART1_LISTENING
        };
      }
      if (event.type === 'CANDIDATE_SPOKE') {
        const now = Date.now();
        const qId = state.snapshot.part1Topic?.questions[state.currentPart1QuestionIndex]?.id || `p1-q-${state.currentPart1QuestionIndex}`;
        const chunk: SpeechChunk = {
          id: `chunk-cand-p1-${now}`,
          eventId: `evt-cand-p1-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'candidate',
          text: event.text,
          isFinal: true,
          questionId: qId
        };
        const newCompleted = [...state.completedQuestionIds];
        if (!newCompleted.includes(qId)) {
          newCompleted.push(qId);
        }
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          completedQuestionIds: newCompleted,
          currentPart1QuestionIndex: state.currentPart1QuestionIndex + 1,
          currentState: ExamState.PART1_COMPLETED
        };
      }
      break;

    case ExamState.PART1_LISTENING:
      if (event.type === 'CANDIDATE_SPOKE') {
        const now = Date.now();
        const qId = state.snapshot.part1Topic?.questions[state.currentPart1QuestionIndex]?.id || `p1-q-${state.currentPart1QuestionIndex}`;
        const chunk: SpeechChunk = {
          id: `chunk-cand-p1-${now}`,
          eventId: `evt-cand-p1-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'candidate',
          text: event.text,
          isFinal: true,
          questionId: qId
        };
        const newCompleted = [...state.completedQuestionIds];
        if (!newCompleted.includes(qId)) {
          newCompleted.push(qId);
        }
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          completedQuestionIds: newCompleted,
          currentPart1QuestionIndex: state.currentPart1QuestionIndex + 1,
          currentState: ExamState.PART1_COMPLETED
        };
      }
      break;

    case ExamState.PART1_COMPLETED:
      if (event.type === 'EXAMINER_SPOKE') {
        const now = Date.now();
        const qId = state.snapshot.part1Topic?.questions[state.currentPart1QuestionIndex]?.id;
        const chunk: SpeechChunk = {
          id: `chunk-ex-p1-next-${now}`,
          eventId: `evt-ex-p1-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'examiner',
          text: event.text,
          isFinal: true,
          questionId: qId
        };
        const transcriptsWithChunk = [...state.transcript, chunk];
        if (state.currentPart1QuestionIndex < PART1_QUESTION_LIMIT && state.snapshot.part1Topic?.questions[state.currentPart1QuestionIndex]) {
          return {
            ...state,
            transcript: transcriptsWithChunk,
            currentState: ExamState.PART1_ASKING
          };
        } else {
          if (state.mode === 'full') {
            return {
              ...state,
              transcript: transcriptsWithChunk,
              currentState: ExamState.PART2_INSTRUCTIONS,
              currentPart: IELTSExamPart.PART_2
            };
          } else {
            return {
              ...state,
              transcript: transcriptsWithChunk,
              currentState: ExamState.FINALIZING
            };
          }
        }
      }
      break;

    case ExamState.PART2_INSTRUCTIONS:
      if (event.type === 'EXAMINER_SPOKE') {
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-ex-p2-inst-${now}`,
          eventId: `evt-ex-p2-inst-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'examiner',
          text: event.text,
          isFinal: true
        };
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          currentState: ExamState.PART2_PREPARATION,
          prepSecondsLeft: 60,
          part2Meta: {
            ...state.part2Meta,
            prepStartTime: now
          }
        };
      }
      break;

    case ExamState.PART2_PREPARATION:
      if (event.type === 'UPDATE_NOTES') {
        return {
          ...state,
          draftNotes: event.notes,
          part2Meta: {
            ...state.part2Meta,
            notes: event.notes
          }
        };
      }
      if (event.type === 'TIMER_TICK') {
        const delta = event.prepSecondsDelta ?? 1;
        const remaining = Math.max(0, state.prepSecondsLeft - delta);
        const now = Date.now();
        if (remaining <= 0) {
          return {
            ...state,
            prepSecondsLeft: 0,
            currentState: ExamState.PART2_LONG_TURN,
            speakingSecondsElapsed: 0,
            part2Meta: {
              ...state.part2Meta,
              prepEndTime: now
            }
          };
        }
        return {
          ...state,
          prepSecondsLeft: remaining
        };
      }
      if (event.type === 'PREPARATION_COMPLETE') {
        const now = Date.now();
        return {
          ...state,
          prepSecondsLeft: 0,
          currentState: ExamState.PART2_LONG_TURN,
          speakingSecondsElapsed: 0,
          part2Meta: {
            ...state.part2Meta,
            prepEndTime: now
          }
        };
      }
      break;

    case ExamState.PART2_LONG_TURN:
      if (event.type === 'UPDATE_NOTES') {
        return {
          ...state,
          draftNotes: event.notes,
          part2Meta: {
            ...state.part2Meta,
            notes: event.notes
          }
        };
      }
      if (event.type === 'CANDIDATE_SPEECH_START') {
        const now = Date.now();
        if (!state.part2Meta?.longTurnStartTime) {
          return {
            ...state,
            part2Meta: {
              ...state.part2Meta,
              longTurnStartTime: now
            }
          };
        }
        return state;
      }
      if (event.type === 'TIMER_TICK') {
        const delta = event.speakingSecondsDelta ?? 1;
        const elapsed = state.speakingSecondsElapsed + delta;
        const now = Date.now();
        const longTurnStart = state.part2Meta?.longTurnStartTime || (now - elapsed * 1000);

        if (elapsed >= 120) {
          return {
            ...state,
            speakingSecondsElapsed: 120,
            currentState: ExamState.PART2_CLOSING,
            part2Meta: {
              ...state.part2Meta,
              longTurnStartTime: longTurnStart,
              longTurnEndTime: now,
              longTurnDuration: 120,
              interrupted: true,
              interruptionReason: 'MAX_DURATION_EXCEEDED'
            }
          };
        }
        return {
          ...state,
          speakingSecondsElapsed: elapsed,
          part2Meta: {
            ...state.part2Meta,
            longTurnStartTime: longTurnStart
          }
        };
      }
      if (event.type === 'LONG_TURN_COMPLETE') {
        const now = Date.now();
        return {
          ...state,
          currentState: ExamState.PART2_CLOSING,
          part2Meta: {
            ...state.part2Meta,
            longTurnEndTime: now,
            longTurnDuration: state.speakingSecondsElapsed
          }
        };
      }
      if (event.type === 'CANDIDATE_SPOKE') {
        const now = Date.now();
        const longTurnStart = state.part2Meta?.longTurnStartTime || now;
        const chunk: SpeechChunk = {
          id: `chunk-cand-p2-${now}`,
          eventId: `evt-cand-p2-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'candidate',
          text: event.text,
          isFinal: true
        };
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          part2Meta: {
            ...state.part2Meta,
            longTurnStartTime: longTurnStart
          }
        };
      }
      break;

    case ExamState.PART2_CLOSING:
      if (event.type === 'EXAMINER_SPOKE') {
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-ex-p2-close-${now}`,
          eventId: `evt-ex-p2-close-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'examiner',
          text: event.text,
          isFinal: true
        };
        return {
          ...state,
          transcript: [...state.transcript, chunk]
        };
      }
      if (event.type === 'CANDIDATE_SPOKE') {
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-cand-p2-close-${now}`,
          eventId: `evt-cand-p2-close-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'candidate',
          text: event.text,
          isFinal: true
        };
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          currentState: ExamState.PART2_COMPLETED
        };
      }
      break;

    case ExamState.PART2_COMPLETED:
      if (event.type === 'EXAMINER_SPOKE') {
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-ex-p2-next-${now}`,
          eventId: `evt-ex-p2-next-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'examiner',
          text: event.text,
          isFinal: true
        };
        const nextState = state.mode === 'full' ? ExamState.PART3_ASKING : ExamState.FINALIZING;
        const nextPart = state.mode === 'full' ? IELTSExamPart.PART_3 : state.currentPart;
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          currentState: nextState,
          currentPart: nextPart
        };
      }
      break;

    case ExamState.PART3_ASKING:
      if (event.type === 'EXAMINER_SPOKE') {
        const qId = state.snapshot.part3Questions?.[state.currentPart3QuestionIndex]?.id;
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-ex-p3-${now}`,
          eventId: `evt-ex-p3-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'examiner',
          text: event.text,
          isFinal: true,
          questionId: qId
        };
        return {
          ...state,
          transcript: [...state.transcript, chunk]
        };
      }
      if (event.type === 'CANDIDATE_SPEECH_START') {
        return {
          ...state,
          currentState: ExamState.PART3_LISTENING
        };
      }
      if (event.type === 'CANDIDATE_SPOKE') {
        const qId = state.snapshot.part3Questions?.[state.currentPart3QuestionIndex]?.id || `p3-q-${state.currentPart3QuestionIndex}`;
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-cand-p3-${now}`,
          eventId: `evt-cand-p3-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'candidate',
          text: event.text,
          isFinal: true,
          questionId: qId
        };
        const newCompleted = [...state.completedQuestionIds];
        if (!newCompleted.includes(qId)) {
          newCompleted.push(qId);
        }
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          completedQuestionIds: newCompleted,
          currentPart3QuestionIndex: state.currentPart3QuestionIndex + 1,
          currentState: ExamState.PART3_COMPLETED
        };
      }
      break;

    case ExamState.PART3_LISTENING:
      if (event.type === 'CANDIDATE_SPOKE') {
        const qId = state.snapshot.part3Questions?.[state.currentPart3QuestionIndex]?.id || `p3-q-${state.currentPart3QuestionIndex}`;
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-cand-p3-${now}`,
          eventId: `evt-cand-p3-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'candidate',
          text: event.text,
          isFinal: true,
          questionId: qId
        };
        const newCompleted = [...state.completedQuestionIds];
        if (!newCompleted.includes(qId)) {
          newCompleted.push(qId);
        }
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          completedQuestionIds: newCompleted,
          currentPart3QuestionIndex: state.currentPart3QuestionIndex + 1,
          currentState: ExamState.PART3_COMPLETED
        };
      }
      break;

    case ExamState.PART3_COMPLETED:
      if (event.type === 'EXAMINER_SPOKE') {
        const qId = state.snapshot.part3Questions?.[state.currentPart3QuestionIndex]?.id;
        const now = Date.now();
        const chunk: SpeechChunk = {
          id: `chunk-ex-p3-next-${now}`,
          eventId: `evt-ex-p3-${now}`,
          sequence: state.transcript.length + 1,
          timestamp: now,
          startTime: now,
          endTime: now,
          speaker: 'examiner',
          text: event.text,
          isFinal: true,
          questionId: qId
        };
        const transcriptsWithChunk = [...state.transcript, chunk];
        if (state.currentPart3QuestionIndex < PART3_QUESTION_LIMIT && state.snapshot.part3Questions?.[state.currentPart3QuestionIndex]) {
          return {
            ...state,
            transcript: transcriptsWithChunk,
            currentState: ExamState.PART3_ASKING
          };
        } else {
          return {
            ...state,
            transcript: transcriptsWithChunk,
            currentState: ExamState.FINALIZING
          };
        }
      }
      break;

    case ExamState.FINALIZING:
      if (event.type === 'EXAMINER_SPOKE') {
        const chunk: SpeechChunk = {
          id: `chunk-ex-final-${Date.now()}`,
          timestamp: Date.now(),
          speaker: 'examiner',
          text: event.text,
          isFinal: true
        };
        return {
          ...state,
          transcript: [...state.transcript, chunk],
          currentState: ExamState.EVALUATING
        };
      }
      break;

    case ExamState.EVALUATING:
      if (event.type === 'EVALUATION_COMPLETE') {
        return {
          ...state,
          currentState: ExamState.COMPLETE,
          evaluationId: event.evaluationId
        };
      }
      break;

    case ExamState.RECOVERING:
      if (event.type === 'CONNECTION_ESTABLISHED') {
        return {
          ...state,
          currentState: state.preDisconnectState || ExamState.CONNECTING,
          reconnectAttempts: state.reconnectAttempts + 1,
          preDisconnectState: undefined
        };
      }
      break;

    default:
      break;
  }

  // Reject invalid transition or duplicate event safely by returning the unchanged state
  return state;
}

export class MockRealtimeProvider implements RealtimeVoiceProvider {
  private config: RealtimeVoiceConfig | null = null;
  private status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private context: ExamEngineContext;
  private timeoutId: NodeJS.Timeout | null = null;
  private onContextChangeCallback?: (context: ExamEngineContext) => void;

  constructor(
    userId: string,
    snapshot: SelectedTestSnapshot,
    sessionId?: string,
    onContextChange?: (context: ExamEngineContext) => void
  ) {
    this.context = createInitialContext(userId, snapshot, sessionId);
    this.onContextChangeCallback = onContextChange;
  }

  abandon(): void {
    this.dispatch({ type: 'ABANDON' });
    this.disconnect();
  }

  getContext(): ExamEngineContext {
    return this.context;
  }

  setContext(context: ExamEngineContext) {
    this.context = context;
  }

 async initialize(config: RealtimeVoiceConfig): Promise<void> {
    // Build the same part-specific examiner instruction used by the live provider.
    // The deterministic mock engine does not ask an LLM to interpret this prompt,
    // but keeping the correct prompt in the provider config makes diagnostics and
    // behavior parity accurate for Part 1, Part 2, Part 3, and Full Mock startup.
    const examinerPrompt = this.context.currentPart === IELTSExamPart.PART_3
      ? buildPart3SystemInstruction(this.context.snapshot)
      : this.context.currentPart === IELTSExamPart.PART_2
        ? buildPart2SystemInstruction(this.context.snapshot)
        : buildPart1SystemInstruction(this.context.snapshot);

    this.config = {
      ...config,
      systemInstruction: examinerPrompt
    };

    this.status = 'connecting';
    this.config.onStatusChange(this.status);

    // Move from IDLE -> PRECHECK -> CONNECTING, then complete the simulated
    // connection and start the examiner exactly as a real provider would.
    this.dispatch({ type: 'START_EXAM', userId: this.context.userId, snapshot: this.context.snapshot });

    await new Promise<void>((resolve) => {
      this.timeoutId = setTimeout(() => {
        this.dispatch({ type: 'PRECHECK_COMPLETE' });
        this.status = 'connected';
        this.config?.onStatusChange(this.status);
        this.dispatch({ type: 'CONNECTION_ESTABLISHED' });
        this.triggerExaminerWelcome();
        resolve();
      }, 300);
    });
}

  sendAudio(chunk: Int16Array): void {
    // No-op for mock provider
  }

  sendTextMessage(text: string): void {
    if (!this.config || this.status !== 'connected') return;

    // Echo back the candidate speech
    this.config.onTranscript('candidate', text, true);

    // If we are in ASKING states, transition candidate speech status
    if (this.context.currentState === ExamState.PART1_ASKING) {
      this.dispatch({ type: 'CANDIDATE_SPEECH_START' });
    } else if (this.context.currentState === ExamState.PART3_ASKING) {
      this.dispatch({ type: 'CANDIDATE_SPEECH_START' });
    }

    // Now dispatch candidate speech completed
    this.dispatch({ type: 'CANDIDATE_SPOKE', text });

    // Trigger next examiner action
    this.scheduleNextExaminerStep();
  }

  // Allow updating notes for Part 2
  updateNotes(notes: string): void {
    this.dispatch({ type: 'UPDATE_NOTES', notes });
  }

  // Allow ticking timer explicitly from the UI/test
  tickTimer(prepDelta?: number, speakingDelta?: number) {
    const wasPrep = this.context.currentState === ExamState.PART2_PREPARATION;
    const wasLongTurn = this.context.currentState === ExamState.PART2_LONG_TURN;

    this.dispatch({ type: 'TIMER_TICK', prepSecondsDelta: prepDelta, speakingSecondsDelta: speakingDelta });
    
    // Check if prep ended
    if (wasPrep && this.context.currentState === ExamState.PART2_LONG_TURN) {
      this.scheduleNextExaminerStep();
    }
    
    // Check if speaking duration exceeded 2 minutes
    if (wasLongTurn && this.context.currentState === ExamState.PART2_CLOSING) {
      this.scheduleNextExaminerStep();
    }
  }

  forcePart2PrepFinish() {
    this.dispatch({ type: 'PREPARATION_COMPLETE' });
    this.scheduleNextExaminerStep();
  }

  forcePart2SpeechFinish() {
    this.dispatch({ type: 'LONG_TURN_COMPLETE' });
    this.scheduleNextExaminerStep();
  }

  async disconnect(): Promise<void> {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.status = 'disconnected';
    if (this.config) {
      this.config.onStatusChange(this.status);
    }
  }

  private dispatch(event: ExamEngineEvent) {
    const prevTranscriptLen = this.context.transcript.length;
    const nextContext = examEngineReducer(this.context, event);
    this.context = nextContext;
    
    if (this.onContextChangeCallback) {
      this.onContextChangeCallback(this.context);
    }

    // Save newly appended turn to persistence queue
    if (nextContext.transcript.length > prevTranscriptLen) {
      const latestTurn = nextContext.transcript[nextContext.transcript.length - 1];
      const partId = this.context.currentPart === IELTSExamPart.PART_3 ? 'part-3' : (this.context.currentPart === IELTSExamPart.PART_2 ? 'part-2' : 'part-1');
      persistenceQueue.saveTurn(this.context.sessionId, partId, latestTurn);
    }
    
    // Save session state to persistence queue
    persistenceQueue.updateSessionState(
      this.context.sessionId,
      this.context.currentState,
      this.context.currentPart,
      this.context.transcript,
      this.context.part2Meta,
      this.context.draftNotes
    );
    
    // Save to recovery snapshot so it can be restored
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('speakready_recovery_snapshot', serializeRecoverySnapshot(this.context));
    }
  }

  private triggerExaminerWelcome() {
    if (this.context.mode === 'part2' || this.context.currentPart === IELTSExamPart.PART_2) {
      this.context = {
        ...this.context,
        currentState: ExamState.PART2_INSTRUCTIONS,
        currentPart: IELTSExamPart.PART_2,
      };
      this.onContextChangeCallback?.(this.context);
      this.scheduleNextExaminerStep();
      return;
    }

    if (this.context.mode === 'part3' || this.context.currentPart === IELTSExamPart.PART_3) {
      this.context = {
        ...this.context,
        currentState: ExamState.PART3_ASKING,
        currentPart: IELTSExamPart.PART_3,
      };
      this.onContextChangeCallback?.(this.context);
      this.scheduleNextExaminerStep();
      return;
    }

    const welcomeText = "Good day. Welcome to this IELTS Speaking practice session. Could you tell me your full name to get started?";
    this.config?.onTranscript('examiner', welcomeText, true);
    this.dispatch({ type: 'EXAMINER_SPOKE', text: welcomeText });

    // Now speak the first question
    this.scheduleNextExaminerStep();
  }

  private scheduleNextExaminerStep() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    
    this.timeoutId = setTimeout(() => {
      this.executeExaminerStep();
    }, 600);
  }

  private executeExaminerStep() {
    if (!this.config || this.status !== 'connected') return;

    const state = this.context.currentState;

    if (state === ExamState.PART1_ASKING || state === ExamState.PART1_COMPLETED) {
      const idx = this.context.currentPart1QuestionIndex;
      if (idx < PART1_QUESTION_LIMIT && this.context.snapshot.part1Topic?.questions[idx]) {
        const qText = this.context.snapshot.part1Topic.questions[idx].text;
        this.config.onTranscript('examiner', qText, true);
        this.dispatch({ type: 'EXAMINER_SPOKE', text: qText });
      } else {
        // Conclude Part 1
        const text = "Thank you. That concludes Part 1. We will now proceed to Part 2 of the test.";
        this.config.onTranscript('examiner', text, true);
        this.dispatch({ type: 'EXAMINER_SPOKE', text });
        
        // Immediately trigger instruction display in part 2 if full mode
        if (this.context.mode === 'full') {
          this.context.currentState = ExamState.PART2_INSTRUCTIONS;
          this.context.currentPart = IELTSExamPart.PART_2;
          this.scheduleNextExaminerStep();
        }
      }
    } else if (state === ExamState.PART2_INSTRUCTIONS) {
      const cueCard = this.context.snapshot.part2CueCard;
      const text = `I am going to give you a topic and I'd like you to speak about it for 1 to 2 minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish. Here is your topic: ${cueCard?.title || 'Describe a place you visited'}.`;
      this.config.onTranscript('examiner', text, true);
      this.dispatch({ type: 'EXAMINER_SPOKE', text });
    } else if (state === ExamState.PART2_LONG_TURN && this.context.speakingSecondsElapsed === 0) {
      const text = "Alright, your preparation time is up. Remember, you have 1 to 2 minutes for this topic, so don't worry if I stop you. Please begin speaking now.";
      this.config.onTranscript('examiner', text, true);
    } else if (state === ExamState.PART2_CLOSING) {
      const cueCard = this.context.snapshot.part2CueCard;
      const closingQuestion = cueCard?.closingQuestion || "Would you like to visit that place again in the future?";
      this.config.onTranscript('examiner', closingQuestion, true);
      this.dispatch({ type: 'EXAMINER_SPOKE', text: closingQuestion });
    } else if (state === ExamState.PART2_COMPLETED) {
      const text = "Thank you. That concludes Part 2 of the test.";
      this.config.onTranscript('examiner', text, true);
      this.dispatch({ type: 'EXAMINER_SPOKE', text });
      
      if (this.context.mode === 'full') {
        this.scheduleNextExaminerStep();
      }
    } else if (state === ExamState.PART3_ASKING || state === ExamState.PART3_COMPLETED) {
      const idx = this.context.currentPart3QuestionIndex;
      const questions = this.context.snapshot.part3Questions;
      if (questions && idx < PART3_QUESTION_LIMIT && questions[idx]) {
        let qText = questions[idx].text;
        if (idx === 0) {
          const cueTitle = this.context.snapshot.part2CueCard?.title || 'the topic';
          qText = `We have been talking about ${cueTitle}, and I'd now like to discuss with you one or two more general questions related to this topic. ${questions[0].text}`;
        }
        this.config.onTranscript('examiner', qText, true);
        this.dispatch({ type: 'EXAMINER_SPOKE', text: qText });
      } else {
        // Conclude Part 3
        const text = "Thank you very much. That concludes the IELTS Speaking test.";
        this.config.onTranscript('examiner', text, true);
        this.dispatch({ type: 'EXAMINER_SPOKE', text });
      }
    } else if (state === ExamState.FINALIZING) {
      const text = "Thank you very much. That concludes the IELTS Speaking test. I will now finalize and evaluate your performance. Please wait a moment.";
      this.config.onTranscript('examiner', text, true);
      this.dispatch({ type: 'EXAMINER_SPOKE', text });
    }
  }
}
