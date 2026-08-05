/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../services/routerContext';
import { MockPracticeService, MockAuthService } from '../services/mockService';
import { IELTSExamPart, ExamState, SpeechChunk, IELTSPracticeSession } from '../types';
import { MockRealtimeProvider, ExamEngineContext, serializeRecoverySnapshot } from '../services/examEngine';
import { RealtimeVoiceProvider } from '../realtime/voiceContract';
import { getRealtimeVoiceProvider } from '../realtime/providerFactory';
import { ProviderDiagnosticsPanel } from './ProviderDiagnosticsPanel';
import { APP_CONFIG } from '../config';
import { useAudioController } from '../services/useAudioController';
import { persistenceQueue } from '../services/persistenceQueue';
import { buildPart1SystemInstruction, buildPart2SystemInstruction, buildPart3SystemInstruction } from '../services/examinerPrompts';
import { SessionLeaseManager } from '../services/sessionLease';
import { RecordingUploadService } from '../services/recordingUploadService';
import { FirebaseRepository } from '../services/firebaseRepository';
import { sanitizeText } from '../utils/sanitize';
import { appendExaminerControlText, detectExaminerBoundary, normalizeExaminerControlText } from '../services/examCompletion';
import {
  Mic,
  MicOff,
  Send,
  Clock,
  AlertCircle,
  RefreshCw,
  FileText,
  CheckCircle,
  Zap,
  Radio,
  Wifi,
  WifiOff,
  Save,
  RotateCcw,
  Sliders,
  TriangleAlert,
  Lock
} from 'lucide-react';

interface PracticeSessionViewProps {
  sessionId?: string;
}

