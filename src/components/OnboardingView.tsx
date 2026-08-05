/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../services/routerContext';
import { useAuth } from '../services/authContext';
import { Check, ShieldAlert, Mic, Volume2, User, Sliders, Languages, Globe, Calendar } from 'lucide-react';

export const OnboardingView: React.FC = () => {
  const { navigate } = useRouter();
  const { user, updateProfile } = useAuth();

  // Onboarding parameters state
  const [displayName, setDisplayName] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [currentEstimatedBand, setCurrentEstimatedBand] = useState<number | ''>('');
  const [targetBand, setTargetBand] = useState(7.0);
  const [examDate, setExamDate] = useState('');
  const [timezone, setTimezone] = useState('');

  // Device / Consent states
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [micLevel, setMicLevel] = useState(0);
  const [consentGranted, setConsentGranted] = useState(false);
  
  // UX State controllers
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (user) {
      if (user.displayName && !displayName) {
        setDisplayName(user.displayName);
      }
      if (!timezone) {
        setTimezone(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      }
    }
  }, [user]);

  useEffect(() => {
    // Cleanup audio context on unmount
    return () => {
      stopMicrophoneTest();
    };
  }, []);

  const requestMicPermission = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicPermission('granted');
      startMicrophoneTest(stream);
    } catch (err) {
      console.error('Microphone permissions rejected:', err);
      setMicPermission('denied');
      setError('Microphone permission was denied. Please update your browser permissions to allow audio recording.');
    }
  };

  const startMicrophoneTest = (stream: MediaStream) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        let total = 0;
        for (let i = 0; i < bufferLength; i++) {
          total += dataArray[i];
        }
        const average = total / bufferLength;
        setMicLevel(Math.min(100, Math.round((average / 128) * 100)));

        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (e) {
      console.warn('Web Audio API not fully compatible, falling back to mock mic level tracker.');
      let count = 0;
      const interval = setInterval(() => {
        if (streamRef.current) {
          setMicLevel(Math.floor(20 + Math.random() * 60));
        } else {
          clearInterval(interval);
        }
      }, 150);
    }
  };

  const stopMicrophoneTest = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setMicLevel(0);
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Strict UI validation logic
    if (!displayName.trim()) {
      setError('Please provide a Display Name to identify your profile logs.');
      return;
    }

    if (currentEstimatedBand !== '') {
      const parsed = parseFloat(currentEstimatedBand as any);
      if (isNaN(parsed) || parsed < 1.0 || parsed > 9.0 || parsed % 0.5 !== 0) {
        setError('Your current estimated band score must be a valid IELTS increment (e.g., 6.0, 6.5, 7.0).');
        return;
      }
    }

    if (targetBand < 5.0 || targetBand > 9.0 || targetBand % 0.5 !== 0) {
      setError('Please choose a valid target band score between 5.0 and 9.0.');
      return;
    }

    if (micPermission !== 'granted') {
      setError('Please complete the microphone calibration in Step 2 to ensure we can capture and analyze your voice.');
      return;
    }

    setSaving(true);
    try {
      // Clean up active sound checks
      stopMicrophoneTest();

      // Persist GDPR preference locally
      localStorage.setItem('speakready_recording_consent', consentGranted ? 'true' : 'false');

      // Update Firestore user profile securely (role cannot be hijacked as role is forced on firestore write)
      await updateProfile({
        displayName: displayName.trim(),
        nativeLanguage: nativeLanguage.trim() || undefined,
        currentEstimatedBand: currentEstimatedBand !== '' ? parseFloat(currentEstimatedBand as any) : undefined,
        targetBand,
        examDate: examDate || undefined,
        timezone: timezone || undefined,
        onboarded: true, // Unlocks access to the dashboard and routes!
      });

      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Could not save profile parameters. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="onboarding-view-container" className="min-h-[85vh] flex items-center justify-center py-12 px-4 font-sans select-none">
      <div className="max-w-2xl w-full bg-white border border-gray-100 shadow-2xl rounded-3xl p-8 sm:p-10 transition-all">
        
        {/* Onboarding Header */}
        <div className="mb-8">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">Profile Initiation</span>
          <h1 className="text-3xl font-black text-gray-950 mt-1 tracking-tight">Setup Your Candidate Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1.5 leading-relaxed">
            Configure your exam properties, personalize your display, and calibrate audio inputs to optimize evaluations.
          </p>
        </div>

        {error && (
          <div id="onboarding-error-banner" className="bg-red-50 border border-red-100 text-red-700 text-xs font-semibold px-4 py-3 rounded-2xl mb-6">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleCompleteOnboarding} className="space-y-6">

          {/* SECTION 1: Personal Parameters */}
          <div className="border border-gray-100 bg-gray-50/20 rounded-2xl p-6 space-y-4 text-left">
            <h3 className="font-bold text-gray-950 text-sm uppercase tracking-wider flex items-center gap-2 border-b border-gray-50 pb-2">
              <User size={16} className="text-gray-400" />
              <span>Step 1: Exam & Profile Parameters</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="onboard-name" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Display Name (Required)
                </label>
                <input
                  id="onboard-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                />
              </div>

              <div>
                <label htmlFor="onboard-lang" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Native Language (Optional)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                    <Languages size={14} />
                  </span>
                  <input
                    id="onboard-lang"
                    type="text"
                    value={nativeLanguage}
                    onChange={(e) => setNativeLanguage(e.target.value)}
                    placeholder="e.g. Mandarin, Spanish"
                    className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="onboard-exam-date" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Exam Date (Optional)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                    <Calendar size={14} />
                  </span>
                  <input
                    id="onboard-exam-date"
                    type="date"
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="onboard-timezone" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Timezone
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                    <Globe size={14} />
                  </span>
                  <input
                    id="onboard-timezone"
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="e.g. Asia/Singapore"
                    className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    Target IELTS Band (Required)
                  </label>
                  <span className="text-xs font-bold text-gray-950 bg-gray-100 px-2.5 py-0.5 rounded font-mono">
                    Band {targetBand.toFixed(1)}
                  </span>
                </div>
                <input
                  id="onboard-target-band"
                  type="range"
                  min="5.0"
                  max="9.0"
                  step="0.5"
                  value={targetBand}
                  onChange={(e) => setTargetBand(parseFloat(e.target.value))}
                  className="w-full accent-gray-950 cursor-pointer h-10"
                />
              </div>

              <div>
                <label htmlFor="onboard-est-band" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Current Estimated Band (Optional)
                </label>
                <select
                  id="onboard-est-band"
                  value={currentEstimatedBand}
                  onChange={(e) => setCurrentEstimatedBand(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                >
                  <option value="">Choose self-estimate...</option>
                  <option value="1.0">Band 1.0 (Non-user)</option>
                  <option value="1.5">Band 1.5</option>
                  <option value="2.0">Band 2.0 (Intermittent)</option>
                  <option value="2.5">Band 2.5</option>
                  <option value="3.0">Band 3.0 (Extremely Limited)</option>
                  <option value="3.5">Band 3.5</option>
                  <option value="4.0">Band 4.0 (Limited)</option>
                  <option value="4.5">Band 4.5</option>
                  <option value="5.0">Band 5.0 (Modest)</option>
                  <option value="5.5">Band 5.5</option>
                  <option value="6.0">Band 6.0 (Competent)</option>
                  <option value="6.5">Band 6.5</option>
                  <option value="7.0">Band 7.0 (Good)</option>
                  <option value="7.5">Band 7.5</option>
                  <option value="8.0">Band 8.0 (Very Good)</option>
                  <option value="8.5">Band 8.5</option>
                  <option value="9.0">Band 9.0 (Expert)</option>
                </select>
                <span className="text-[10px] text-gray-400 mt-1 block">
                  ℹ️ Band score estimates are personal self-estimates of your current capabilities.
                </span>
              </div>
            </div>
          </div>

          {/* SECTION 2: Devices calibration */}
          <div className="border border-gray-100 bg-gray-50/20 rounded-2xl p-6 text-left space-y-4">
            <h3 className="font-bold text-gray-950 text-sm uppercase tracking-wider flex items-center gap-2 border-b border-gray-50 pb-2">
              <Mic size={16} className="text-gray-400" />
              <span>Step 2: Microphone Calibration & GDPR</span>
            </h3>

            {/* Mic block */}
            <div className="flex items-start gap-4 bg-white border border-gray-100 rounded-xl p-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                micPermission === 'granted'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                  : 'bg-gray-50 text-gray-900 border-gray-100'
              }`}>
                {micPermission === 'granted' ? <Check size={18} /> : <Mic size={18} />}
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-gray-950 text-xs">Audio Recording Interface Access</h4>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                  We require authorization to capture audio stream fragments in real-time.
                </p>

                {micPermission !== 'granted' ? (
                  <button
                    id="request-mic-button"
                    type="button"
                    onClick={requestMicPermission}
                    className="mt-3 bg-gray-950 hover:bg-gray-800 text-white text-xs font-bold py-2 px-3.5 rounded-xl transition duration-150 cursor-pointer"
                  >
                    Authorize Mic Access
                  </button>
                ) : (
                  <div className="mt-3">
                    <div className="flex justify-between items-center text-[10px] font-bold text-gray-600 mb-1 font-mono">
                      <span className="flex items-center gap-1"><Volume2 size={10} /> Live Volume</span>
                      <span>{micLevel}%</span>
                    </div>
                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                      <div
                        id="mic-volume-level-bar"
                        className="bg-emerald-500 h-full transition-all duration-75"
                        style={{ width: `${micLevel}%` }}
                      ></div>
                    </div>
                    <span className="text-[10px] text-emerald-600 font-bold block mt-1">
                      ✓ Input initialized and calibrated.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* GDPR Consent */}
            <div className="flex items-start gap-4 bg-white border border-gray-100 rounded-xl p-4">
              <div className="w-10 h-10 bg-gray-50 text-gray-900 border border-gray-100 rounded-xl flex items-center justify-center shrink-0">
                <ShieldAlert size={18} className="text-gray-500" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-gray-950 text-xs">GDPR & Raw Audio Persistence</h4>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                  Decide how you prefer your speakings to be stored.
                </p>
                <label className="flex items-start gap-3 mt-3 cursor-pointer">
                  <input
                    id="gdpr-consent-checkbox"
                    type="checkbox"
                    checked={consentGranted}
                    onChange={(e) => setConsentGranted(e.target.checked)}
                    className="mt-0.5 accent-gray-950 w-4 h-4 cursor-pointer"
                  />
                  <span className="text-[11px] text-gray-600 leading-normal">
                    I explicitly consent to retain my speaking responses securely in private Cloud Storage for personal feedback audio playbacks. I understand that I can withdraw this consent anytime.
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Action button */}
          <button
            id="complete-onboarding-button"
            type="submit"
            disabled={saving}
            className="w-full bg-gray-950 hover:bg-gray-800 disabled:bg-gray-400 text-white font-bold py-4 px-4 rounded-2xl transition duration-150 cursor-pointer shadow-lg shadow-gray-100 flex justify-center items-center gap-2 min-h-[44px] text-sm"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <span>Unlock Classroom Dashboard</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
export default OnboardingView;
