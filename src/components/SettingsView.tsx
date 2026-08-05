/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from '../services/routerContext';
import { useAuth } from '../services/authContext';
import { ArrowLeft, Check, LogOut, ShieldAlert, Sparkles, Sliders, User, Calendar, Globe, Languages } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { AudioControllerPanel } from './AudioControllerPanel';

export const SettingsView: React.FC = () => {
  const { navigate } = useRouter();
  const { user, signOut, updateProfile } = useAuth();
  
  const [useMocks, setUseMocks] = useState(APP_CONFIG.useMocks);
  const [consent, setConsent] = useState(localStorage.getItem('speakready_recording_consent') === 'true');
  
  // Profile settings
  const [displayName, setDisplayName] = useState('');
  const [nativeLanguage, setNativeLanguage] = useState('');
  const [currentEstimatedBand, setCurrentEstimatedBand] = useState<number | ''>('');
  const [targetBand, setTargetBand] = useState(7.0);
  const [examDate, setExamDate] = useState('');
  const [timezone, setTimezone] = useState('');

  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setNativeLanguage(user.nativeLanguage || '');
      setCurrentEstimatedBand(user.currentEstimatedBand || '');
      setTargetBand(user.targetBand || 7.0);
      setExamDate(user.examDate || '');
      setTimezone(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    }
  }, [user]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError('');
    setIsSaved(false);

    // Validate Display Name
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }

    // Validate Estimated Band (Optional)
    if (currentEstimatedBand !== '') {
      const val = parseFloat(currentEstimatedBand as any);
      if (isNaN(val) || val < 1.0 || val > 9.0 || val % 0.5 !== 0) {
        setError('Current Estimated Band must be a valid IELTS score between 1.0 and 9.0 in steps of 0.5.');
        return;
      }
    }

    // Validate Target Band (Required)
    if (targetBand < 5.0 || targetBand > 9.0 || targetBand % 0.5 !== 0) {
      setError('Target IELTS Band must be a valid score between 5.0 and 9.0 in steps of 0.5.');
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        nativeLanguage: nativeLanguage.trim() || undefined,
        currentEstimatedBand: currentEstimatedBand !== '' ? parseFloat(currentEstimatedBand as any) : undefined,
        targetBand,
        examDate: examDate || undefined,
        timezone: timezone || undefined,
      });

      // Apply the mode immediately and persist it for future reloads.
      APP_CONFIG.useMocks = useMocks;
      localStorage.setItem('speakready_use_mocks_flag_v1_0_5', useMocks ? 'true' : 'false');
      
      // Save consent
      localStorage.setItem('speakready_recording_consent', consent ? 'true' : 'false');

      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to apply your profile updates.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  if (!user) return null;

  return (
    <div id="settings-view-container" className="max-w-2xl mx-auto py-8 px-4 font-sans space-y-6">
      
      {/* Back button */}
      <button
        onClick={() => navigate('/dashboard')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 cursor-pointer transition duration-150 py-1"
      >
        <ArrowLeft size={14} /> Back to Dashboard
      </button>

      <div className="mb-8 text-left">
        <h1 className="text-3xl font-black text-gray-950 tracking-tight">System Preferences</h1>
        <p className="text-gray-500 text-sm mt-1">Calibrate audio nodes, update your IELTS parameters, and manage your account credentials.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <form onSubmit={handleSaveSettings} className="space-y-6 text-left">
        
        {/* Profile Settings */}
        <div className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-5">
          <h3 className="font-bold text-gray-950 text-base flex items-center gap-2 border-b border-gray-50 pb-3">
            <User size={18} className="text-gray-400" />
            <span>Profile & Account Credentials</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="settings-name" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Display Name (Required)
              </label>
              <input
                id="settings-name"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Candidate Name"
                className="w-full px-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
              />
            </div>

            <div>
              <label htmlFor="settings-lang" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Native Language (Optional)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <Languages size={14} />
                </span>
                <input
                  id="settings-lang"
                  type="text"
                  value={nativeLanguage}
                  onChange={(e) => setNativeLanguage(e.target.value)}
                  placeholder="e.g. Spanish, Mandarin"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="settings-exam-date" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Exam Date (Optional)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <Calendar size={14} />
                </span>
                <input
                  id="settings-exam-date"
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                />
              </div>
            </div>

            <div>
              <label htmlFor="settings-timezone" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Timezone (Optional)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <Globe size={14} />
                </span>
                <input
                  id="settings-timezone"
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="e.g. UTC, Asia/Tokyo"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Target Goal Calibration */}
        <div className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-gray-950 text-base flex items-center gap-2 border-b border-gray-50 pb-3">
            <Sliders size={18} className="text-gray-400" />
            <span>IELTS Goal & Score Estimates</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Target IELTS Band (Required)
                </label>
                <span className="text-xs font-bold text-gray-950 bg-gray-100 px-2 py-0.5 rounded font-mono">
                  Band {targetBand.toFixed(1)}
                </span>
              </div>
              <input
                id="settings-target-band-range"
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
              <label htmlFor="settings-estimated-band" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Current Estimated Band (Optional)
              </label>
              <select
                id="settings-estimated-band"
                value={currentEstimatedBand}
                onChange={(e) => setCurrentEstimatedBand(e.target.value === '' ? '' : parseFloat(e.target.value))}
                className="w-full px-4 py-2.5 bg-gray-50/50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-950/10 focus:border-gray-950 transition text-gray-900"
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
                This band score is a personal self-estimate of your current conversational fluency.
              </span>
            </div>
          </div>
        </div>

        {/* Mock Toggle */}
        <div className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-gray-950 text-base flex items-center gap-2 border-b border-gray-50 pb-3">
            <Sparkles size={18} className="text-gray-400" />
            <span>AI Sandbox Settings</span>
          </h3>

          <div className="bg-gray-50/60 rounded-xl p-4 border border-gray-100 flex items-start gap-3">
            <input
              id="settings-mock-toggle"
              type="checkbox"
              checked={useMocks}
              onChange={(e) => setUseMocks(e.target.checked)}
              className="mt-1 accent-gray-950 w-4 h-4 cursor-pointer"
            />
            <div>
              <label htmlFor="settings-mock-toggle" className="text-xs font-bold text-gray-950 block cursor-pointer">
                Enable Simulated Mock Examiner Mode
              </label>
              <span className="text-[10px] text-gray-500 leading-normal block mt-1">
                When active, the browser runs offline using a keyboard-driven simulated examiner, allowing quick verification without requiring Gemini Live credits or Firebase configurations.
              </span>
            </div>
          </div>
        </div>

        {/* Browser Audio Controller Panel */}
        <AudioControllerPanel
          initialConsent={consent}
          onConsentChange={(val) => setConsent(val)}
        />

        {/* GDPR Privacy preferences */}
        <div className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-gray-950 text-base flex items-center gap-2 border-b border-gray-50 pb-3">
            <ShieldAlert size={18} className="text-gray-400" />
            <span>GDPR & Audio Storage</span>
          </h3>

          <div className="flex items-start gap-3 p-1">
            <input
              id="settings-consent-toggle"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 accent-gray-950 w-4 h-4 cursor-pointer"
            />
            <div>
              <label htmlFor="settings-consent-toggle" className="text-xs font-bold text-gray-950 block cursor-pointer">
                Retain My Speaking Audios
              </label>
              <span className="text-[10px] text-gray-500 leading-normal block mt-1">
                Store raw audio buffers in private, highly secured Cloud Storage. If unchecked, your audio is processed fully in-memory and discarded immediately upon session completion.
              </span>
            </div>
          </div>
        </div>

        {/* Quick System specs */}
        <div className="border border-gray-100 bg-white rounded-2xl p-6 shadow-sm text-xs space-y-2.5 text-gray-500">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Build Environment Specifications</span>
          <div className="flex justify-between">
            <span>Core Model</span>
            <span className="font-mono text-gray-900 font-medium">{APP_CONFIG.geminiVoiceModel}</span>
          </div>
          <div className="flex justify-between">
            <span>Evaluation Model</span>
            <span className="font-mono text-gray-900 font-medium">{APP_CONFIG.geminiEvaluationModel}</span>
          </div>
          <div className="flex justify-between">
            <span>WebSocket Gateway</span>
            <span className="font-mono text-gray-900 font-medium text-right break-all">wss://generativelanguage.googleapis.com/*</span>
          </div>
        </div>

        {/* Save actions */}
        <div className="flex flex-col sm:flex-row gap-4 pt-2">
          <button
            id="settings-save-button"
            type="submit"
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-950 hover:bg-gray-800 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-xl transition cursor-pointer min-h-[44px]"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <>
                {isSaved ? <Check size={16} /> : null}
                <span>{isSaved ? 'Settings Applied Successfully' : 'Apply Settings'}</span>
              </>
            )}
          </button>

          <button
            id="settings-logout-button"
            type="button"
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 border border-red-100 hover:bg-red-50 text-red-600 font-semibold py-3 px-6 rounded-xl transition cursor-pointer min-h-[44px]"
          >
            <LogOut size={16} />
            <span>Sign Out Profile</span>
          </button>
        </div>

      </form>
    </div>
  );
};
export default SettingsView;