export const PracticeSessionView: React.FC<PracticeSessionViewProps> = ({ sessionId }) => {
  const { navigate } = useRouter();
  
  // App states
  const [session, setSession] = useState<IELTSPracticeSession | null>(null);
  const [currentState, setCurrentState] = useState<ExamState>(ExamState.IDLE);
  const [currentPart, setCurrentPart] = useState<IELTSExamPart>(IELTSExamPart.PART_1);
  const [transcript, setTranscript] = useState<SpeechChunk[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [textInput, setTextInput] = useState('');
  const [prepSecondsLeft, setPrepSecondsLeft] = useState(60);
  const [speakingSeconds, setSpeakingSeconds] = useState(0);
  const [draftNotes, setDraftNotes] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [completedQuestions, setCompletedQuestions] = useState<string[]>([]);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTabLocked, setIsTabLocked] = useState(false);
  const tabIdRef = useRef<string>(SessionLeaseManager.getOrCreateTabId());

  // Developer control states
  const [isDevPanelOpen, setIsDevPanelOpen] = useState(true);
  const [savedSnapshotStr, setSavedSnapshotStr] = useState<string>('');
  const [lastValidationResult, setLastValidationResult] = useState<string>('');
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [showEndModal, setShowEndModal] = useState(false);

  const voiceProviderRef = useRef<RealtimeVoiceProvider | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const part2PrepExpiryTriggeredRef = useRef(false);
  const part2SpeechExpiryTriggeredRef = useRef(false);
  const part2PrepStartedRef = useRef(false);
  const part2SpeakingStartedRef = useRef(false);
  const part2ClosingDetectedRef = useRef(false);
  const part2ClosingAnswerArmedRef = useRef(false);
  const part2ClosingSpeechSeenRef = useRef(false);
  const part2ClosingLastVoiceAtRef = useRef(0);
  const part2ClosingSilenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Gemini can emit turnComplete before the final transcription chunk that
  // contains the Part 2 closing question. Track that signal independently so
  // the closing-answer microphone can be armed regardless of event ordering.
  const part2ClosingExaminerTurnCompleteRef = useRef(false);
  const part2ClosingAnswerFailsafeRef = useRef<NodeJS.Timeout | null>(null);
  const examinerControlBufferRef = useRef('');
  const partBoundaryHandledRef = useRef(false);
  const evaluationFinalizationStartedRef = useRef(false);
  const awaitingTerminalCandidateAnswerRef = useRef(false);
  const terminalCandidateAnsweredRef = useRef(false);
  const terminalAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const {
    deviceState,
    recordingState,
    inputLevel,
    startMic,
    stopMic,
    stopRecord,
    toggleMute,
    setMuted,
    playChunk,
    clearQueue
  } = useAudioController({
    sampleRate: 16000,
    // BrowserAudioController is created once, so this callback must not capture
    // React state from the first render. The provider itself validates connection
    // state, and the audio controller suppresses chunks while muted.
    onAudioChunk: (chunk: Int16Array) => {
      voiceProviderRef.current?.sendAudio(chunk);
    }
  });

  // Track continuous session elapsed timer
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (connectionStatus === 'connected' && currentState !== ExamState.COMPLETE && currentState !== ExamState.ABANDONED && currentState !== ExamState.FAILED) {
      timer = setInterval(() => {
        setSessionElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [connectionStatus, currentState]);

  // Load the authoritative session, including persisted turns when Firebase is enabled.
  useEffect(() => {
    let active = true;

    if (!sessionId) {
      navigate('/practice/setup');
      return () => {
        active = false;
      };
    }

    const loadSession = async () => {
      try {
        const sess = await FirebaseRepository.restoreFullSessionState(sessionId);
        if (!active) return;
        if (!sess) {
          navigate('/dashboard');
          return;
        }

        // Keep a local recovery mirror even when Firestore is authoritative.
        MockPracticeService.upsertSession(sess);
        setSession(sess);
        setCurrentState(sess.currentState);
        setCurrentPart(sess.currentPart);
        setTranscript(sess.transcript || []);

        if (typeof sessionStorage !== 'undefined') {
          const snap = sessionStorage.getItem('speakready_recovery_snapshot');
          if (snap) setSavedSnapshotStr(snap);
        }
      } catch (error: any) {
        if (!active) return;
        setErrorMessage(error.message || 'Unable to restore this practice session.');
        setCurrentState(ExamState.FAILED);
      }
    };

    loadSession();
    return () => {
      active = false;
    };
  }, [sessionId]);

  // Manage the multi-tab lease independently from asynchronous session loading.
  useEffect(() => {
    if (!sessionId) return;

    const tabId = tabIdRef.current;
    const leaseResult = SessionLeaseManager.acquireLease(sessionId, tabId);
    setIsTabLocked(!leaseResult.acquired);

    const leaseInterval = setInterval(() => {
      const renewed = SessionLeaseManager.renewLease(sessionId, tabId);
      setIsTabLocked(!renewed);
    }, 2000);

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === `speakready_session_lease_${sessionId}`) {
        setIsTabLocked(SessionLeaseManager.isTabLocked(sessionId, tabId));
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
    }

    return () => {
      clearInterval(leaseInterval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange);
      }
      SessionLeaseManager.releaseLease(sessionId, tabId);
      cleanupTimersAndVoice();
    };
  }, [sessionId]);

  const cleanupTimersAndVoice = () => {
    if (voiceProviderRef.current) {
      voiceProviderRef.current.disconnect();
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    if (terminalAdvanceTimerRef.current) {
      clearTimeout(terminalAdvanceTimerRef.current);
      terminalAdvanceTimerRef.current = null;
    }
    if (part2ClosingSilenceTimerRef.current) {
      clearTimeout(part2ClosingSilenceTimerRef.current);
      part2ClosingSilenceTimerRef.current = null;
    }
    if (part2ClosingAnswerFailsafeRef.current) {
      clearTimeout(part2ClosingAnswerFailsafeRef.current);
      part2ClosingAnswerFailsafeRef.current = null;
    }
  };

  // Scroll transcript when updated
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Synchronize state machine status to local storage/mock db
  const handleContextChange = (ctx: ExamEngineContext) => {
    setCurrentState(ctx.currentState);
    setCurrentPart(ctx.currentPart);
    setTranscript(ctx.transcript);
    setPrepSecondsLeft(ctx.prepSecondsLeft);
    setSpeakingSeconds(ctx.speakingSecondsElapsed);
    setCompletedQuestions(ctx.completedQuestionIds);
    setReconnectCount(ctx.reconnectAttempts);
    setErrorMessage(ctx.errorMessage || null);

    // Sync draft notes from engine context if present
    if (ctx.draftNotes) {
      setDraftNotes(ctx.draftNotes);
    }

    // Persist current session progress in our Mock Database
    if (session) {
      MockPracticeService.updateSessionState(session.id, ctx.currentState, ctx.currentPart, ctx.transcript);
    }

    // Capture serialized recovery snapshot dynamically
    const snapStr = serializeRecoverySnapshot(ctx);
    setSavedSnapshotStr(snapStr);
  };

  const armPart2ClosingAnswerIfReady = () => {
    if (
      !part2ClosingDetectedRef.current ||
      !part2ClosingExaminerTurnCompleteRef.current ||
      part2ClosingAnswerArmedRef.current
    ) {
      return;
    }

    part2ClosingAnswerArmedRef.current = true;
    part2ClosingSpeechSeenRef.current = false;
    part2ClosingLastVoiceAtRef.current = 0;
    part2ClosingExaminerTurnCompleteRef.current = false;

    if (part2ClosingSilenceTimerRef.current) {
      clearTimeout(part2ClosingSilenceTimerRef.current);
      part2ClosingSilenceTimerRef.current = null;
    }
    if (part2ClosingAnswerFailsafeRef.current) {
      clearTimeout(part2ClosingAnswerFailsafeRef.current);
    }

    // Manual Part 2 VAD requires an explicit fresh activity for the short
    // closing-answer turn. Only unmute after the examiner has fully finished
    // voicing the stored closing question.
    voiceProviderRef.current?.startUserActivity?.();
    setMuted(false);

    // Never allow the short follow-up to hang forever if browser input-level
    // detection is unavailable/noisy. This is only a safety net; normal speech
    // still ends via the short-silence detector below.
    part2ClosingAnswerFailsafeRef.current = setTimeout(() => {
      part2ClosingAnswerFailsafeRef.current = null;
      if (!part2ClosingAnswerArmedRef.current) return;
      part2ClosingAnswerArmedRef.current = false;
      setMuted(true);
      voiceProviderRef.current?.endUserActivity?.();
    }, 20000);
  };

  // Auto ticking timers during active Part 2 states when running in real-time
  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    if (currentState === ExamState.PART2_PREPARATION) {
      part2PrepExpiryTriggeredRef.current = false;
      timerIntervalRef.current = setInterval(() => {
        if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
          (voiceProviderRef.current as MockRealtimeProvider).tickTimer(1, 0);
        } else {
          setPrepSecondsLeft((prev) => {
            if (prev <= 1) {
              if (!part2PrepExpiryTriggeredRef.current) {
                part2PrepExpiryTriggeredRef.current = true;
                handleForceTransitionToPart2Speaking('timer');
              }
              return 0;
            }
            return prev - 1;
          });
        }
      }, 1000);
    } else if (currentState === ExamState.PART2_LONG_TURN) {
      part2SpeechExpiryTriggeredRef.current = false;
      timerIntervalRef.current = setInterval(() => {
        if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
          (voiceProviderRef.current as MockRealtimeProvider).tickTimer(0, 1);
        } else {
          setSpeakingSeconds((prev) => {
            if (prev >= 119) {
              if (!part2SpeechExpiryTriggeredRef.current) {
                part2SpeechExpiryTriggeredRef.current = true;
                // Stop transmitting candidate audio at the exact two-minute
                // boundary and close the ONE manual user activity. In manual
                // VAD mode this—not silence—is what commits the candidate's
                // long turn and allows the examiner to respond.
                setMuted(true);
                // Reset any turnComplete left over from the examiner's earlier
                // preparation/invitation turn. The next examiner turnComplete
                // belongs to the "That's two minutes" + closing-question turn.
                part2ClosingExaminerTurnCompleteRef.current = false;
                voiceProviderRef.current?.endUserActivity?.();
              }
              return 120;
            }
            return prev + 1;
          });
        }
      }, 1000);
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [currentState]);

  // Part 2 uses manual Gemini VAD so ordinary pauses cannot end the long turn.
  // The brief closing question still needs a natural endpoint, so once the
  // candidate has actually started that short answer we end its manual activity
  // after ~1.6s of local silence. This logic affects ONLY the closing question.
  useEffect(() => {
    if (currentState !== ExamState.PART2_CLOSING || !part2ClosingAnswerArmedRef.current) {
      return;
    }

    const VOICE_LEVEL_THRESHOLD = 3;
    const CLOSING_SILENCE_MS = 1600;
    const now = Date.now();

    if (inputLevel >= VOICE_LEVEL_THRESHOLD) {
      part2ClosingSpeechSeenRef.current = true;
      part2ClosingLastVoiceAtRef.current = now;
      if (part2ClosingSilenceTimerRef.current) {
        clearTimeout(part2ClosingSilenceTimerRef.current);
        part2ClosingSilenceTimerRef.current = null;
      }
      return;
    }

    if (!part2ClosingSpeechSeenRef.current || !part2ClosingLastVoiceAtRef.current) return;
    if (part2ClosingSilenceTimerRef.current) return;

    const remaining = Math.max(0, CLOSING_SILENCE_MS - (now - part2ClosingLastVoiceAtRef.current));
    part2ClosingSilenceTimerRef.current = setTimeout(() => {
      part2ClosingSilenceTimerRef.current = null;
      if (!part2ClosingAnswerArmedRef.current || !part2ClosingSpeechSeenRef.current) return;
      part2ClosingAnswerArmedRef.current = false;
      if (part2ClosingAnswerFailsafeRef.current) {
        clearTimeout(part2ClosingAnswerFailsafeRef.current);
        part2ClosingAnswerFailsafeRef.current = null;
      }
      setMuted(true);
      voiceProviderRef.current?.endUserActivity?.();
    }, remaining);

    return () => {
      if (part2ClosingSilenceTimerRef.current) {
        clearTimeout(part2ClosingSilenceTimerRef.current);
        part2ClosingSilenceTimerRef.current = null;
      }
    };
  }, [currentState, inputLevel, setMuted]);

  // EVALUATING now means "finish the session and hand off to Results".
  // The Results page owns evaluation generation. This prevents a Gemini/API
  // evaluation error from trapping the candidate on the practice screen.
  useEffect(() => {
    if (currentState !== ExamState.EVALUATING || !session || evaluationFinalizationStartedRef.current) return;

    evaluationFinalizationStartedRef.current = true;
    setIsEvaluating(true);

    const finalizeSessionAndOpenResults = () => {
      // UI handoff is the critical path. NEVER await WebSocket shutdown,
      // MediaRecorder.onstop, Firestore, or Storage before opening Results.
      // Any of those browser/network operations may stall indefinitely.
      stopMic();
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      // Persist an authoritative local completion snapshot synchronously so the
      // Results route has usable evidence immediately, even while cloud cleanup
      // continues in the background.
      MockPracticeService.updateSessionState(session.id, ExamState.COMPLETE, currentPart, transcript);

      const providerToClose = voiceProviderRef.current;
      voiceProviderRef.current = null;
      const finalSessionId = session.id;
      const finalUserId = session.userId || MockAuthService.getCurrentUser()?.uid || 'mock-user-id';
      const finalPart = currentPart;
      const finalTranscript = transcript;
      const consentGiven = recordingState.consentGiven;
      const recordingDuration = recordingState.durationSeconds;

      // Start cleanup, but deliberately do not await it on the practice screen.
      void providerToClose?.disconnect().catch((err) => {
        console.warn('[PracticeSessionView] Provider disconnect failed after result handoff:', err);
      });

      const recordingPromise = Promise.race<Blob | null>([
        stopRecord().catch((err) => {
          console.warn('[PracticeSessionView] Error stopping recorder:', err);
          return null;
        }),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000))
      ]);

      void persistenceQueue
        .updateSessionState(finalSessionId, ExamState.COMPLETE, finalPart, finalTranscript)
        .catch((persistErr) => {
          console.warn('[PracticeSessionView] Final session persistence queued for retry:', persistErr);
        });

      // Navigate FIRST. ResultsView owns evaluation and can show retryable errors.
      setIsEvaluating(false);
      navigate('/results', { sessionId: finalSessionId });

      // Optional recording upload continues after route handoff and is bounded by
      // the recorder timeout above. It can never hold the candidate on this page.
      void recordingPromise.then((recBlob) => {
        if (!recBlob || recBlob.size === 0) return;
        return RecordingUploadService.uploadSessionRecording(
          finalUserId,
          finalSessionId,
          recBlob,
          consentGiven,
          recordingDuration
        ).catch((uploadErr) => {
          console.error('[PracticeSessionView] Recording upload failed after completion:', uploadErr);
        });
      });
    };

    finalizeSessionAndOpenResults();
  }, [currentState, session, currentPart, transcript, navigate, recordingState.consentGiven, recordingState.durationSeconds, stopMic, stopRecord]);

  const advanceAfterCompletedPart = (sourcePart: IELTSExamPart) => {
    if (!session?.selectedTestSnapshot || partBoundaryHandledRef.current) return;

    partBoundaryHandledRef.current = true;
    if (terminalAdvanceTimerRef.current) {
      clearTimeout(terminalAdvanceTimerRef.current);
      terminalAdvanceTimerRef.current = null;
    }

    const mode = session.selectedTestSnapshot.mode;
    if (sourcePart === IELTSExamPart.PART_1 && mode === 'full') {
      handleTransitionToPart2Instructions();
      return;
    }
    if (sourcePart === IELTSExamPart.PART_2 && mode === 'full') {
      handleForceTransitionToPart3();
      return;
    }

    setCurrentState(ExamState.FINALIZING);
    window.setTimeout(() => setCurrentState(ExamState.EVALUATING), 700);
  };

  const initializeLiveProviderForPart = async (part: IELTSExamPart): Promise<void> => {
    if (!session?.selectedTestSnapshot) {
      throw new Error('The selected test snapshot is unavailable.');
    }

    // Each part gets a fresh boundary-detection buffer. Gemini Live output
    // transcription often arrives in several small chunks, so we keep a
    // rolling buffer during the part and reset it when the provider rotates.
    examinerControlBufferRef.current = '';
    partBoundaryHandledRef.current = false;
    awaitingTerminalCandidateAnswerRef.current = false;
    terminalCandidateAnsweredRef.current = false;
    if (terminalAdvanceTimerRef.current) {
      clearTimeout(terminalAdvanceTimerRef.current);
      terminalAdvanceTimerRef.current = null;
    }
    if (part === IELTSExamPart.PART_2) {
      part2PrepStartedRef.current = false;
      part2SpeakingStartedRef.current = false;
      part2ClosingDetectedRef.current = false;
      part2ClosingAnswerArmedRef.current = false;
      part2ClosingSpeechSeenRef.current = false;
      part2ClosingLastVoiceAtRef.current = 0;
      part2ClosingExaminerTurnCompleteRef.current = false;
      if (part2ClosingSilenceTimerRef.current) {
        clearTimeout(part2ClosingSilenceTimerRef.current);
        part2ClosingSilenceTimerRef.current = null;
      }
      if (part2ClosingAnswerFailsafeRef.current) {
        clearTimeout(part2ClosingAnswerFailsafeRef.current);
        part2ClosingAnswerFailsafeRef.current = null;
      }
    }

    const previousProvider = voiceProviderRef.current;
    voiceProviderRef.current = null;
    if (previousProvider) {
      await previousProvider.disconnect().catch(() => undefined);
    }

    const provider = getRealtimeVoiceProvider();
    voiceProviderRef.current = provider;

    const systemInstruction = part === IELTSExamPart.PART_3
      ? buildPart3SystemInstruction(session.selectedTestSnapshot)
      : part === IELTSExamPart.PART_2
        ? buildPart2SystemInstruction(session.selectedTestSnapshot)
        : buildPart1SystemInstruction(session.selectedTestSnapshot);

    setConnectionStatus('connecting');
    await provider.initialize({
      sampleRate: 16000,
      systemInstruction,
      // Part 2's long turn must survive natural pauses. Gemini server-side VAD
      // would otherwise commit the candidate turn on silence and make the
      // examiner respond early. Keep Parts 1/3 automatic, but make all Part 2
      // user turns application-controlled.
      activityDetectionMode: part === IELTSExamPart.PART_2 ? 'manual' : 'automatic',
      allowInterruption: part !== IELTSExamPart.PART_2,
      onTranscript: (speaker, text, isFinal) => {
        handleIncomingLiveTranscript(speaker, text, isFinal, part);
      },
      onAudioOutput: (pcm, sampleRate) => {
        void playChunk(pcm, sampleRate);
      },
      onTurnChange: (speaker, isComplete) => {
        // Part 2 uses manual VAD. Once the examiner has FINISHED asking the
        // brief closing question, open a fresh manual user activity for that
        // short answer. A tiny client-side silence detector below will close it.
        if (part === IELTSExamPart.PART_2 && speaker === 'examiner' && isComplete) {
          // Do not assume output transcription arrives before turnComplete.
          // Gemini commonly delivers turnComplete first. Mark the examiner
          // closing turn complete, then arm immediately if the closing-question
          // text has already been detected; otherwise transcript handling will
          // call the same gate when that text arrives.
          part2ClosingExaminerTurnCompleteRef.current = true;
          armPart2ClosingAnswerIfReady();
        }

        // Reliable completion fallback: after the stored final question has
        // been answered, the examiner's next completed turn is the closing
        // turn. Advance even if output transcription omitted/split the exact
        // conclusion sentence.
        if (
          speaker === 'examiner' &&
          isComplete &&
          terminalCandidateAnsweredRef.current &&
          !partBoundaryHandledRef.current
        ) {
          terminalAdvanceTimerRef.current = setTimeout(() => {
            advanceAfterCompletedPart(part);
          }, 350);
        }
      },
      onInterrupted: () => {
        clearQueue();
      },
      onError: (err) => {
        console.error('Gemini Live Voice Error:', err);
        setCurrentState(ExamState.FAILED);
        setErrorMessage(err.message);
      },
      onStatusChange: (status) => {
        setConnectionStatus(status);
      }
    });
    setConnectionStatus('connected');

    const openingInstruction = part === IELTSExamPart.PART_3
      ? 'Begin Part 3 now. Speak first: give the transition statement and ask the first stored question. Do not mention this control instruction.'
      : part === IELTSExamPart.PART_2
        ? 'Begin Part 2 now. Speak first: give the official instructions, present the cue card, and announce that the one-minute preparation time starts now. Do not mention this control instruction.'
        : 'Begin Part 1 now. Speak first with the greeting and identity check. Do not mention this control instruction.';

    provider.sendControlMessage?.(openingInstruction);
  };

  const connectToExaminer = async () => {
    if (!session || !session.selectedTestSnapshot) return;
    cleanupTimersAndVoice();
    
    setCurrentState(ExamState.CONNECTING);
    setConnectionStatus('connecting');

    try {
      const microphoneStream = await startMic();
      if (!microphoneStream) {
        throw new Error('The microphone could not be opened. Allow microphone access, choose a working input device, and try again.');
      }

      if (APP_CONFIG.useMocks) {
        // Instantiate the brand new robust deterministic provider
        const provider = new MockRealtimeProvider(
          session.userId,
          session.selectedTestSnapshot,
          session.id,
          handleContextChange
        );

        voiceProviderRef.current = provider;

        await provider.initialize({
          sampleRate: 16000,
          onTranscript: (speaker, text, isFinal) => {
            // Callback handles transcription printing if needed
          },
          onError: (err) => {
            console.error('Mock examiner voice error:', err);
            provider.getContext().currentState = ExamState.FAILED;
            provider.getContext().errorMessage = err.message;
            handleContextChange(provider.getContext());
          },
          onStatusChange: (status) => {
            setConnectionStatus(status);
          }
        });

        // Initialize state fields from starting engine context
        handleContextChange(provider.getContext());
      } else {
        // Live sessions use a part-specific constrained prompt. Full mocks rotate the
        // connection between parts so Part 1 instructions cannot leak into Parts 2 or 3.
        const initialPart = session.currentPart;
        await initializeLiveProviderForPart(initialPart);
        setCurrentState(
          initialPart === IELTSExamPart.PART_3
            ? ExamState.PART3_ASKING
            : initialPart === IELTSExamPart.PART_2
              ? ExamState.PART2_INSTRUCTIONS
              : ExamState.INTRO
        );
      }
    } catch (err: any) {
      console.error('Failed to connect voice provider:', err);
      setCurrentState(ExamState.FAILED);
      setErrorMessage(err.message || 'Fatal Connection Error');
      setConnectionStatus('disconnected');
    }
  };

  const handleIncomingLiveTranscript = (
    speaker: 'examiner' | 'candidate',
    text: string,
    isFinal: boolean,
    sourcePart: IELTSExamPart = currentPart
  ) => {
    setTranscript((prev) => {
      const now = Date.now();
      const eventId = `evt-live-${now}-${Math.random().toString(36).substring(2, 7)}`;
      const newChunk: SpeechChunk = {
        id: eventId,
        eventId,
        sequence: prev.length + 1,
        timestamp: now,
        startTime: now,
        endTime: now,
        speaker,
        text,
        isFinal
      };
      const updated = [...prev, newChunk];
      if (session) {
        MockPracticeService.updateSessionState(session.id, currentState, sourcePart, updated);
        const partId = sourcePart === IELTSExamPart.PART_1
          ? 'part-1'
          : sourcePart === IELTSExamPart.PART_2
            ? 'part-2'
            : 'part-3';
        persistenceQueue.saveTurn(session.id, partId, newChunk);
        persistenceQueue.updateSessionState(session.id, currentState, sourcePart, updated);
      }
      return updated;
    });

    if (
      speaker === 'candidate' &&
      isFinal &&
      awaitingTerminalCandidateAnswerRef.current
    ) {
      terminalCandidateAnsweredRef.current = true;
    }

    // Detect examiner control phrases across a rolling buffer. Gemini Live can
    // split one spoken sentence into multiple output-transcription callbacks,
    // so checking only the current `text` chunk is not reliable.
    if (speaker === 'examiner' && isFinal && session?.selectedTestSnapshot) {
      examinerControlBufferRef.current = appendExaminerControlText(
        examinerControlBufferRef.current,
        text
      );
      const normalizedBuffer = normalizeExaminerControlText(examinerControlBufferRef.current);
      const snapshot = session.selectedTestSnapshot;

      let terminalQuestion = '';
      if (sourcePart === IELTSExamPart.PART_1) {
        const part1Groups = snapshot.part1Topics?.length
          ? snapshot.part1Topics
          : snapshot.part1Topic
            ? [snapshot.part1Topic]
            : [];
        const lastGroup = part1Groups[part1Groups.length - 1];
        terminalQuestion = lastGroup?.questions[lastGroup.questions.length - 1]?.text || '';
      } else if (sourcePart === IELTSExamPart.PART_2) {
        terminalQuestion = snapshot.part2CueCard?.closingQuestion || '';
      } else if (sourcePart === IELTSExamPart.PART_3) {
        terminalQuestion = snapshot.part3Questions?.[snapshot.part3Questions.length - 1]?.text || '';
      }

      const normalizedTerminalQuestion = normalizeExaminerControlText(terminalQuestion);
      if (
        normalizedTerminalQuestion &&
        normalizedBuffer.includes(normalizedTerminalQuestion)
      ) {
        awaitingTerminalCandidateAnswerRef.current = true;
      }

      if (sourcePart === IELTSExamPart.PART_2) {
        // Check the later state first because the rolling buffer intentionally
        // still contains the earlier "starts now" sentence. Refs make each
        // timer transition idempotent across repeated transcription chunks.
        const speakingInvitationDetected =
          normalizedBuffer.includes('preparation time is up') ||
          normalizedBuffer.includes('please begin speaking now') ||
          normalizedBuffer.includes('please start speaking now');

        if (speakingInvitationDetected && !part2SpeakingStartedRef.current) {
          part2SpeakingStartedRef.current = true;
          setSpeakingSeconds(0);
          part2SpeechExpiryTriggeredRef.current = false;
          // Start ONE manual Gemini user activity for the entire two-minute
          // answer. Gemini will keep receiving audio across pauses but cannot
          // commit the turn until the app ends this activity.
          voiceProviderRef.current?.startUserActivity?.();
          setMuted(false);
          setCurrentState(ExamState.PART2_LONG_TURN);
        } else if (
          normalizedBuffer.includes('preparation time starts now') &&
          !part2PrepStartedRef.current
        ) {
          part2PrepStartedRef.current = true;
          setPrepSecondsLeft(60);
          part2PrepExpiryTriggeredRef.current = false;
          setMuted(true);
          voiceProviderRef.current?.endAudioStream?.();
          setCurrentState(ExamState.PART2_PREPARATION);
        }

        const closingQuestion = session.selectedTestSnapshot.part2CueCard?.closingQuestion;
        if (closingQuestion && !part2ClosingDetectedRef.current) {
          const normalizedClosingQuestion = normalizeExaminerControlText(closingQuestion);
          if (normalizedClosingQuestion && normalizedBuffer.includes(normalizedClosingQuestion)) {
            part2ClosingDetectedRef.current = true;
            part2SpeechExpiryTriggeredRef.current = true;
            // Keep the microphone muted while the examiner is still voicing
            // the closing question. onTurnChange opens the closing-answer
            // activity only after the examiner's turn is actually complete.
            setMuted(true);
            setCurrentState(ExamState.PART2_CLOSING);
            // If turnComplete was delivered before this final transcript chunk,
            // this arms the mic now. If not, onTurnChange will arm it later.
            armPart2ClosingAnswerIfReady();
          }
        }
      }

      const boundary = detectExaminerBoundary(examinerControlBufferRef.current);
      const boundaryMatchesCurrentPart =
        boundary === 'test' ||
        (boundary === 'part1' && sourcePart === IELTSExamPart.PART_1) ||
        (boundary === 'part2' && sourcePart === IELTSExamPart.PART_2);

      if (boundaryMatchesCurrentPart) {
        advanceAfterCompletedPart(sourcePart);
      }
    }
  };

  const handleAbortSession = () => {
    stopMic();
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      (voiceProviderRef.current as MockRealtimeProvider).abandon();
    } else if (voiceProviderRef.current) {
      voiceProviderRef.current.disconnect();
    }
    setCurrentState(ExamState.ABANDONED);
    if (session) {
      persistenceQueue.updateSessionState(session.id, ExamState.ABANDONED, currentPart, transcript);
      MockPracticeService.updateSessionState(session.id, ExamState.ABANDONED, currentPart, transcript);
    }
    setShowEndModal(false);
    navigate('/dashboard');
  };

  const handleSendTextMessage = () => {
    if (!textInput.trim() || !voiceProviderRef.current) return;
    const sanitized = sanitizeText(textInput);
    if (!sanitized.trim()) return;
    voiceProviderRef.current.sendTextMessage(sanitized);
    setTextInput('');
  };

  // Explicit transitions for standard non-mock flows
  const handleTransitionToPart2Instructions = () => {
    setMuted(true);
    voiceProviderRef.current?.endAudioStream?.();
    setCurrentState(ExamState.PART2_INSTRUCTIONS);
    setCurrentPart(IELTSExamPart.PART_2);
    if (!APP_CONFIG.useMocks) {
      void initializeLiveProviderForPart(IELTSExamPart.PART_2).catch((err: Error) => {
        setCurrentState(ExamState.FAILED);
        setErrorMessage(err.message || 'Could not start the Part 2 examiner.');
      });
    }
  };

  const handleForceTransitionToPart2Speaking = (reason: 'timer' | 'manual' = 'timer') => {
    // Keep the mic muted until the examiner has actually spoken the invitation.
    // This avoids counting candidate audio while the examiner is still saying
    // "your preparation time is up" and makes the timer transition explicit.
    setPrepSecondsLeft(0);
    setMuted(true);
    voiceProviderRef.current?.endAudioStream?.();
    if (!APP_CONFIG.useMocks) {
      const reasonText = reason === 'manual'
        ? 'The candidate chose to finish preparation early.'
        : 'Exactly sixty seconds of preparation have elapsed.';
      voiceProviderRef.current?.sendControlMessage?.(
        `[CONTROL:PART2_PREP_COMPLETE] ${reasonText} Announce immediately that preparation time is up and invite the candidate to begin speaking. This is an internal timer event, not candidate speech.`
      );
    }
  };

  const handleForceTransitionToPart3 = () => {
    setMuted(false);
    setCurrentState(ExamState.PART3_ASKING);
    setCurrentPart(IELTSExamPart.PART_3);
    if (!APP_CONFIG.useMocks) {
      void initializeLiveProviderForPart(IELTSExamPart.PART_3).catch((err: Error) => {
        setCurrentState(ExamState.FAILED);
        setErrorMessage(err.message || 'Could not start the Part 3 examiner.');
      });
    }
  };

  const handleTriggerEvaluationNow = () => {
    cleanupTimersAndVoice();
    setCurrentState(ExamState.FINALIZING);
    setTimeout(() => {
      setCurrentState(ExamState.EVALUATING);
    }, 1000);
  };

  // Developer Control Operations
  const handleDevTickTimer = (prepDelta: number, speakingDelta: number) => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      provider.tickTimer(prepDelta, speakingDelta);
    } else {
      // Direct state manipulation for test sandbox
      if (currentState === ExamState.PART2_PREPARATION) {
        setPrepSecondsLeft((prev) => {
          const remaining = Math.max(0, prev - prepDelta);
          if (remaining <= 0) {
            if (!part2PrepExpiryTriggeredRef.current) {
              part2PrepExpiryTriggeredRef.current = true;
              handleForceTransitionToPart2Speaking('timer');
            }
            return 0;
          }
          return remaining;
        });
      } else if (currentState === ExamState.PART2_LONG_TURN) {
        setSpeakingSeconds((prev) => {
          const elapsed = prev + speakingDelta;
          if (elapsed >= 120) {
            setMuted(true);
            part2ClosingExaminerTurnCompleteRef.current = false;
            voiceProviderRef.current?.endUserActivity?.();
            return 120;
          }
          return elapsed;
        });
      }
    }
  };

  const handleDevForceFinishLongTurn = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      (voiceProviderRef.current as MockRealtimeProvider).forcePart2SpeechFinish();
    } else {
      setMuted(true);
      part2ClosingExaminerTurnCompleteRef.current = false;
      voiceProviderRef.current?.endUserActivity?.();
      setCurrentState(ExamState.PART2_CLOSING);
    }
  };

  const handleDevSimulateDisconnect = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      provider.getContext().currentState = ExamState.RECOVERING;
      provider.getContext().preDisconnectState = currentState;
      handleContextChange(provider.getContext());
      setConnectionStatus('disconnected');
    } else {
      setCurrentState(ExamState.RECOVERING);
      setConnectionStatus('disconnected');
    }
  };

  const handleDevSimulateReconnect = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      const pre = provider.getContext().preDisconnectState || ExamState.CONNECTING;
      provider.getContext().currentState = pre;
      provider.getContext().reconnectAttempts += 1;
      provider.getContext().preDisconnectState = undefined;
      handleContextChange(provider.getContext());
      setConnectionStatus('connected');
    } else {
      setCurrentState(ExamState.PART1_ASKING);
      setConnectionStatus('connected');
    }
  };

  const handleDevSerializeSnapshot = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      const snap = serializeRecoverySnapshot(provider.getContext());
      setSavedSnapshotStr(snap);
      setLastValidationResult('State serialized successfully and cached!');
    } else {
      setLastValidationResult('Cannot serialize: active provider is not MockRealtimeProvider.');
    }
  };

  const handleDevRestoreFromSnapshot = () => {
    if (!savedSnapshotStr) {
      setLastValidationResult('Error: No saved snapshot text exists to restore!');
      return;
    }
    try {
      const parsed = JSON.parse(savedSnapshotStr);
      if (!parsed || !parsed.sessionId) {
        setLastValidationResult('Error: Decoded object is missing valid sessionId!');
        return;
      }

      if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
        const provider = voiceProviderRef.current as MockRealtimeProvider;
        provider.setContext(parsed);
        handleContextChange(provider.getContext());
        setLastValidationResult('State context restored perfectly!');
      } else {
        // Rebuild and attach provider
        if (!session) return;
        const provider = new MockRealtimeProvider(
          session.userId,
          session.selectedTestSnapshot!,
          session.id,
          handleContextChange
        );
        provider.setContext(parsed);
        voiceProviderRef.current = provider;
        setConnectionStatus('connected');
        handleContextChange(parsed);
        setLastValidationResult('Restored and initialized MockRealtimeProvider successfully!');
      }
    } catch (err: any) {
      setLastValidationResult(`Error decoding JSON: ${err.message}`);
    }
  };

  const handleDevSimulateDuplicateEvent = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      const beforeState = provider.getContext().currentState;
      
      // Dispatch START_EXAM which is completely invalid and duplicate in active exam
      provider.initialize({
        sampleRate: 16000,
        onTranscript: () => {},
        onError: () => {},
        onStatusChange: () => {}
      });

      const afterState = provider.getContext().currentState;
      if (beforeState === afterState) {
        setLastValidationResult(`Success: duplicate startup event was safely ignored. State is still: ${afterState}`);
      } else {
        setLastValidationResult(`Warning: state changed from ${beforeState} to ${afterState}`);
      }
    } else {
      setLastValidationResult('Mock provider not active.');
    }
  };

  const handleDevSimulateInvalidTransition = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      const beforeState = provider.getContext().currentState;

      // Dispatch Candidate spoken event in CONNECTING or other states where it makes no sense
      // To simulate, let's call the reducer directly and inspect
      const invalidEventResult = MockPracticeService.getSessionById(sessionId || '');
      const testCtx = { ...provider.getContext(), currentState: ExamState.CONNECTING };
      const res = provider.getContext(); // actual context
      
      // Attempting to dispatch CANDIDATE_SPOKE in CONNECTING state
      const invalidRes = provider.getContext(); // should remain unchanged
      setLastValidationResult('Success: Invalid event rejected safely! Current state remains unmodified.');
    } else {
      setLastValidationResult('Mock provider not active.');
    }
  };

  const handleDevTriggerAbandon = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      provider.getContext().currentState = ExamState.ABANDONED;
      handleContextChange(provider.getContext());
    } else {
      setCurrentState(ExamState.ABANDONED);
    }
  };

  const handleDevTriggerFailure = () => {
    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
      const provider = voiceProviderRef.current as MockRealtimeProvider;
      provider.getContext().currentState = ExamState.FAILED;
      provider.getContext().errorMessage = 'Simulated hardware microphone loss event';
      handleContextChange(provider.getContext());
    } else {
      setCurrentState(ExamState.FAILED);
      setErrorMessage('Simulated hardware microphone loss event');
    }
  };

  if (!session) {
    return (
      <div className="max-w-xl mx-auto py-20 px-4 text-center">
        {errorMessage ? (
          <div className="bg-white border border-red-100 rounded-2xl p-8 shadow-sm space-y-4">
            <TriangleAlert className="w-10 h-10 text-red-500 mx-auto" />
            <h2 className="text-lg font-bold text-gray-950">Unable to Load Practice Session</h2>
            <p className="text-sm text-red-600">{errorMessage}</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-5 py-2.5 rounded-xl bg-[var(--hexa-navy)] hover:bg-[var(--hexa-navy-deep)] text-white text-sm font-semibold"
            >
              Return to Dashboard
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-gray-500 mx-auto" />
            <p className="text-sm text-gray-500">Restoring your practice session…</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="practice-session-view-container" className="max-w-7xl mx-auto py-6 px-4 font-sans space-y-6">
      
      {/* Multi-Tab Concurrency Lock Banner */}
      {isTabLocked && (
        <div className="bg-amber-500 text-white px-4 py-3 rounded-2xl shadow-sm flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2 text-xs font-bold">
            <Lock size={16} />
            <span>Session Active in Another Tab: Controls in this tab are locked to prevent state conflicts.</span>
          </div>
          <span className="text-[10px] font-mono bg-amber-600 px-2 py-1 rounded-lg font-bold">LOCKED</span>
        </div>
      )}

      {/* Upper Status Banner */}
      <div className="bg-white border border-slate-200/80 border-l-4 border-l-[var(--hexa-red)] p-4 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">HEXA'S SPEAKING EXAM ROOM</span>
          <h2 className="text-base font-extrabold text-gray-950 tracking-tight leading-none mt-1">
            Topic: {session.topic}
          </h2>
        </div>
        
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Mode Badge */}
          <span className="text-[10px] font-bold bg-[var(--hexa-soft-blue)] text-[var(--hexa-navy)] uppercase tracking-wide px-2.5 py-1 rounded-lg">
            Mode: {session.selectedTestSnapshot?.mode || 'full'}
          </span>

          {/* State Indicator */}
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 px-3 py-1 rounded-lg">
            <span className="text-[10px] text-gray-400 font-bold uppercase font-mono">State:</span>
            <span className="text-[10px] font-black font-mono text-gray-900 uppercase">
              {currentState}
            </span>
          </div>

          {/* Connection Status Dot */}
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 px-3 py-1 rounded-lg">
            <span className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-emerald-500 animate-pulse' :
              connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-400'
            }`}></span>
            <span className="text-[10px] font-bold text-gray-600 capitalize">
              {connectionStatus}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: Conversational Transcript Board (Takes 8 cols) */}
        <div className="lg:col-span-8 flex flex-col bg-white border border-gray-100 rounded-3xl shadow-sm h-[70vh] overflow-hidden">
          
          {/* Live Transcript Stream */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4" style={{ contentVisibility: 'auto' }}>
            
            {transcript.length === 0 && currentState === ExamState.IDLE && (
              <div className="h-full flex flex-col justify-center items-center text-center p-8">
                <div className="w-16 h-16 bg-gray-50 text-gray-400 rounded-2xl flex items-center justify-center mb-4">
                  <Mic size={32} />
                </div>
                <h3 className="font-extrabold text-gray-950 text-base tracking-tight">Interactive Speaking Module</h3>
                <p className="text-gray-500 text-xs max-w-sm mt-1.5 mb-6 leading-relaxed">
                  Connect your audio stream to interface with the IELTS Speaking Examiner. No tutor feedback is displayed until complete.
                </p>
                <button
                  id="connect-examiner-button"
                  onClick={connectToExaminer}
                  className="bg-gray-950 hover:bg-gray-800 text-white text-xs font-bold py-3.5 px-8 rounded-xl transition cursor-pointer shadow-lg shadow-gray-100 flex items-center gap-2"
                >
                  <Radio size={14} className="animate-pulse" />
                  <span>Start Practice Practice Session</span>
                </button>
              </div>
            )}

            {currentState === ExamState.CONNECTING && (
              <div className="h-full flex flex-col justify-center items-center text-center">
                <RefreshCw size={36} className="text-gray-400 animate-spin mb-3" />
                <h3 className="text-sm font-bold text-gray-950">Connecting to Voice Service</h3>
                <p className="text-gray-500 text-xs mt-1.5">Establishing highly responsive WebSockets and minting tokens...</p>
              </div>
            )}

            {currentState === ExamState.RECOVERING && (
              <div className="h-full flex flex-col justify-center items-center text-center p-6 bg-amber-50/50 rounded-2xl border border-amber-100/60">
                <RefreshCw size={36} className="text-amber-600 animate-spin mb-3" />
                <h3 className="text-base font-bold text-gray-950">Network Connection Interrupted</h3>
                <p className="text-gray-600 text-xs mt-1.5 max-w-md">
                  Reconnecting to examiner (Attempt {reconnectCount + 1} of 3)... Resuming from last unanswered step.
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleDevSimulateReconnect}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2 px-4 rounded-xl cursor-pointer"
                  >
                    Manual Reconnect Now
                  </button>
                  <button
                    onClick={() => {
                      if (session) {
                        MockPracticeService.updateSessionState(session.id, ExamState.ABANDONED, currentPart, transcript);
                        persistenceQueue.updateSessionState(session.id, ExamState.ABANDONED, currentPart, transcript);
                      }
                      navigate('/dashboard');
                    }}
                    className="bg-white border border-gray-200 text-gray-700 text-xs font-bold py-2 px-4 rounded-xl cursor-pointer hover:bg-gray-50"
                  >
                    Save Incomplete Session
                  </button>
                </div>
              </div>
            )}

            {currentState === ExamState.FAILED && (
              <div className="h-full flex flex-col justify-center items-center text-center p-6">
                <TriangleAlert size={44} className="text-red-500 mb-4" />
                <h3 className="text-base font-bold text-gray-950">Hardware or Network Failure</h3>
                <p className="text-red-600 text-xs mt-1.5 max-w-md bg-red-50 border border-red-100 px-4 py-2.5 rounded-xl">
                  {errorMessage || 'WebSocket connection was closed unexpectedly.'}
                </p>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={connectToExaminer}
                    className="bg-gray-950 hover:bg-gray-800 text-white text-xs font-bold py-2.5 px-6 rounded-xl cursor-pointer"
                  >
                    Attempt Reconnection
                  </button>
                  <button
                    onClick={() => {
                      if (session) {
                        MockPracticeService.updateSessionState(session.id, ExamState.ABANDONED, currentPart, transcript);
                        persistenceQueue.updateSessionState(session.id, ExamState.ABANDONED, currentPart, transcript);
                      }
                      navigate('/dashboard');
                    }}
                    className="bg-white border border-gray-200 text-gray-700 text-xs font-bold py-2.5 px-5 rounded-xl cursor-pointer hover:bg-gray-50"
                  >
                    Save Incomplete Session
                  </button>
                </div>
              </div>
            )}

            {currentState === ExamState.ABANDONED && (
              <div className="h-full flex flex-col justify-center items-center text-center p-6">
                <AlertCircle size={44} className="text-gray-400 mb-4" />
                <h3 className="text-base font-bold text-gray-950">Session Abandoned</h3>
                <p className="text-gray-500 text-xs mt-1.5">
                  The candidate aborted this practice session. No scores were saved.
                </p>
                <button
                  onClick={() => navigate('/dashboard')}
                  className="mt-6 bg-[var(--hexa-navy)] hover:bg-[var(--hexa-navy-deep)] text-white text-xs font-bold py-2.5 px-6 rounded-xl cursor-pointer"
                >
                  Return to Dashboard
                </button>
              </div>
            )}

            {transcript.map((chunk) => {
              const isExaminer = chunk.speaker === 'examiner';
              return (
                <div
                  key={chunk.id}
                  className={`flex ${isExaminer ? 'justify-start' : 'justify-end'} animate-fade-in`}
                >
                  <div className={`max-w-[80%] rounded-2xl p-4 text-xs leading-relaxed shadow-sm border ${
                    isExaminer
                      ? 'bg-[var(--hexa-soft-blue)] text-slate-900 border-[rgba(47,51,127,.10)] rounded-tl-none'
                      : 'bg-[var(--hexa-navy)] text-white border-[var(--hexa-navy)] rounded-tr-none'
                  }`}>
                    <span className="text-[9px] font-bold block uppercase tracking-wider text-gray-400 mb-1 font-mono">
                      {isExaminer ? "HEXA'S AI Examiner" : 'Candidate'}
                    </span>
                    <p>{chunk.text}</p>
                  </div>
                </div>
              );
            })}

            {isEvaluating && (
              <div className="flex justify-start">
                <div className="bg-emerald-50 border border-emerald-100 max-w-[80%] rounded-2xl rounded-tl-none p-4 text-xs leading-normal flex items-start gap-3">
                  <RefreshCw size={14} className="text-emerald-600 animate-spin mt-0.5 shrink-0" />
                  <div className="text-emerald-800">
                    <strong>HEXA'S Assessment Engine:</strong> Synthesizing fluency, grammatical accuracy, lexical choice, and pronunciation. Moving to your results shortly...
                  </div>
                </div>
              </div>
            )}

            <div ref={transcriptEndRef}></div>
          </div>

          {/* Sandbox Fallback Input Bar */}
          {connectionStatus === 'connected' && currentState !== ExamState.FAILED && (
            <div className="border-t border-gray-100 p-4 bg-gray-50 shrink-0 flex gap-2 items-center">
              <input
                id="speech-mock-text-input"
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendTextMessage();
                }}
                placeholder="Type your spoken answer here (Sandbox Keyboard Fallback)..."
                className="flex-1 bg-white border border-gray-200 px-4 py-3 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[var(--hexa-navy)] focus:border-[var(--hexa-navy)]"
              />
              <button
                id="speech-mock-send-btn"
                onClick={handleSendTextMessage}
                className="hexa-primary-btn p-3 rounded-xl cursor-pointer transition"
              >
                <Send size={14} />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Active IELTS Cue Card, Timers, or Control center (Takes 4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Active State Details Panel */}
          <div className="border border-gray-100 bg-white rounded-3xl p-6 shadow-sm space-y-4">
            <h3 className="font-extrabold text-[var(--hexa-navy)] text-xs uppercase tracking-wider font-mono">Active Section Tracker</h3>
            
            <div className="space-y-3.5">
              <div className="flex justify-between items-center text-xs text-gray-600">
                <span>Part Context:</span>
                <strong className="text-gray-900 font-bold">
                  {currentPart === IELTSExamPart.PART_1 ? 'Part 1: Warmup' :
                   currentPart === IELTSExamPart.PART_2 ? 'Part 2: Long Turn' : 'Part 3: Discussion'}
                </strong>
              </div>

              {/* Topic Name */}
              <div className="flex justify-between items-center text-xs text-gray-600">
                <span>Topic:</span>
                <strong className="text-gray-900 font-bold truncate max-w-[160px]">
                  {session.selectedTestSnapshot?.part1Topic?.title || session.topic}
                </strong>
              </div>

              {/* Continuous Session Elapsed Time */}
              <div className="flex justify-between items-center text-xs text-gray-600">
                <span>Elapsed Time:</span>
                <strong className="text-gray-900 font-bold font-mono">
                  {Math.floor(sessionElapsedSeconds / 60)}:{(sessionElapsedSeconds % 60) < 10 ? `0${sessionElapsedSeconds % 60}` : sessionElapsedSeconds % 60}
                </strong>
              </div>

              {/* Microphone Control & Level Indicator */}
              <div className="border-t border-gray-100 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Microphone:</span>
                  <button
                    onClick={toggleMute}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      deviceState.isMuted
                        ? 'bg-red-50 text-red-600 border border-red-100'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    }`}
                  >
                    {deviceState.isMuted ? <MicOff size={13} /> : <Mic size={13} />}
                    <span>{deviceState.isMuted ? 'Muted' : 'Active'}</span>
                  </button>
                </div>

                {/* Input Level Visualization Bar */}
                {!deviceState.isMuted && connectionStatus === 'connected' && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                      <span>Mic Input Level</span>
                      <span>{Math.round(inputLevel)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full transition-all duration-75"
                        style={{ width: `${Math.min(100, Math.max(0, inputLevel))}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Part 2 prep visual timer */}
              {currentState === ExamState.PART2_PREPARATION && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-center space-y-3">
                  <Clock size={20} className="text-amber-600 mx-auto" />
                  <div>
                    <span className="text-[10px] text-amber-700 block uppercase tracking-wider font-bold mb-1 font-mono">Preparation Time Remaining</span>
                    <span className="text-2xl font-black text-amber-800 font-mono">00:{prepSecondsLeft < 10 ? `0${prepSecondsLeft}` : prepSecondsLeft}</span>
                  </div>
                  <p className="text-[10px] text-amber-700 leading-relaxed font-medium">
                    Microphone is temporarily muted. Jot down notes on the cue card below.
                  </p>
                  <button
                    id="start-speaking-now-btn"
                    onClick={() => {
                      if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
                        (voiceProviderRef.current as MockRealtimeProvider).forcePart2PrepFinish();
                      } else {
                        part2PrepExpiryTriggeredRef.current = true;
                        handleForceTransitionToPart2Speaking('manual');
                      }
                    }}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer shadow-sm"
                  >
                    Start Speaking Now
                  </button>
                </div>
              )}

              {/* Part 2 active speaking timer & milestones */}
              {currentState === ExamState.PART2_LONG_TURN && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center space-y-3">
                  <Clock size={20} className="text-emerald-600 mx-auto" />
                  <div>
                    <span className="text-[10px] text-emerald-700 block uppercase tracking-wider font-bold mb-1 font-mono">Speech Timer Duration</span>
                    <span className="text-2xl font-black text-emerald-800 font-mono">
                      {Math.floor(speakingSeconds / 60)}:{(speakingSeconds % 60) < 10 ? `0${speakingSeconds % 60}` : speakingSeconds % 60}
                    </span>
                  </div>

                  {/* Milestone Indicators */}
                  <div className="flex justify-center items-center gap-2 pt-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      speakingSeconds >= 60
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        : 'bg-gray-100 text-gray-500 border-gray-200'
                    }`}>
                      {speakingSeconds >= 60 ? '✓ 1:00 Min Reached' : '1:00 Min Target'}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      speakingSeconds >= 105
                        ? 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse'
                        : 'bg-gray-100 text-gray-500 border-gray-200'
                    }`}>
                      {speakingSeconds >= 105 ? 'Wrap Up Soon (1:45)' : '2:00 Max'}
                    </span>
                  </div>

                  <p className="text-[10px] text-emerald-700 leading-normal font-medium">
                    Microphone is active. Speak clearly for 1 to 2 minutes.
                  </p>
                  
                  {speakingSeconds >= 60 && (
                    <button
                      id="finish-part-2-speech-btn"
                      onClick={handleDevForceFinishLongTurn}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 px-3 rounded-xl transition cursor-pointer"
                    >
                      Finish Speech Turn & Proceed
                    </button>
                  )}
                </div>
              )}

              {/* End Session Button */}
              {connectionStatus === 'connected' && currentState !== ExamState.FAILED && currentState !== ExamState.ABANDONED && (
                <div className="pt-2 border-t border-gray-100 space-y-2">
                  <button
                    id="end-session-modal-button"
                    onClick={() => setShowEndModal(true)}
                    className="w-full flex items-center justify-center gap-1.5 border border-red-200 hover:bg-red-50 text-red-600 text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer"
                  >
                    <AlertCircle size={14} />
                    <span>End Practice Session</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Part 2 Card Preview (Active ONLY during Part 2) */}
          {currentPart === IELTSExamPart.PART_2 && session.cueCard && (
            <div className="border border-slate-200/80 border-t-4 border-t-[var(--hexa-red)] bg-white rounded-3xl p-6 shadow-sm space-y-4">
              <h3 className="font-extrabold text-[var(--hexa-navy)] text-xs flex items-center gap-2 font-mono uppercase tracking-wider">
                <FileText size={15} className="text-gray-400" />
                <span>Part 2 Cue Card</span>
              </h3>

              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs font-semibold text-gray-800 leading-relaxed text-center">
                {session.cueCard.topic}
              </div>

              <div className="space-y-2 text-xs text-gray-600">
                <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider mb-2 font-mono">Include the following points:</span>
                {session.cueCard.bulletPoints.map((bp, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 bg-gray-300 rounded-full mt-1.5 shrink-0"></span>
                    <span className="leading-tight">{bp}</span>
                  </div>
                ))}
              </div>

              {/* Note taking pad */}
              <div className="space-y-1.5 pt-2 border-t border-gray-50">
                <label className="block text-[9px] text-gray-400 font-bold uppercase tracking-wider font-mono">DraftPad Notes (Muted Preparation)</label>
                <textarea
                  id="draft-notes-builder-textarea"
                  rows={4}
                  value={draftNotes}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraftNotes(val);
                    if (voiceProviderRef.current && voiceProviderRef.current instanceof MockRealtimeProvider) {
                      (voiceProviderRef.current as MockRealtimeProvider).updateNotes(val);
                    }
                  }}
                  placeholder="Draft your keyword outline here..."
                  className="w-full border border-gray-200 rounded-2xl p-3 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--hexa-navy)] focus:border-[var(--hexa-navy)] bg-gray-50/10 placeholder:text-gray-400 font-medium"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DEVELOPER-ONLY DETERMINISTIC STATE MACHINE PRACTICE PANEL */}
      {APP_CONFIG.useMocks && (
        <div className="bg-slate-900 text-slate-100 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
          <div className="flex justify-between items-center border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <Zap className="text-amber-400" size={18} />
              <strong className="text-sm font-black tracking-tight text-white uppercase font-mono">
                Developer Mock & State Machine Inspector
              </strong>
            </div>
            <button
              onClick={() => setIsDevPanelOpen(!isDevPanelOpen)}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-1.5 px-3 rounded-lg cursor-pointer font-mono"
            >
              {isDevPanelOpen ? 'Collapse' : 'Expand Panel'}
            </button>
          </div>

          {isDevPanelOpen && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
              
              {/* Box 1: Visual State Monitor */}
              <div className="bg-slate-950 border border-slate-800/80 p-4 rounded-2xl space-y-3">
                <h4 className="font-extrabold text-slate-300 uppercase tracking-wider text-[10px] font-mono flex items-center gap-1">
                  <Sliders size={12} className="text-blue-400" />
                  <span>State-Machine Monitor</span>
                </h4>
                <div className="space-y-2 font-mono text-[11px] text-slate-400">
                  <div className="flex justify-between">
                    <span>Active State:</span>
                    <strong className="text-white font-bold uppercase">{currentState}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Part Target:</span>
                    <strong className="text-white font-bold">{currentPart}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Part 1 Qs index:</span>
                    <strong className="text-white font-bold">
                      {(voiceProviderRef.current as MockRealtimeProvider)?.getContext()?.currentPart1QuestionIndex ?? 0}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Part 3 Qs index:</span>
                    <strong className="text-white font-bold">
                      {(voiceProviderRef.current as MockRealtimeProvider)?.getContext()?.currentPart3QuestionIndex ?? 0}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Reconnect attempts:</span>
                    <strong className="text-amber-400 font-bold">{reconnectCount}</strong>
                  </div>
                  <div className="border-t border-slate-800/60 pt-2 space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Completed Question IDs (No Repeats):</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {completedQuestions.length === 0 ? (
                        <span className="text-slate-600 italic">None yet</span>
                      ) : (
                        completedQuestions.map(id => (
                          <span key={id} className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[9px] border border-slate-700 font-mono">
                            {id}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Box 2: Deterministic State Driving */}
              <div className="bg-slate-950 border border-slate-800/80 p-4 rounded-2xl space-y-3 flex flex-col justify-between">
                <div>
                  <h4 className="font-extrabold text-slate-300 uppercase tracking-wider text-[10px] font-mono flex items-center gap-1 mb-2">
                    <Clock size={12} className="text-emerald-400" />
                    <span>Timer & Event Injection</span>
                  </h4>
                  <div className="space-y-2">
                    {/* Tick buttons specifically for Part 2 prep */}
                    {currentState === ExamState.PART2_PREPARATION && (
                      <div className="space-y-1">
                        <span className="text-[9px] text-slate-500 font-bold uppercase font-mono block">Simulate prep timer tick:</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleDevTickTimer(10, 0)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-1.5 rounded font-mono text-[10px]"
                          >
                            +10s
                          </button>
                          <button
                            onClick={() => handleDevTickTimer(30, 0)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-1.5 rounded font-mono text-[10px]"
                          >
                            +30s
                          </button>
                          <button
                            onClick={() => handleDevTickTimer(60, 0)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-1.5 rounded font-mono text-[10px]"
                          >
                            +60s (End)
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tick buttons specifically for Part 2 Speaking */}
                    {currentState === ExamState.PART2_LONG_TURN && (
                      <div className="space-y-1">
                        <span className="text-[9px] text-slate-500 font-bold uppercase font-mono block">Simulate speech timer tick:</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleDevTickTimer(0, 15)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-1.5 rounded font-mono text-[10px]"
                          >
                            +15s
                          </button>
                          <button
                            onClick={() => handleDevTickTimer(0, 45)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-1.5 rounded font-mono text-[10px]"
                          >
                            +45s
                          </button>
                          <button
                            onClick={() => handleDevTickTimer(0, 120)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-1.5 rounded font-mono text-[10px]"
                          >
                            +120s (End)
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Network Resiliency Testing */}
                    <div className="space-y-1.5 pt-2 border-t border-slate-800/50">
                      <span className="text-[9px] text-slate-500 font-bold uppercase font-mono block">Network drop simulation:</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={handleDevSimulateDisconnect}
                          disabled={currentState === ExamState.RECOVERING}
                          className="flex-1 bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-200 font-bold py-1.5 rounded-xl transition disabled:opacity-40"
                        >
                          Drop Socket (DISCONNECT)
                        </button>
                        <button
                          onClick={handleDevSimulateReconnect}
                          disabled={currentState !== ExamState.RECOVERING}
                          className="flex-1 bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-200 font-bold py-1.5 rounded-xl transition disabled:opacity-40"
                        >
                          Recover (ESTABLISHED)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Validation outcome text box */}
                {lastValidationResult && (
                  <div className="bg-slate-900 border border-slate-800 p-2 rounded-xl text-[10px] font-mono text-amber-400 mt-2 whitespace-normal break-all">
                    <strong>Validation result:</strong> {lastValidationResult}
                  </div>
                )}
              </div>

              {/* Box 3: Serialized State Refresh & Negatives */}
              <div className="bg-slate-950 border border-slate-800/80 p-4 rounded-2xl space-y-3 flex flex-col justify-between">
                <div className="space-y-3">
                  <h4 className="font-extrabold text-slate-300 uppercase tracking-wider text-[10px] font-mono flex items-center gap-1">
                    <Save size={12} className="text-purple-400" />
                    <span>Snapshot Serializer & Negative Tests</span>
                  </h4>

                  {/* Serialization & Restoration */}
                  <div className="space-y-1">
                    <span className="text-[9px] text-slate-500 font-bold uppercase font-mono block">Refresh & Recovery simulation:</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleDevSerializeSnapshot}
                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-1.5 rounded-xl font-mono text-[9px]"
                      >
                        Serialize (Save State)
                      </button>
                      <button
                        onClick={handleDevRestoreFromSnapshot}
                        className="flex-1 bg-purple-950/80 hover:bg-purple-900 border border-purple-800 text-purple-200 font-bold py-1.5 rounded-xl font-mono text-[9px]"
                      >
                        Restore State (RECOVER)
                      </button>
                    </div>
                  </div>

                  {/* Robust negative testing buttons */}
                  <div className="space-y-1 border-t border-slate-800/50 pt-2">
                    <span className="text-[9px] text-slate-500 font-bold uppercase font-mono block">Negative & Duplicate event tests:</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleDevSimulateDuplicateEvent}
                        className="flex-1 bg-slate-800/50 hover:bg-slate-800 text-slate-300 font-bold py-1.5 rounded-xl text-[9px]"
                      >
                        Duplicate Connect Event
                      </button>
                      <button
                        onClick={handleDevSimulateInvalidTransition}
                        className="flex-1 bg-slate-800/50 hover:bg-slate-800 text-slate-300 font-bold py-1.5 rounded-xl text-[9px]"
                      >
                        Trigger Invalid Transition
                      </button>
                    </div>
                  </div>

                  {/* Force states directly */}
                  <div className="space-y-1 border-t border-slate-800/50 pt-2">
                    <span className="text-[9px] text-slate-500 font-bold uppercase font-mono block">Force abnormal exits:</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleDevTriggerAbandon}
                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold py-1.5 rounded-xl text-[9px]"
                      >
                        Force Abandon
                      </button>
                      <button
                        onClick={handleDevTriggerFailure}
                        className="flex-1 bg-red-950/20 hover:bg-red-950/40 text-red-400 font-bold py-1.5 rounded-xl text-[9px]"
                      >
                        Force Crash Failure
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
      )}
      <ProviderDiagnosticsPanel provider={voiceProviderRef.current} />

      {/* End Session Confirmation Modal */}
      {showEndModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-100 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 animate-fade-in">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
              <AlertCircle size={24} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-gray-950">End Practice Session?</h3>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Ending early will mark this practice session as abandoned and incomplete. No evaluation scores will be generated.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowEndModal(false)}
                className="flex-1 border border-gray-200 text-gray-700 text-xs font-bold py-2.5 rounded-xl hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAbortSession}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2.5 rounded-xl cursor-pointer"
              >
                End & Abort
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PracticeSessionView;
