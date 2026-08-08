/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../services/routerContext';
import { MockPracticeService } from '../services/mockService';
import { IELTSEvaluation, IELTSPracticeSession, RecordingMetadata } from '../types';
import { RecordingUploadService } from '../services/recordingUploadService';
import { EvaluationApiService } from '../services/evaluationApiService';
import { FirebaseRepository } from '../services/firebaseRepository';
import { VoiceFeedbackService } from '../services/voiceFeedbackService';
import { 
  AlertTriangle, 
  ArrowLeft, 
  CheckSquare, 
  Square, 
  ThumbsUp, 
  Compass,
  Mic,
  Trash2,
  SkipForward,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Calendar,
  Clock,
  Layers,
  Sparkles,
  Info,
  Zap,
  HelpCircle,
  Volume2,
  Loader2,
  Play,
  Pause,
  Radio
} from 'lucide-react';

interface ResultsViewProps {
  sessionId?: string;
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const ResultsView: React.FC<ResultsViewProps> = ({ sessionId }) => {
  const { navigate } = useRouter();
  const [session, setSession] = useState<IELTSPracticeSession | null>(null);
  const [evaluation, setEvaluation] = useState<IELTSEvaluation | null>(null);
  const [completedGoals, setCompletedGoals] = useState<Record<number, boolean>>({});
  const [recordingMeta, setRecordingMeta] = useState<RecordingMetadata | undefined>(undefined);
  const [isActionPending, setIsActionPending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recordingActionError, setRecordingActionError] = useState<string | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [voiceFeedbackState, setVoiceFeedbackState] = useState<'prompt' | 'loading' | 'ready' | 'declined'>('prompt');
  const [voiceFeedbackError, setVoiceFeedbackError] = useState<string | null>(null);
  const [voiceAudioUrl, setVoiceAudioUrl] = useState<string | null>(null);
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const [isListeningForVoiceAnswer, setIsListeningForVoiceAnswer] = useState(false);
  const [voiceAutoplayBlocked, setVoiceAutoplayBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const promptedEvaluationRef = useRef<string | null>(null);
  const voicePromptActiveRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSessionAndEvaluation() {
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const localSession = MockPracticeService.getSessionById(sessionId);
        // Cloud restoration is helpful but must not keep the Results page in an
        // infinite loading state. The just-completed local snapshot is sufficient
        // to begin evaluation if Firestore is slow/offline.
        const restoredSession = await settleWithin(
          FirebaseRepository.restoreFullSessionState(sessionId).catch(() => null),
          8000,
          null
        );

        // The practice screen marks its local recovery copy complete before
        // navigating here. If Firestore is a moment behind, prefer that completed
        // state while still retaining the richer cloud transcript when available.
        let sess = restoredSession || localSession;
        if (restoredSession && localSession?.status === 'completed' && restoredSession.status !== 'completed') {
          const cloudTranscript = restoredSession.transcript || [];
          const localTranscript = localSession.transcript || [];
          sess = {
            ...restoredSession,
            status: 'completed',
            currentState: localSession.currentState,
            currentPart: localSession.currentPart,
            selectedTestSnapshot: localSession.selectedTestSnapshot || restoredSession.selectedTestSnapshot,
            transcript: localTranscript.length >= cloudTranscript.length ? localTranscript : cloudTranscript,
            part2Meta: localSession.part2Meta || restoredSession.part2Meta,
            draftNotes: localSession.draftNotes ?? restoredSession.draftNotes,
          };
        }

        if (sess) {
          MockPracticeService.upsertSession(sess);
          if (isMounted) {
            setSession(sess);
            if (sess.recordingMetadata) {
              setRecordingMeta(sess.recordingMetadata);
            }
          }
        } else {
          if (isMounted) {
            setSession(null);
            setIsLoading(false);
          }
          return;
        }

        // Results owns evaluation generation. Passing the just-finished session
        // evidence avoids a race where Firestore has not yet cached the final turn.
        let evalData: IELTSEvaluation | null = null;
        try {
          evalData = await EvaluationApiService.getEvaluation(sessionId);
        } catch (lookupError) {
          // A failed existing-report lookup must not prevent a fresh grading call.
          console.warn('[ResultsView] Existing evaluation lookup failed; attempting fresh evaluation.', lookupError);
        }
        if (!evalData && sess.status === 'completed') {
          evalData = await EvaluationApiService.generateEvaluation(sessionId, false, sess);
        }

        if (isMounted) {
          setEvaluation(evalData);
        }
      } catch (err: any) {
        console.error('[ResultsView] Failed to load session or evaluation:', err);
        if (isMounted) {
          setLoadError(err.message || 'Failed to load evaluation data.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSessionAndEvaluation();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  function stopVoiceAnswerListening() {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
    setIsListeningForVoiceAnswer(false);
  }

  function buildFallbackBanglaFeedback(report: IELTSEvaluation): string {
    return `আপনার আনুমানিক ওভারঅল ব্যান্ড স্কোর ${report.estimatedOverallBand.toFixed(1)}। এখন আমি আপনার রিপোর্টটি একটু বিস্তারিতভাবে ব্যাখ্যা করছি। ফ্লুয়েন্সি অ্যান্ড কোহেরেন্সে আপনার স্কোর ${report.criteria.fluencyAndCoherence.score.toFixed(1)}। এই অংশে লক্ষ্য হবে উত্তরকে শুধু ছোট বাক্যে শেষ না করে কারণ, উদাহরণ এবং ফলাফল যোগ করে স্বাভাবিকভাবে বিস্তৃত করা। একই সঙ্গে অতিরিক্ত থেমে যাওয়া, একই ধারণা বারবার বলা এবং সংযোগকারী শব্দের সীমিত ব্যবহার কমাতে হবে। লেক্সিক্যাল রিসোর্সে আপনার স্কোর ${report.criteria.lexicalResource.score.toFixed(1)}। এখানে পরিচিত শব্দের পাশাপাশি একই অর্থ প্রকাশের জন্য আরও নির্ভুল এবং বৈচিত্র্যময় শব্দ ও স্বাভাবিক ফ্রেজ ব্যবহার করার অনুশীলন করুন। গ্রামাটিক্যাল রেঞ্জ অ্যান্ড অ্যাকিউরেসিতে আপনার স্কোর ${report.criteria.grammaticalRangeAccuracy.score.toFixed(1)}। সহজ বাক্য সঠিক রাখার পাশাপাশি কারণ, তুলনা, শর্ত, অতীত অভিজ্ঞতা এবং মতামত বোঝাতে কিছু জটিল বাক্য কাঠামো নিয়মিত ব্যবহার করুন, তবে ভুল বাড়িয়ে নয়। উচ্চারণের স্কোর ৬.০ আপাতত ধরে নেওয়া হয়েছে, কারণ এই রিপোর্টে অডিও-ভিত্তিক উচ্চারণ বিশ্লেষণ চালু নেই; তাই এটিকে প্রকৃত উচ্চারণ মূল্যায়ন হিসেবে ধরবেন না। আপনার শক্তির দিকগুলো ধরে রাখুন, কিন্তু উন্নতির জন্য তিনটি বিষয়কে অগ্রাধিকার দিন: উত্তরকে বেশি বিকশিত করা, শব্দচয়নে বৈচিত্র্য আনা এবং ব্যাকরণে ধারাবাহিক নির্ভুলতা তৈরি করা। আগামী সাত দিন প্রতিদিন একটি স্পিকিং প্রশ্ন নিয়ে এক থেকে দুই মিনিট উত্তর দিন, রেকর্ড শুনে তিনটি দুর্বল বাক্য লিখে ঠিক করুন, পাঁচটি ভালো ফ্রেজ পুনরায় ব্যবহার করুন এবং পরের দিন একই প্রশ্নে আরও উন্নত উত্তর দেওয়ার চেষ্টা করুন। এভাবে নিয়মিত অনুশীলন করলে আপনার উত্তর আরও পরিষ্কার, স্বাভাবিক এবং ব্যান্ড-উপযোগী হবে।`;
  }

  async function handleVoiceFeedbackAccept() {
    if (!evaluation || voiceFeedbackState === 'loading') return;

    voicePromptActiveRef.current = false;
    stopVoiceAnswerListening();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setVoiceFeedbackError(null);
    setVoiceAutoplayBlocked(false);

    if (voiceAudioUrl) {
      setVoiceFeedbackState('ready');
      window.setTimeout(() => {
        audioRef.current?.play().catch(() => setVoiceAutoplayBlocked(true));
      }, 0);
      return;
    }

    setVoiceFeedbackState('loading');
    try {
      const script = evaluation.voiceFeedbackBangla?.trim() || buildFallbackBanglaFeedback(evaluation);
      const audioBlob = await VoiceFeedbackService.generateBanglaAudio(script);
      const nextUrl = URL.createObjectURL(audioBlob);
      setVoiceAudioUrl((previousUrl) => {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return nextUrl;
      });
      setVoiceFeedbackState('ready');
    } catch (error: any) {
      console.error('[ResultsView] Bangla voice feedback error:', error);
      setVoiceFeedbackError(error?.message || 'Could not generate Bangla voice feedback.');
      setVoiceFeedbackState('prompt');
    }
  }

  function handleVoiceFeedbackDecline() {
    voicePromptActiveRef.current = false;
    stopVoiceAnswerListening();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setVoiceFeedbackError(null);
    setVoiceFeedbackState('declined');
  }

  function startVoiceAnswerListening() {
    if (typeof window === 'undefined' || !voicePromptActiveRef.current) return;
    const RecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!RecognitionCtor) return;

    try {
      stopVoiceAnswerListening();
      const recognition = new RecognitionCtor();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;
      recognitionRef.current = recognition;

      recognition.onstart = () => setIsListeningForVoiceAnswer(true);
      recognition.onresult = (event: any) => {
        const alternatives: string[] = [];
        for (let i = 0; i < (event?.results?.length || 0); i += 1) {
          const result = event.results[i];
          for (let j = 0; j < (result?.length || 0); j += 1) {
            alternatives.push(String(result[j]?.transcript || '').toLowerCase());
          }
        }
        const heard = alternatives.join(' ');
        if (/\b(yes|yeah|yep|sure|okay|ok|please|go ahead)\b/i.test(heard)) {
          void handleVoiceFeedbackAccept();
        } else if (/\b(no|nope|later|not now|skip)\b/i.test(heard)) {
          handleVoiceFeedbackDecline();
        }
      };
      recognition.onerror = () => setIsListeningForVoiceAnswer(false);
      recognition.onend = () => {
        recognitionRef.current = null;
        setIsListeningForVoiceAnswer(false);
      };
      recognition.start();
    } catch (error) {
      console.warn('[ResultsView] Voice yes/no recognition unavailable:', error);
      setIsListeningForVoiceAnswer(false);
    }
  }

  function askForBanglaFeedback() {
    if (typeof window === 'undefined') return;
    voicePromptActiveRef.current = true;
    setVoiceFeedbackState('prompt');
    setVoiceFeedbackError(null);

    if (!('speechSynthesis' in window)) {
      startVoiceAnswerListening();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance('Would you like to get the feedback in Bangla?');
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.onend = () => startVoiceAnswerListening();
      utterance.onerror = () => startVoiceAnswerListening();
      window.speechSynthesis.speak(utterance);
    } catch {
      startVoiceAnswerListening();
    }
  }

  const handleSkipRecordingUpload = async () => {
    if (!session) return;
    setRecordingActionError(null);
    setIsActionPending(true);
    try {
      const updated = await RecordingUploadService.skipRecordingUpload(session.id);
      setRecordingMeta(updated);
    } catch (err: any) {
      setRecordingActionError(err?.message || 'Could not update the recording status.');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleDeleteRecording = async () => {
    if (!session) return;
    setRecordingActionError(null);
    setIsActionPending(true);
    try {
      await RecordingUploadService.deleteRecording(session.id, recordingMeta?.path || '');
      setRecordingMeta(prev => prev ? { ...prev, status: 'deleted', path: '' } : undefined);
    } catch (err: any) {
      setRecordingActionError(err?.message || 'Could not delete the recording.');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleReEvaluate = async () => {
    if (!session) return;
    voicePromptActiveRef.current = false;
    stopVoiceAnswerListening();
    if (audioRef.current) audioRef.current.pause();
    setIsVoicePlaying(false);
    setVoiceFeedbackError(null);
    setVoiceFeedbackState('prompt');
    setIsActionPending(true);
    try {
      const freshEval = await EvaluationApiService.generateEvaluation(session.id, true, session);
      setEvaluation(freshEval);
    } catch (err: any) {
      console.error('[ResultsView] Re-evaluation error:', err);
      setLoadError(err.message || 'Re-evaluation failed.');
    } finally {
      setIsActionPending(false);
    }
  };

  useEffect(() => {
    if (!evaluation || evaluation.status === 'failed' || evaluation.status === 'processing' || evaluation.status === 'queued') return;
    const promptKey = `${evaluation.id}:${evaluation.createdAt}`;
    if (promptedEvaluationRef.current === promptKey) return;
    promptedEvaluationRef.current = promptKey;

    const timer = window.setTimeout(() => askForBanglaFeedback(), 800);
    return () => window.clearTimeout(timer);
  }, [evaluation?.id, evaluation?.createdAt]);

  useEffect(() => {
    if (!voiceAudioUrl || voiceFeedbackState !== 'ready') return;
    const timer = window.setTimeout(() => {
      audioRef.current?.play()
        .then(() => setVoiceAutoplayBlocked(false))
        .catch(() => setVoiceAutoplayBlocked(true));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [voiceAudioUrl, voiceFeedbackState]);

  useEffect(() => {
    return () => {
      voicePromptActiveRef.current = false;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        try { recognition.abort(); } catch {}
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (voiceAudioUrl) URL.revokeObjectURL(voiceAudioUrl);
    };
  }, [voiceAudioUrl]);

  const toggleGoal = (index: number) => {
    setCompletedGoals(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <main className="max-w-4xl mx-auto py-12 px-4 font-sans text-center space-y-6" aria-live="polite">
        <div className="inline-flex p-4 bg-gray-50 border border-gray-100 rounded-full animate-bounce">
          <Sparkles className="text-gray-900" size={28} />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-black text-gray-950 tracking-tight">Loading Examination Assessment Report</h1>
          <p className="text-gray-500 text-xs max-w-md mx-auto leading-relaxed">
            Fetching candidate transcripts and compiling detailed IELTS criteria evaluations...
          </p>
        </div>
      </main>
    );
  }

  // 2. Deleted Session State
  if (!session) {
    return (
      <main className="max-w-md mx-auto py-16 px-4 font-sans text-center space-y-6">
        <div className="inline-flex p-4 bg-red-50 text-red-600 rounded-full border border-red-100">
          <AlertCircle size={32} />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-gray-950 tracking-tight">Session Not Found or Deleted</h1>
          <p className="text-gray-500 text-xs leading-relaxed">
            The requested practice session <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px]">{sessionId || 'unknown'}</code> was deleted or does not exist.
          </p>
        </div>
        <button
          id="deleted-back-dashboard-btn"
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-950 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition cursor-pointer"
        >
          <ArrowLeft size={14} /> Back to Dashboard
        </button>
      </main>
    );
  }

  // 3. Incomplete Session State
  if (session.status === 'incomplete' || session.status === 'abandoned') {
    return (
      <main className="max-w-3xl mx-auto py-10 px-4 font-sans space-y-6">
        <div className="flex items-center justify-between">
          <button
            id="incomplete-back-dashboard-btn"
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 cursor-pointer"
          >
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
          <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full uppercase">
            Status: {session.status}
          </span>
        </div>

        <div className="bg-amber-50/60 border border-amber-200/80 rounded-3xl p-6 sm:p-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-700 shrink-0 mt-0.5" size={24} />
            <div className="space-y-1">
              <h1 className="text-xl font-extrabold text-amber-950">Incomplete Practice Session</h1>
              <p className="text-amber-900 text-xs leading-relaxed">
                This session ended early before completing all test parts. However, transcript turns were captured and preserved safely.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-white/80 p-4 rounded-2xl border border-amber-100 text-xs">
            <div>
              <span className="text-gray-400 font-medium block">Topic</span>
              <strong className="text-gray-900 font-bold block truncate">{session.topic}</strong>
            </div>
            <div>
              <span className="text-gray-400 font-medium block">Recorded Turns</span>
              <strong className="text-gray-900 font-bold block">{session.transcript?.length || 0} turns</strong>
            </div>
            <div>
              <span className="text-gray-400 font-medium block">Date</span>
              <strong className="text-gray-900 font-bold block">{new Date(session.createdAt).toLocaleDateString()}</strong>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap gap-3">
            <button
              id="evaluate-incomplete-btn"
              onClick={handleReEvaluate}
              disabled={isActionPending}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-700 text-white rounded-xl text-xs font-bold hover:bg-amber-800 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={isActionPending ? 'animate-spin' : ''} />
              {isActionPending ? 'Generating Evaluation...' : 'Evaluate Partial Session'}
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
            >
              Return to Dashboard
            </button>
          </div>
        </div>

        {/* Display Partial Transcript */}
        {session.transcript && session.transcript.length > 0 && (
          <div className="border border-gray-100 bg-white rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-bold text-gray-950 flex items-center gap-2">
              <FileText size={16} className="text-gray-400" />
              <span>Recorded Transcript Turns</span>
            </h2>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-2 text-xs divide-y divide-gray-50">
              {session.transcript.map((turn, idx) => (
                <div key={turn.id || idx} className="pt-3 first:pt-0 space-y-1">
                  <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
                    turn.speaker === 'examiner' ? 'text-blue-700' : 'text-emerald-700'
                  }`}>
                    {turn.speaker}
                  </span>
                  <p className="text-gray-800 leading-relaxed font-sans">{turn.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    );
  }

  // 4. Processing State
  if (evaluation?.status === 'processing' || evaluation?.status === 'queued') {
    return (
      <main className="max-w-xl mx-auto py-16 px-4 font-sans text-center space-y-6">
        <div className="inline-flex p-4 bg-blue-50 text-blue-600 rounded-full border border-blue-100 animate-spin">
          <RefreshCw size={32} />
        </div>
        <div className="space-y-2">
          <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-wider">
            Status: {evaluation.status}
          </span>
          <h1 className="text-2xl font-black text-gray-950 tracking-tight">Evaluation Processing on Server</h1>
          <p className="text-gray-500 text-xs max-w-md mx-auto leading-relaxed">
            Your candidate speech transcript is currently being graded by Gemini against official Cambridge IELTS assessment rubrics.
          </p>
        </div>
        <button
          id="check-status-btn"
          onClick={handleReEvaluate}
          disabled={isActionPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-950 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={isActionPending ? 'animate-spin' : ''} />
          {isActionPending ? 'Checking...' : 'Check Status'}
        </button>
      </main>
    );
  }

  // 5. Failed State
  if (evaluation?.status === 'failed' || loadError) {
    return (
      <main className="max-w-xl mx-auto py-16 px-4 font-sans text-center space-y-6">
        <div className="inline-flex p-4 bg-red-50 text-red-600 rounded-full border border-red-100">
          <AlertCircle size={32} />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-gray-950 tracking-tight">Evaluation Pipeline Error</h1>
          <p className="text-red-700 text-xs bg-red-50 p-3 rounded-xl border border-red-100 font-mono leading-relaxed">
            {evaluation?.error || loadError || 'An error occurred during evaluation compilation.'}
          </p>
          <p className="text-gray-500 text-xs leading-relaxed">
            Your recorded transcript and session data are 100% safe. Click below to retry generating your assessment report.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <button
            id="retry-evaluation-btn"
            onClick={handleReEvaluate}
            disabled={isActionPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={isActionPending ? 'animate-spin' : ''} />
            {isActionPending ? 'Retrying...' : 'Retry Evaluation'}
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
          >
            Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // 6. Fallback if evaluation is missing
  if (!evaluation) {
    return (
      <main className="max-w-md mx-auto text-center py-16 font-sans space-y-4">
        <p className="text-gray-500 text-xs">No evaluation report compiled yet for session <code className="bg-gray-100 px-1 rounded">{sessionId}</code>.</p>
        <button
          id="generate-eval-btn"
          onClick={handleReEvaluate}
          disabled={isActionPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-950 text-white rounded-xl text-xs font-bold hover:bg-gray-800 cursor-pointer"
        >
          <RefreshCw size={14} className={isActionPending ? 'animate-spin' : ''} />
          Generate Evaluation
        </button>
      </main>
    );
  }

  const isPronunciationAssessed = evaluation.criteria.pronunciation.status === 'assessed' && evaluation.criteria.pronunciation.score > 0;
  const isPronunciationAssumed = evaluation.criteria.pronunciation.status === 'assumed' && evaluation.criteria.pronunciation.score > 0;
  const isPronunciationUnavailable = !isPronunciationAssessed && !isPronunciationAssumed;
  const isTranscriptOnly = evaluation.assessmentBasis !== 'transcript_and_audio' || !isPronunciationAssessed;
  const isSandboxEvaluation = evaluation.evaluationEngine === 'sandbox';
  const confidencePercent = Math.round((evaluation.confidence ?? (isTranscriptOnly ? 0.68 : 0.86)) * 100);

  // 7. Completed Evaluation Report Page
  return (
    <main id="results-view-container" className="max-w-4xl mx-auto py-6 sm:py-8 px-3 sm:px-6 font-sans space-y-6 sm:space-y-8">
      
      {/* Top Bar Navigation & Actions */}
      <nav aria-label="Results navigation" className="flex flex-wrap items-center justify-between gap-3">
        <button
          id="results-back-dashboard-btn"
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-950 rounded-lg p-1"
        >
          <ArrowLeft size={14} /> Back to Dashboard
        </button>

        <div className="flex items-center gap-2">
          <button
            id="re-evaluate-btn"
            onClick={handleReEvaluate}
            disabled={isActionPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--hexa-soft-blue)] hover:bg-[rgba(47,51,127,.10)] text-[var(--hexa-navy)] rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--hexa-navy)]/20"
          >
            <RefreshCw size={13} className={isActionPending ? 'animate-spin' : ''} />
            {isActionPending ? 'Re-evaluating...' : 'Re-evaluate Session'}
          </button>
        </div>
      </nav>

      {/* Prominent Overall Estimated Practice Band & Confidence Banner */}
      <section 
        aria-label="Overall Practice Band Score"
        className="hexa-brand-panel text-white rounded-[2rem] p-6 sm:p-8 shadow-xl relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6"
      >
        <div className="space-y-3 text-center md:text-left">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest font-mono bg-white/10 px-2.5 py-1 rounded-full border border-white/10">
              HEXA'S IELTS Practice Assessment
            </span>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
              isSandboxEvaluation
                ? 'text-amber-300 bg-amber-950/80 border-amber-500/20'
                : 'text-emerald-400 bg-emerald-950/80 border-emerald-500/20'
            }`}>
              {isSandboxEvaluation ? 'DEMO EVALUATOR' : `${confidencePercent}% AI Confidence`}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight">HEXA'S Speaking Practice Complete</h1>
          <p className="text-white/70 text-xs max-w-md leading-relaxed">
            {isSandboxEvaluation
              ? 'This report was generated by the local demo evaluator, not by the real Gemini IELTS evaluation engine.'
              : isTranscriptOnly
              ? 'Your candidate transcript was evaluated for fluency/coherence, vocabulary, and grammatical range. Pronunciation is shown separately when usable audio evidence is available.'
              : 'Your candidate transcript and usable audio evidence were evaluated across all four IELTS Speaking assessment criteria.'}
          </p>
        </div>

        {/* Estimated Practice Band Circle */}
        <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-5 text-center w-full md:w-44 shrink-0 space-y-1">
          <span className="text-[10px] text-white/65 uppercase tracking-widest block font-bold">
            {isSandboxEvaluation ? 'Demo Band Output' : 'Estimated Practice Band'}
          </span>
          <strong className="text-4xl sm:text-5xl font-black block font-mono tracking-tight my-0.5">
            {evaluation.estimatedOverallBand.toFixed(1)}
          </strong>
          {evaluation.bandRange && (
            <span className="text-[11px] text-white/65 block font-semibold font-mono bg-white/10 rounded py-0.5 px-1.5 border border-white/10">
              Band Range: {evaluation.bandRange}
            </span>
          )}
          <span className="text-[9px] text-white/50 block font-medium pt-1">
            {isSandboxEvaluation
              ? 'Not a genuine AI language assessment'
              : isTranscriptOnly
                ? 'Transcript-based practice estimate'
                : 'Audio-backed simulated practice estimate'}
          </span>
        </div>
      </section>

      {/* Conversational Bangla Voice Feedback */}
      {!isSandboxEvaluation && (
        <section
          aria-label="Bangla Voice Feedback"
          className="border border-[var(--hexa-navy)]/10 bg-gradient-to-br from-white to-[var(--hexa-soft-blue)]/35 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-[var(--hexa-navy)] text-white shrink-0">
              <Volume2 size={18} />
            </div>
            <div className="space-y-1 flex-1">
              <h2 className="text-base font-extrabold text-gray-950">Would you like to get the feedback in Bangla?</h2>
              <p className="text-xs text-gray-500 leading-relaxed">
                {(typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition))
                  ? 'You can say “yes” or press Yes.'
                  : 'Press Yes to hear a detailed Bangla coaching review of this report.'}
              </p>
            </div>
          </div>

          {voiceFeedbackState === 'prompt' && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                id="bangla-feedback-yes-btn"
                type="button"
                onClick={() => void handleVoiceFeedbackAccept()}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[var(--hexa-navy)] text-white rounded-xl text-xs font-bold hover:opacity-90 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--hexa-navy)]/25"
              >
                <Play size={14} fill="currentColor" /> Yes
              </button>
              <button
                id="bangla-feedback-no-btn"
                type="button"
                onClick={handleVoiceFeedbackDecline}
                className="inline-flex items-center justify-center px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
              >
                No
              </button>
              {isListeningForVoiceAnswer && (
                <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1.5" aria-live="polite">
                  <Radio size={12} className="animate-pulse" /> Listening for “yes” or “no”…
                </span>
              )}
            </div>
          )}

          {voiceFeedbackState === 'loading' && (
            <div className="flex items-center gap-3 bg-white/80 border border-gray-100 rounded-xl p-4" aria-live="polite">
              <Loader2 size={18} className="animate-spin text-[var(--hexa-navy)]" />
              <div>
                <p className="text-xs font-bold text-gray-900">Preparing your Bangla voice feedback…</p>
                <p className="text-[11px] text-gray-500 mt-0.5">The audio will start automatically when it is ready.</p>
              </div>
            </div>
          )}

          {voiceFeedbackState === 'ready' && voiceAudioUrl && (
            <div className="space-y-3 bg-white/85 border border-gray-100 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-gray-900">Bangla coaching feedback</p>
                  <p className="text-[11px] text-gray-500">Generated from this IELTS practice assessment.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const audio = audioRef.current;
                    if (!audio) return;
                    if (audio.paused) {
                      audio.play().catch(() => setVoiceAutoplayBlocked(true));
                    } else {
                      audio.pause();
                    }
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[var(--hexa-navy)] text-white text-xs font-bold cursor-pointer"
                >
                  {isVoicePlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                  {isVoicePlaying ? 'Pause' : 'Play'}
                </button>
              </div>
              <audio
                ref={audioRef}
                src={voiceAudioUrl}
                controls
                preload="auto"
                className="w-full h-10"
                onPlay={() => { setIsVoicePlaying(true); setVoiceAutoplayBlocked(false); }}
                onPause={() => setIsVoicePlaying(false)}
                onEnded={() => setIsVoicePlaying(false)}
              />
              {voiceAutoplayBlocked && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Your browser blocked automatic audio. Press Play once to hear the feedback.
                </p>
              )}
            </div>
          )}

          {voiceFeedbackState === 'declined' && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white/70 border border-gray-100 rounded-xl p-3.5">
              <p className="text-xs text-gray-600">No problem. You can request it later from this report.</p>
              <button
                type="button"
                onClick={askForBanglaFeedback}
                className="text-xs font-bold text-[var(--hexa-navy)] hover:underline cursor-pointer"
              >
                Ask me again
              </button>
            </div>
          )}

          {voiceFeedbackError && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl p-3 space-y-2" role="alert">
              <p className="whitespace-pre-line">{voiceFeedbackError}</p>
              <button
                type="button"
                onClick={() => void handleVoiceFeedbackAccept()}
                className="font-bold underline cursor-pointer"
              >
                Try again
              </button>
            </div>
          )}
        </section>
      )}

      {isSandboxEvaluation && (
        <section aria-label="Demo Evaluation Warning" className="bg-red-50 border border-red-200 rounded-2xl p-5 text-xs text-red-950 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-red-700 shrink-0" />
            <h2 className="font-extrabold text-sm">Real AI evaluation did not run</h2>
          </div>
          <p className="leading-relaxed">
            This is a sandbox/demo result and must not be interpreted as an IELTS band estimate. In real mode, provider or authentication failures now produce an explicit error instead of silently substituting this score.
          </p>
          {evaluation.qualityWarnings && evaluation.qualityWarnings.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-[11px]">
              {evaluation.qualityWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* Official Legal Disclaimer */}
      <section aria-label="Legal Disclaimer" className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-4 text-xs text-amber-900 flex gap-3 items-start">
        <AlertTriangle size={18} className="shrink-0 text-amber-700 mt-0.5" />
        <div className="leading-relaxed">
          <strong>Important Score Disclaimer:</strong> {evaluation.disclaimer || 'Estimated Practice Band - Simulated assessment, not official IELTS score.'} This report is designed for practice and does not represent an official IELTS result.
        </div>
      </section>

      {/* Private Audio Recording Upload & Consent Status */}
      {recordingMeta && (
        <section id="recording-status-card" aria-label="Recording Status" className="border border-gray-100 bg-white rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Mic size={18} className="text-gray-500" />
              <h2 className="text-sm font-bold text-gray-950">Session Recording Status</h2>
            </div>
            {recordingMeta.status === 'uploaded' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                <CheckCircle2 size={13} /> Private Upload Active
              </span>
            )}
            {recordingMeta.status === 'failed' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-full border border-red-100">
                <AlertCircle size={13} /> Upload Pending / Failed
              </span>
            )}
            {(recordingMeta.status === 'skipped' || recordingMeta.status === 'deleted') && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">
                {recordingMeta.status === 'skipped' ? 'Skipped' : 'Deleted'}
              </span>
            )}
          </div>

          {recordingMeta.status === 'uploaded' && (
            <div className="text-xs text-gray-600 space-y-2">
              <p className="font-mono text-[11px] bg-gray-50 p-2 rounded-lg border border-gray-100 break-all">
                Path: {recordingMeta.path || `speaking-recordings/${session.userId}/${session.id}/${recordingMeta.recordingId}.webm`}
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-gray-400 text-[11px] font-medium">Encrypted & Private to User Account</span>
                <button
                  id="delete-recording-btn"
                  onClick={handleDeleteRecording}
                  disabled={isActionPending}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 size={13} /> Delete Recording
                </button>
              </div>
            </div>
          )}

          {recordingMeta.status === 'failed' && (
            <div className="bg-red-50/50 border border-red-100 rounded-xl p-4 text-xs text-red-900 space-y-3">
              <p className="leading-relaxed">
                Recording upload encountered an issue: <strong>{recordingMeta.error || 'Network error'}</strong>. Your evaluation report and transcript are stored separately from the audio upload.
              </p>
              <p className="text-[11px] text-red-800 leading-relaxed">
                The original audio Blob is not retained after leaving the practice screen, so this page cannot safely retry it. Continue without audio or start a new session to record again.
              </p>
              {recordingActionError && (
                <p className="text-[11px] font-mono bg-red-100 border border-red-200 rounded-lg p-2">{recordingActionError}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  id="retry-upload-btn"
                  type="button"
                  disabled
                  title="The original recording is not retained after leaving the practice screen."
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-500 rounded-lg text-xs font-bold cursor-not-allowed"
                >
                  <RefreshCw size={13} />
                  Retry unavailable
                </button>
                <button
                  id="skip-recording-btn"
                  onClick={handleSkipRecordingUpload}
                  disabled={isActionPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-50 transition cursor-pointer disabled:opacity-50"
                >
                  <SkipForward size={13} />
                  Continue Without Audio
                </button>
                <button
                  id="delete-failed-recording-btn"
                  onClick={handleDeleteRecording}
                  disabled={isActionPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  Delete Recording
                </button>
              </div>
            </div>
          )}

          {(recordingMeta.status === 'skipped' || recordingMeta.status === 'deleted') && (
            <p className="text-xs text-gray-500 leading-relaxed">
              Audio recording was {recordingMeta.status}. The evaluation report and transcript remain saved in your account history.
            </p>
          )}
        </section>
      )}

      {/* Grid of 4 Core Scoring Categories */}
      <section aria-label="Core IELTS Criterion Scores" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Fluency */}
        <div className="border border-gray-100 bg-white rounded-2xl p-5 shadow-sm space-y-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Fluency & Coherence</span>
          <span className="text-3xl font-black text-[var(--hexa-navy)] block font-mono">{evaluation.criteria.fluencyAndCoherence.score.toFixed(1)}</span>
          <p className="text-[11px] text-gray-500 line-clamp-2 leading-normal pt-1">{evaluation.criteria.fluencyAndCoherence.feedback}</p>
        </div>

        {/* Lexical Resource */}
        <div className="border border-gray-100 bg-white rounded-2xl p-5 shadow-sm space-y-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Lexical Resource</span>
          <span className="text-3xl font-black text-[var(--hexa-navy)] block font-mono">{evaluation.criteria.lexicalResource.score.toFixed(1)}</span>
          <p className="text-[11px] text-gray-500 line-clamp-2 leading-normal pt-1">{evaluation.criteria.lexicalResource.feedback}</p>
        </div>

        {/* Grammar Range */}
        <div className="border border-gray-100 bg-white rounded-2xl p-5 shadow-sm space-y-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Grammatical Range</span>
          <span className="text-3xl font-black text-[var(--hexa-navy)] block font-mono">{evaluation.criteria.grammaticalRangeAccuracy.score.toFixed(1)}</span>
          <p className="text-[11px] text-gray-500 line-clamp-2 leading-normal pt-1">{evaluation.criteria.grammaticalRangeAccuracy.feedback}</p>
        </div>

        {/* Pronunciation */}
        <div className="border border-gray-100 bg-white rounded-2xl p-5 shadow-sm space-y-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Pronunciation</span>
          {isPronunciationAssumed ? (
            <div className="pt-1">
              <div className="flex items-end gap-2">
                <span className="text-3xl font-black text-[var(--hexa-navy)] block font-mono">{evaluation.criteria.pronunciation.score.toFixed(1)}</span>
                <span className="mb-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">Assumed</span>
              </div>
              <p className="text-[10px] text-amber-900 mt-2 leading-normal">Not audio-assessed</p>
            </div>
          ) : isPronunciationUnavailable ? (
            <div className="pt-1">
              <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md inline-block">
                Not Assessed
              </span>
              <p className="text-[10px] text-amber-900 mt-2 leading-normal">
                Audio evidence missing
              </p>
            </div>
          ) : (
            <>
              <span className="text-3xl font-black text-[var(--hexa-navy)] block font-mono">{evaluation.criteria.pronunciation.score.toFixed(1)}</span>
              <p className="text-[11px] text-gray-500 line-clamp-2 leading-normal pt-1">{evaluation.criteria.pronunciation.feedback}</p>
            </>
          )}
        </div>
      </section>

      {/* Pronunciation assumption / unavailable notice */}
      {isPronunciationAssumed && (
        <section aria-label="Pronunciation Assumption Notice" className="bg-amber-50/70 border border-amber-200 rounded-2xl p-5 space-y-2 text-xs text-amber-950">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-amber-700 shrink-0" />
            <h3 className="font-extrabold text-sm">Pronunciation Criterion: 6.0 Assumed</h3>
          </div>
          <p className="leading-relaxed">
            A default Band 6.0 is included in the provisional overall-band calculation because this evaluation currently uses transcript evidence rather than pronunciation audio analysis.
          </p>
          <p className="text-[11px] text-amber-900/80 italic pt-1">
            This 6.0 is a scoring assumption, not an observed pronunciation assessment.
          </p>
        </section>
      )}

      {isPronunciationUnavailable && (
        <section aria-label="Pronunciation Evidence Notice" className="bg-amber-50/70 border border-amber-200 rounded-2xl p-5 space-y-2 text-xs text-amber-950">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-amber-700 shrink-0" />
            <h3 className="font-extrabold text-sm">Pronunciation Criterion: Not Assessed</h3>
          </div>
          <p className="leading-relaxed">
            {evaluation.criteria.pronunciation.feedback || 'Pronunciation was not evaluated as raw audio recording evidence was unavailable for phonetics analysis.'}
          </p>
        </section>
      )}

      {/* Examiner Overview & Key Highlights */}
      <section aria-label="Examiner Assessment Note" className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-gray-950 text-base flex items-center gap-2">
          <Compass size={18} className="text-[var(--hexa-red)]" />
          <span>HEXA'S Speaking Assessment</span>
        </h2>
        <p className="text-gray-700 text-xs sm:text-sm leading-relaxed">{evaluation.examinerNote}</p>
      </section>

      {evaluation.partFeedback && evaluation.partFeedback.length > 0 && (
        <section aria-label="Part-by-Part Feedback" className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-5">
          <h2 className="font-bold text-gray-950 text-base flex items-center gap-2">
            <Layers size={18} className="text-[var(--hexa-red)]" />
            <span>Part-by-Part Feedback</span>
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {evaluation.partFeedback.map((part, idx) => (
              <article key={`${part.part}-${idx}`} className="rounded-2xl border border-gray-100 bg-gray-50/50 p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">IELTS Speaking</span>
                    <h3 className="text-sm font-extrabold text-gray-950">{part.part}</h3>
                  </div>
                </div>
                <p className="text-xs text-gray-700 leading-relaxed">{part.summary}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider mb-2">What worked</h4>
                    <ul className="space-y-1.5 text-xs text-gray-700">
                      {part.strengths.length > 0 ? part.strengths.map((item, itemIdx) => (
                        <li key={itemIdx} className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" /><span>{item}</span></li>
                      )) : <li className="text-gray-400 italic">No separate strength was identified for this part.</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-2">Improve next</h4>
                    <ul className="space-y-1.5 text-xs text-gray-700">
                      {part.improvements.length > 0 ? part.improvements.map((item, itemIdx) => (
                        <li key={itemIdx} className="flex items-start gap-2"><AlertCircle size={13} className="text-amber-600 shrink-0 mt-0.5" /><span>{item}</span></li>
                      )) : <li className="text-gray-400 italic">No separate improvement was identified for this part.</li>}
                    </ul>
                  </div>
                </div>
                {part.evidence.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Evidence from your answers</h4>
                    {part.evidence.map((item, itemIdx) => (
                      <div key={itemIdx} className="text-xs text-gray-700 bg-white border border-gray-100 rounded-xl p-3 leading-relaxed">{item}</div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Strong Moments & Highest-Priority Improvements */}
      <section aria-label="Strengths and Key Improvements" className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Strong Moments */}
        <div className="border border-emerald-100 bg-emerald-50/30 rounded-2xl p-6 space-y-3">
          <h2 className="font-bold text-emerald-950 text-sm flex items-center gap-2">
            <ThumbsUp size={16} className="text-emerald-600" />
            <span>Strong Moments (Strengths)</span>
          </h2>
          <ul className="space-y-2 text-xs text-emerald-950">
            {(evaluation.strengths && evaluation.strengths.length > 0 ? evaluation.strengths : [
              'Clear topic development and natural response pacing',
              'Effective task achievement across cue card points'
            ]).map((strength, idx) => (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                <span>{strength}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Highest-Priority Improvements */}
        <div className="border border-amber-100 bg-amber-50/30 rounded-2xl p-6 space-y-3">
          <h2 className="font-bold text-amber-950 text-sm flex items-center gap-2">
            <Zap size={16} className="text-amber-600" />
            <span>Highest-Priority Improvements</span>
          </h2>
          <ul className="space-y-2 text-xs text-amber-950">
            {(evaluation.priorities && evaluation.priorities.length > 0 ? evaluation.priorities : [
              'Expand grammatical complexity using subordinate clauses',
              'Upgrade basic adjectives to academic collocations'
            ]).map((priority, idx) => (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                <span>{priority}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Grammar Range & Accuracy Corrections */}
      <section aria-label="Grammar Corrections" className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-gray-950 text-base flex items-center gap-2">
          <AlertTriangle size={18} className="text-gray-400" />
          <span>Grammatical Range & Accuracy Corrections</span>
        </h2>
        <p className="text-gray-500 text-xs">{evaluation.criteria.grammaticalRangeAccuracy.feedback}</p>

        {evaluation.criteria.grammaticalRangeAccuracy.corrections.length > 0 ? (
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 font-bold text-gray-700">
                  <th scope="col" className="p-3 w-1/3">Detected Incorrect Syntax</th>
                  <th scope="col" className="p-3 w-1/3">Accurate Standard</th>
                  <th scope="col" className="p-3 w-1/3">Linguistic Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {evaluation.criteria.grammaticalRangeAccuracy.corrections.map((corr, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50">
                    <td className="p-3 text-red-600 font-medium font-mono text-[11px] bg-red-50/20">{corr.incorrect}</td>
                    <td className="p-3 text-emerald-700 font-semibold font-mono text-[11px] bg-emerald-50/20">{corr.correct}</td>
                    <td className="p-3 text-gray-600 leading-relaxed">{corr.ruleExplanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic bg-gray-50 p-3 rounded-xl">No major syntax errors detected in response transcript.</p>
        )}
      </section>

      {/* Vocabulary Upgrades (Lexical Resource) */}
      <section aria-label="Vocabulary Upgrades" className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-gray-950 text-base flex items-center gap-2">
          <ThumbsUp size={18} className="text-gray-400" />
          <span>Vocabulary & Collocation Upgrades</span>
        </h2>
        <p className="text-gray-500 text-xs">{evaluation.criteria.lexicalResource.feedback}</p>

        {evaluation.criteria.lexicalResource.improvedPhrases.length > 0 ? (
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 font-bold text-gray-700">
                  <th scope="col" className="p-3 w-1/3">Original Candidate Phrase</th>
                  <th scope="col" className="p-3 w-1/3">More Precise Alternative</th>
                  <th scope="col" className="p-3 w-1/3">Why It Is Better</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {evaluation.criteria.lexicalResource.improvedPhrases.map((phrase, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/50">
                    <td className="p-3 text-gray-700 font-medium line-through decoration-red-400">{phrase.original}</td>
                    <td className="p-3 text-emerald-700 font-bold">{phrase.improved}</td>
                    <td className="p-3 text-gray-600 leading-relaxed">{phrase.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic bg-gray-50 p-3 rounded-xl">Appropriate topic vocabulary demonstrated throughout.</p>
        )}
      </section>

      {/* Pronunciation Observations (When Assessed) */}
      {isPronunciationAssessed && (
        <section aria-label="Pronunciation Observations" className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="font-bold text-gray-950 text-base flex items-center gap-2">
            <Mic size={18} className="text-gray-400" />
            <span>Pronunciation Observations (Intelligibility, Rhythm & Stress)</span>
          </h2>
          <p className="text-gray-600 text-xs leading-relaxed">{evaluation.criteria.pronunciation.feedback}</p>

          {evaluation.criteria.pronunciation.problemWords.length > 0 && (
            <div className="space-y-2 pt-2">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">Phonetic Focus Words</span>
              <div className="flex flex-wrap gap-2">
                {evaluation.criteria.pronunciation.problemWords.map((word, idx) => (
                  <span key={idx} className="bg-red-50 border border-red-100 text-red-700 text-xs font-semibold px-3 py-1 rounded-full">
                    {word}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Evidence from Learner's Transcript */}
      <section aria-label="Transcript Evidence" className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-950 text-base flex items-center gap-2">
            <FileText size={18} className="text-gray-400" />
            <span>Transcript Evidence & Verified Quotes</span>
          </h2>
          {session.transcript && session.transcript.length > 0 && (
            <button
              onClick={() => setShowFullTranscript(prev => !prev)}
              className="text-xs font-semibold text-gray-600 hover:text-gray-950 underline cursor-pointer"
            >
              {showFullTranscript ? 'Hide Full Transcript' : 'View Full Session Transcript'}
            </button>
          )}
        </div>

        {/* Verified Quotes Evidence */}
        <div className="space-y-2">
          {evaluation.evidence && evaluation.evidence.length > 0 ? (
            evaluation.evidence.map((evItem, idx) => (
              <div key={idx} className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs text-gray-800 leading-relaxed font-sans">
                {/* SAFELY RENDERED AS PLAIN TEXT */}
                {String(evItem)}
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-500">Transcript responses verified against exam state machine rules.</p>
          )}
        </div>

        {/* Collapsible Full Transcript turns */}
        {showFullTranscript && session.transcript && (
          <div className="border-t border-gray-100 pt-4 space-y-3 max-h-96 overflow-y-auto pr-2 text-xs divide-y divide-gray-50">
            {session.transcript.map((turn, idx) => (
              <div key={turn.id || idx} className="pt-3 first:pt-0 space-y-1">
                <span className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
                  turn.speaker === 'examiner' ? 'text-blue-700' : 'text-emerald-700'
                }`}>
                  {turn.speaker}
                </span>
                <p className="text-gray-800 leading-relaxed font-sans">
                  {/* SAFELY RENDERED AS PLAIN TEXT */}
                  {turn.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Practical 7-Day Micro-Practice Plan Checklist */}
      <section aria-label="7-Day Micro-Practice Plan" className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h2 className="font-bold text-gray-950 text-base">Practical 7-Day Micro-Practice Plan</h2>
          <p className="text-gray-500 text-xs mt-1">Check off these targeted action items to track your preparation before your next mock exam.</p>
        </div>

        <div className="space-y-3">
          {evaluation.actionPlan.map((plan, idx) => {
            const isChecked = !!completedGoals[idx];
            return (
              <div
                key={idx}
                onClick={() => toggleGoal(idx)}
                className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-xl cursor-pointer transition border border-transparent hover:border-gray-100"
              >
                <button 
                  type="button"
                  aria-label={isChecked ? `Mark goal ${idx + 1} incomplete` : `Mark goal ${idx + 1} complete`}
                  className="text-gray-400 hover:text-gray-900 mt-0.5 shrink-0 focus:outline-none"
                >
                  {isChecked ? (
                    <CheckSquare size={18} className="text-emerald-600" />
                  ) : (
                    <Square size={18} />
                  )}
                </button>
                <span className={`text-xs font-medium leading-relaxed ${
                  isChecked ? 'text-gray-400 line-through' : 'text-gray-800'
                }`}>
                  {plan}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Full Session Metadata & Technical Audit */}
      <section aria-label="Session Metadata" className="border border-gray-100 bg-gray-50 rounded-2xl p-5 text-xs text-gray-600 space-y-3">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-gray-400" />
          <h3 className="font-bold text-gray-950">Practice Session Metadata & Pipeline Audit</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-mono">
          <div>
            <span className="text-gray-400 block font-sans text-[10px]">Session ID</span>
            <span className="text-gray-900 font-bold block truncate">{session.id}</span>
          </div>
          <div>
            <span className="text-gray-400 block font-sans text-[10px]">Test Topic</span>
            <span className="text-gray-900 font-bold block truncate">{session.topic}</span>
          </div>
          <div>
            <span className="text-gray-400 block font-sans text-[10px]">Completed Date</span>
            <span className="text-gray-900 font-bold block">{new Date(session.createdAt).toLocaleDateString()}</span>
          </div>
          <div>
            <span className="text-gray-400 block font-sans text-[10px]">Evaluator Model</span>
            <span className="text-gray-900 font-bold block">{evaluation?.evaluationModel || (evaluation?.evaluationEngine === 'sandbox' ? 'sandbox-deterministic' : 'gemini-3.6-flash')}</span>
          </div>
        </div>
      </section>

    </main>
  );
};

export default ResultsView;
