/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mic,
  Trash2,
  FileText,
  AlertTriangle,
  Check,
  RefreshCw,
  Eye,
  Info
} from 'lucide-react';
import { getFirebaseRepository } from '../services/firebaseRepository';

interface PrivacySettingsViewProps {
  userId?: string;
  userConsent: boolean;
  onConsentChange: (consent: boolean) => void;
  onNavigateHome?: () => void;
}

export const PrivacySettingsView: React.FC<PrivacySettingsViewProps> = ({
  userId = 'mock-user-id',
  userConsent,
  onConsentChange,
  onNavigateHome
}) => {
  const [isDeletingRecordings, setIsDeletingRecordings] = useState(false);
  const [isDeletingAllData, setIsDeletingAllData] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<'recordings' | 'all' | null>(null);

  const handleToggleConsent = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newConsent = e.target.checked;
    onConsentChange(newConsent);
    setStatusMessage({
      type: 'info',
      text: newConsent
        ? 'Audio recording consent enabled. Practice audio will be privately stored for your review.'
        : 'Audio recording consent disabled. Practice audio will be discarded immediately upon session end.'
    });
  };

  const handlePurgeRecordings = async () => {
    setIsDeletingRecordings(true);
    setStatusMessage(null);
    try {
      const repo = getFirebaseRepository();
      // Purge storage audio files for user
      await repo.deleteSessionRecordingsForUser(userId);
      setStatusMessage({
        type: 'success',
        text: 'Successfully deleted all stored voice recordings from private cloud storage.'
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to delete voice recordings. Please try again.'
      });
    } finally {
      setIsDeletingRecordings(false);
      setShowConfirmModal(null);
    }
  };

  const handlePurgeAllData = async () => {
    setIsDeletingAllData(true);
    setStatusMessage(null);
    try {
      const repo = getFirebaseRepository();
      // Purge all practice data for user
      await repo.deleteUserData(userId);
      setStatusMessage({
        type: 'success',
        text: 'Successfully purged all practice history, transcripts, and evaluation reports.'
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to purge practice history. Please try again.'
      });
    } finally {
      setIsDeletingAllData(false);
      setShowConfirmModal(null);
    }
  };

  return (
    <div id="privacy-settings-page" className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold text-sm mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Privacy & Data Protection</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            Privacy & Data Controls
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
            Manage your stored IELTS practice data, audio recording preferences, and privacy settings.
          </p>
        </div>
        {onNavigateHome && (
          <button
            id="privacy-back-home-btn"
            onClick={onNavigateHome}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors self-start sm:self-auto"
          >
            Back to Dashboard
          </button>
        )}
      </div>

      {/* Status Alert Message */}
      {statusMessage && (
        <div
          id="privacy-status-alert"
          className={`p-4 rounded-xl border flex items-start gap-3 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : statusMessage.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
          }`}
        >
          {statusMessage.type === 'success' && <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
          {statusMessage.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
          {statusMessage.type === 'info' && <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />}
          <p className="text-sm">{statusMessage.text}</p>
        </div>
      )}

      {/* Section 1: Data Storage Transparency */}
      <div id="data-transparency-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Data Collection & Storage Transparency</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Clear breakdown of what data is saved and how it is processed.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
              <FileText className="w-4 h-4 text-indigo-500" />
              <span>Transcripts & Scores</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Spoken transcripts and AI-generated practice evaluations are saved under your user ID to provide practice history and progress tracking across sessions.
            </p>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
              <Eye className="w-4 h-4 text-indigo-500" />
              <span>AI Evaluation Privacy</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Your test inputs are processed strictly for diagnostic IELTS practice scoring. The app sends session inputs to the configured AI provider only to generate the requested practice response and evaluation. Provider processing remains subject to the provider account and data-use terms.
            </p>
          </div>
        </div>
      </div>

      {/* Section 2: Audio Recording Consent Controls */}
      <div id="recording-consent-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <Mic className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Microphone Recording Consent</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Control whether raw audio recordings are stored for personal review.</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="space-y-1 pr-4">
            <div className="font-medium text-slate-900 dark:text-white text-sm">
              Store Microphone Audio Recordings
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              When enabled, WebM audio files are securely saved to your private Cloud Storage bucket path (`speaking-recordings/{`{uid}`}/{`{sessionId}`}`). When disabled, live audio is used solely during the exam stream and discarded immediately.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              id="recording-consent-toggle"
              type="checkbox"
              checked={userConsent}
              onChange={handleToggleConsent}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>
      </div>

      {/* Section 3: Data Deletion Controls */}
      <div id="data-erasure-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-xl">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Data Erasure & Purge Controls</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Permanently remove stored practice records or audio files.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 border border-rose-200 dark:border-rose-900/40 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 space-y-3 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Purge Voice Recordings Only</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Deletes all audio files stored in private Cloud Storage while keeping written transcripts and practice evaluation scores intact.
              </p>
            </div>
            <button
              id="purge-recordings-btn"
              onClick={() => setShowConfirmModal('recordings')}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 self-start"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Audio Recordings</span>
            </button>
          </div>

          <div className="p-4 border border-rose-200 dark:border-rose-900/40 rounded-xl bg-rose-50/50 dark:bg-rose-950/20 space-y-3 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Purge All Practice Data</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Permanently deletes all practice sessions, speech transcripts, evaluation scores, and stored audio files associated with your user account.
              </p>
            </div>
            <button
              id="purge-all-data-btn"
              onClick={() => setShowConfirmModal('all')}
              className="px-4 py-2 bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 self-start"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge All Practice Data</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Confirm Data Erasure
              </h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {showConfirmModal === 'recordings'
                ? 'Are you sure you want to delete all stored audio recordings? Written transcripts and evaluation scores will be retained.'
                : 'Are you sure you want to permanently delete all practice sessions, transcripts, and evaluation history? This action cannot be undone.'}
            </p>
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setShowConfirmModal(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={showConfirmModal === 'recordings' ? handlePurgeRecordings : handlePurgeAllData}
                disabled={isDeletingRecordings || isDeletingAllData}
                className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                {(isDeletingRecordings || isDeletingAllData) && <RefreshCw className="w-4 h-4 animate-spin" />}
                <span>Confirm Purge</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
