/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAudioController } from '../services/useAudioController';
import {
  Mic,
  MicOff,
  Volume2,
  Disc,
  Square,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Play,
  RefreshCw,
  AlertTriangle,
  Radio,
  Sliders
} from 'lucide-react';

interface AudioControllerPanelProps {
  initialConsent?: boolean;
  onConsentChange?: (consent: boolean) => void;
  className?: string;
}

export const AudioControllerPanel: React.FC<AudioControllerPanelProps> = ({
  initialConsent = false,
  onConsentChange,
  className = ''
}) => {
  const {
    deviceState,
    recordingState,
    inputLevel,
    startMic,
    stopMic,
    toggleMute,
    startRecord,
    stopRecord,
    deleteRecord,
    setConsent,
    playChunk,
    clearQueue
  } = useAudioController({
    userConsentForRecording: initialConsent
  });

  const [isPlayingTestTone, setIsPlayingTestTone] = useState(false);

  const handleConsentToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setConsent(val);
    if (onConsentChange) {
      onConsentChange(val);
    }
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = e.target.value;
    startMic(deviceId);
  };

  const handleTestRemoteQueuePlayback = async () => {
    setIsPlayingTestTone(true);
    // Generate a 440Hz sine wave AudioBuffer chunk simulating examiner voice arrival
    const sampleRate = 24000;
    const durationSec = 1.0;
    const numSamples = sampleRate * durationSec;
    const pcmData = new Int16Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Fade in / out to avoid clicks
      const envelope = Math.sin((Math.PI * i) / numSamples);
      const sampleFloat = Math.sin(2 * Math.PI * 440 * t) * 0.3 * envelope;
      pcmData[i] = Math.floor(sampleFloat * 32767);
    }

    await playChunk(pcmData, sampleRate);
    setTimeout(() => setIsPlayingTestTone(false), 1200);
  };

  return (
    <div
      id="browser-audio-controller-panel"
      className={`bg-white border border-gray-100 rounded-3xl p-6 shadow-sm space-y-6 ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-50 pb-4">
        <div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">Web Audio Engine</span>
          <h3 className="text-base font-extrabold text-gray-950 tracking-tight flex items-center gap-2">
            <Mic className="text-gray-900" size={18} />
            <span>Browser Audio Controller</span>
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border font-mono ${
              deviceState.permissionState === 'granted'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : deviceState.permissionState === 'denied'
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            Permission: {deviceState.permissionState}
          </span>
        </div>
      </div>

      {/* Microphone Controls & Meter */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Device Selector */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono">
              Input Microphone Device
            </label>
            <select
              id="audio-device-select"
              value={deviceState.selectedDeviceId || ''}
              onChange={handleDeviceChange}
              disabled={deviceState.permissionState === 'denied'}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-950 font-medium"
            >
              {deviceState.devices.length === 0 ? (
                <option value="">Default Microphone</option>
              ) : (
                deviceState.devices.map((device, idx) => (
                  <option key={device.deviceId || idx} value={device.deviceId}>
                    {device.label || `Microphone ${idx + 1}`}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Start/Stop & Mute Actions */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono">
              Stream Control Actions
            </label>
            <div className="flex items-center gap-2">
              {deviceState.permissionState !== 'granted' ? (
                <button
                  id="start-mic-btn"
                  onClick={() => startMic()}
                  className="flex-1 bg-gray-950 hover:bg-gray-800 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Radio size={14} />
                  <span>Request Mic Stream</span>
                </button>
              ) : (
                <>
                  <button
                    id="toggle-mute-btn"
                    onClick={toggleMute}
                    className={`flex-1 text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      deviceState.isMuted
                        ? 'bg-amber-500 hover:bg-amber-600 text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                    }`}
                  >
                    {deviceState.isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                    <span>{deviceState.isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
                  </button>

                  <button
                    id="stop-mic-btn"
                    onClick={stopMic}
                    className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-bold py-2.5 px-3 rounded-xl transition cursor-pointer"
                  >
                    Release Mic
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Input Volume Level Meter Bar */}
        <div className="space-y-1.5 bg-gray-50 border border-gray-100 p-3.5 rounded-2xl">
          <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider font-mono text-gray-500">
            <span className="flex items-center gap-1">
              <Volume2 size={13} className={inputLevel > 0 ? 'text-emerald-500' : 'text-gray-400'} />
              <span>Input Signal Level</span>
            </span>
            <span className="text-gray-900">{inputLevel}%</span>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden flex">
            <div
              className={`h-full transition-all duration-75 ${
                inputLevel > 75
                  ? 'bg-amber-500'
                  : inputLevel > 15
                  ? 'bg-emerald-500'
                  : 'bg-gray-400'
              }`}
              style={{ width: `${inputLevel}%` }}
            ></div>
          </div>
        </div>

        {deviceState.error && (
          <div className="bg-red-50 border border-red-100 p-3 rounded-xl text-xs text-red-600 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{deviceState.error}</span>
          </div>
        )}
      </div>

      {/* Remote Examiner Audio Queue Control */}
      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono">
            Remote Examiner Queue Playback
          </span>
          <button
            id="clear-audio-queue-btn"
            onClick={clearQueue}
            className="text-[10px] text-gray-400 hover:text-gray-700 font-mono font-bold underline cursor-pointer"
          >
            Clear Queue
          </button>
        </div>

        <button
          id="test-remote-playback-btn"
          onClick={handleTestRemoteQueuePlayback}
          disabled={isPlayingTestTone}
          className="w-full bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-900 text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
        >
          <Volume2 size={14} className={isPlayingTestTone ? 'text-emerald-600 animate-bounce' : 'text-gray-500'} />
          <span>{isPlayingTestTone ? 'Playing Remote Audio Chunk...' : 'Test Examiner Audio Queue Playback (24kHz)'}</span>
        </button>
      </div>

      {/* Optional Local Session Recording Controls */}
      <div className="border-t border-gray-100 pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-gray-400" />
            <label htmlFor="recording-consent-checkbox" className="text-xs font-bold text-gray-900 cursor-pointer">
              Optional Local Session Audio Recording
            </label>
          </div>
          <input
            id="recording-consent-checkbox"
            type="checkbox"
            checked={recordingState.consentGiven}
            onChange={handleConsentToggle}
            className="w-4 h-4 rounded border-gray-300 text-gray-950 focus:ring-gray-950 cursor-pointer"
          />
        </div>

        {!recordingState.isSupported ? (
          <p className="text-[11px] text-gray-400 italic">
            Local session recording is not supported on this browser context. Session will proceed normally without local audio storage.
          </p>
        ) : !recordingState.consentGiven ? (
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Enable recording consent above if you wish to record your practice session locally in browser memory for self-review.
          </p>
        ) : (
          <div className="bg-gray-50 border border-gray-100 p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-gray-700 font-mono text-[10px] uppercase tracking-wider">
                Local Session Recorder
              </span>
              <span className="text-[10px] font-mono text-gray-400">
                Format: {recordingState.mimeType || 'default'}
              </span>
            </div>

            {/* Recording Indicator & Controls */}
            <div className="flex items-center gap-3">
              {recordingState.isRecording ? (
                <>
                  <div className="flex items-center gap-2 text-xs font-bold text-red-600 font-mono bg-red-50 border border-red-200 px-3 py-1.5 rounded-xl">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping"></span>
                    <span>REC 00:{recordingState.durationSeconds < 10 ? `0${recordingState.durationSeconds}` : recordingState.durationSeconds}</span>
                  </div>

                  <button
                    id="stop-local-record-btn"
                    onClick={() => stopRecord()}
                    className="bg-gray-950 hover:bg-gray-800 text-white text-xs font-bold py-2 px-4 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Square size={12} />
                    <span>Stop Recording</span>
                  </button>
                </>
              ) : (
                <button
                  id="start-local-record-btn"
                  onClick={() => startRecord()}
                  disabled={deviceState.permissionState !== 'granted'}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-bold py-2 px-4 rounded-xl transition cursor-pointer flex items-center gap-1.5"
                >
                  <Disc size={13} />
                  <span>Start Local Recording</span>
                </button>
              )}
            </div>

            {/* Local Playback Player */}
            {recordingState.recordingUrl && (
              <div className="pt-2 border-t border-gray-200/60 space-y-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono block">
                  Local Recording Playback Review
                </span>
                <audio
                  id="local-recording-audio-player"
                  controls
                  src={recordingState.recordingUrl}
                  className="w-full h-8 rounded-lg"
                />

                <div className="flex justify-end pt-1">
                  <button
                    id="delete-local-record-btn"
                    onClick={deleteRecord}
                    className="text-xs text-red-600 hover:text-red-700 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete Local Recording</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioControllerPanel;
