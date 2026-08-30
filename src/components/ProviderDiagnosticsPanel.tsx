/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { RealtimeVoiceProvider, ProviderDiagnostics } from '../realtime/voiceContract';
import {
  Activity,
  Radio,
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  Zap,
  ChevronDown,
  ChevronUp,
  Terminal,
  Clock,
  Shield,
  Layers,
  Send,
  X
} from 'lucide-react';

interface ProviderDiagnosticsPanelProps {
  provider: RealtimeVoiceProvider | null;
  className?: string;
}

export const ProviderDiagnosticsPanel: React.FC<ProviderDiagnosticsPanelProps> = ({
  provider,
  className = ''
}) => {
  const isDev = import.meta.env.DEV;

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'transcripts' | 'logs'>('overview');
  const [diagnostics, setDiagnostics] = useState<ProviderDiagnostics | null>(null);
  const [testText, setTestText] = useState('');
  const [logFilter, setLogFilter] = useState<string>('all');

  useEffect(() => {
    if (!isDev || !provider) {
      setDiagnostics(null);
      return;
    }

    const interval = setInterval(() => {
      if (provider && provider.getDiagnostics) {
        setDiagnostics(provider.getDiagnostics());
      } else {
        setDiagnostics(null);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [provider, isDev]);

  if (!isDev) return null;

  const handleReconnect = async () => {
    if (provider && provider.reconnect) {
      await provider.reconnect();
    }
  };

  const handleDisconnect = async () => {
    if (provider) {
      await provider.disconnect();
    }
  };

  const handleSendTestMessage = () => {
    if (provider && testText.trim()) {
      provider.sendTextMessage(testText.trim());
      setTestText('');
    }
  };

  const toggleInterruption = () => {
    if (provider && provider.setAllowInterruption && diagnostics) {
      provider.setAllowInterruption(!diagnostics.canInterrupt);
    }
  };

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  const filteredLogs = diagnostics?.rawEventLog.filter((item) => {
    if (logFilter === 'all') return true;
    return item.type === logFilter;
  }) || [];

  return (
    <div className={`fixed bottom-4 right-4 z-50 font-sans text-xs ${className}`}>
      {/* Floating Toggle Badge */}
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-slate-900 text-slate-100 rounded-full shadow-lg border border-slate-700 hover:bg-slate-800 transition-all cursor-pointer"
          title="Open Realtime Voice Diagnostics Panel"
        >
          <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span className="font-medium text-slate-200">Live Diagnostics</span>
          {diagnostics && (
            <span
              className={`w-2 h-2 rounded-full ${
                diagnostics.status === 'connected'
                  ? 'bg-emerald-500'
                  : diagnostics.status === 'connecting'
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
            />
          )}
        </button>
      ) : (
        /* Expanded Diagnostics Modal / Card */
        <div className="w-[340px] sm:w-[420px] max-w-[calc(100vw-2rem)] bg-slate-900/95 backdrop-blur-md text-slate-200 rounded-xl shadow-2xl border border-slate-800 flex flex-col max-h-[85vh] overflow-hidden">
          {/* Header */}
          <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <div>
                <h4 className="font-semibold text-slate-100 text-sm leading-tight">
                  {diagnostics?.providerName || 'Provider Diagnostics'}
                </h4>
                <p className="text-[10px] text-slate-400">Development Mode Inspector</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 ${
                  diagnostics?.status === 'connected'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                    : diagnostics?.status === 'connecting'
                    ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                    : 'bg-rose-950 text-rose-400 border border-rose-800/60'
                }`}
              >
                {diagnostics?.status === 'connected' ? (
                  <Wifi className="w-3 h-3" />
                ) : (
                  <WifiOff className="w-3 h-3" />
                )}
                {diagnostics?.status.toUpperCase() || 'OFFLINE'}
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 bg-slate-950/40">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex-1 py-2 text-center font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'overview'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900/50'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('transcripts')}
              className={`flex-1 py-2 text-center font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'transcripts'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900/50'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Stream ({diagnostics?.transcriptLog.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex-1 py-2 text-center font-medium border-b-2 transition-colors cursor-pointer ${
                activeTab === 'logs'
                  ? 'border-emerald-500 text-emerald-400 bg-slate-900/50'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Raw Logs
            </button>
          </div>

          {/* Body Content */}
          <div className="p-3 overflow-y-auto space-y-3 flex-1">
            {/* Warning Banner */}
            {diagnostics?.hasWarning && (
              <div className="p-2.5 bg-amber-950/80 border border-amber-800/80 rounded-lg text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-amber-300">Session Boundary Alert</p>
                  <p className="text-[11px] leading-relaxed">{diagnostics.warningMessage}</p>
                </div>
              </div>
            )}

            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-3">
                {/* Configuration Metrics Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">Model</span>
                    <span className="font-mono text-slate-200 truncate block">
                      {diagnostics?.model || 'N/A'}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">Voice</span>
                    <span className="font-mono text-slate-200 block">
                      {diagnostics?.voiceName || 'N/A'}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">Session Duration</span>
                    <span className="font-mono text-emerald-400 font-semibold block">
                      {formatDuration(diagnostics?.sessionDurationSeconds || 0)} / 15:00
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 block text-[10px]">Reconnect Count</span>
                    <span className="font-mono text-slate-200 block">
                      {diagnostics?.reconnectCount || 0}
                    </span>
                  </div>
                </div>

                {/* Packet & Token Statistics */}
                <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800 space-y-2">
                  <h5 className="font-semibold text-slate-300 flex items-center justify-between">
                    <span>Transport Statistics</span>
                    {diagnostics?.lastPingMs !== null && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        Ping: {diagnostics.lastPingMs}ms
                      </span>
                    )}
                  </h5>
                  <div className="grid grid-cols-3 gap-1 text-center font-mono text-[11px]">
                    <div className="p-1 bg-slate-900 rounded">
                      <span className="text-slate-500 block text-[9px]">SENT</span>
                      <span className="text-slate-200">{diagnostics?.packetsSent || 0}</span>
                    </div>
                    <div className="p-1 bg-slate-900 rounded">
                      <span className="text-slate-500 block text-[9px]">RECV</span>
                      <span className="text-slate-200">{diagnostics?.packetsReceived || 0}</span>
                    </div>
                    <div className="p-1 bg-slate-900 rounded">
                      <span className="text-slate-500 block text-[9px]">TOKENS</span>
                      <span className="text-amber-400">{diagnostics?.usage.totalTokens || 0}</span>
                    </div>
                  </div>
                </div>

                {/* Interruption Controls */}
                <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-200 block">Barge-in / Interruption</span>
                    <span className="text-[10px] text-slate-400">Exam engine allowed flag</span>
                  </div>
                  <button
                    onClick={toggleInterruption}
                    className={`px-3 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      diagnostics?.canInterrupt
                        ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {diagnostics?.canInterrupt ? 'Allowed' : 'Blocked'}
                  </button>
                </div>

                {/* Manual Test Transmission */}
                <div className="space-y-1.5">
                  <span className="font-semibold text-slate-300 text-[11px]">Send Diagnostic Test Input</span>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendTestMessage()}
                      placeholder="Type test candidate message..."
                      className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={handleSendTestMessage}
                      className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold px-3 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Send className="w-3 h-3" />
                      Send
                    </button>
                  </div>
                </div>

                {/* Transport Actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleReconnect}
                    className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reconnect
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="flex-1 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 font-medium rounded flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <WifiOff className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: TRANSCRIPT STREAM */}
            {activeTab === 'transcripts' && (
              <div className="space-y-2">
                {diagnostics?.transcriptLog.length === 0 ? (
                  <p className="text-slate-500 text-center py-6 italic">No transcript chunks received yet.</p>
                ) : (
                  <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                    {diagnostics?.transcriptLog.map((item) => (
                      <div
                        key={item.id}
                        className={`p-2 rounded border text-[11px] ${
                          item.speaker === 'examiner'
                            ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-200'
                            : 'bg-indigo-950/30 border-indigo-900/50 text-indigo-200'
                        }`}
                      >
                        <div className="flex items-center justify-between font-semibold mb-1 opacity-80 text-[10px]">
                          <span>{item.speaker === 'examiner' ? 'EXAMINER' : 'CANDIDATE'}</span>
                          <span className="font-mono text-slate-500">
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="leading-snug">{item.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: RAW EVENT LOGS */}
            {activeTab === 'logs' && (
              <div className="space-y-2">
                {/* Log Filter Pills */}
                <div className="flex gap-1 overflow-x-auto pb-1 text-[10px]">
                  {['all', 'info', 'audio', 'transcript', 'turn', 'interrupted', 'warning', 'error', 'ws'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setLogFilter(f)}
                      className={`px-2 py-0.5 rounded capitalize cursor-pointer whitespace-nowrap ${
                        logFilter === f
                          ? 'bg-emerald-500 text-slate-950 font-semibold'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                <div className="bg-slate-950 font-mono text-[10px] p-2 rounded border border-slate-800 max-h-[300px] overflow-y-auto space-y-1">
                  {filteredLogs.length === 0 ? (
                    <p className="text-slate-600 text-center py-4">No matching logs.</p>
                  ) : (
                    filteredLogs.map((log) => (
                      <div key={log.id} className="leading-snug flex items-start gap-1">
                        <span className="text-slate-600 shrink-0">
                          {new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}
                        </span>
                        <span
                          className={`font-semibold shrink-0 px-1 rounded text-[9px] uppercase ${
                            log.type === 'error'
                              ? 'bg-rose-950 text-rose-400'
                              : log.type === 'warning'
                              ? 'bg-amber-950 text-amber-400'
                              : log.type === 'interrupted'
                              ? 'bg-purple-950 text-purple-300'
                              : 'text-emerald-400'
                          }`}
                        >
                          {log.type}
                        </span>
                        <span className="text-slate-300 break-all">{log.details}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
