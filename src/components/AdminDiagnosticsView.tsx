/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Activity,
  ShieldAlert,
  Server,
  RefreshCw,
  Clock,
  Database,
  Cpu,
  Lock,
  CheckCircle,
  BarChart3,
  Users
} from 'lucide-react';

interface AdminDiagnosticsProps {
  idToken?: string;
  onNavigateHome?: () => void;
}

interface DiagnosticsData {
  systemStatus: string;
  timestamp: number;
  uptimeSeconds: number;
  firebaseEnabled: boolean;
  metrics: {
    totalSessions: number;
    totalEvaluations: number;
    totalUsageEvents: number;
    memoryUsage?: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
    };
  };
}

export const AdminDiagnosticsView: React.FC<AdminDiagnosticsProps> = ({
  idToken,
  onNavigateHome
}) => {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnauthorized, setIsUnauthorized] = useState<boolean>(false);

  const fetchDiagnostics = async () => {
    setLoading(true);
    setError(null);
    setIsUnauthorized(false);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
      } else {
        // Fallback for sandbox / testing admin mode
        headers['Authorization'] = 'Bearer mock-admin-token';
      }

      const res = await fetch('/api/admin/diagnostics', { headers });

      if (res.status === 403 || res.status === 401) {
        setIsUnauthorized(true);
        setError('Access Denied: Verified administrator claim required to view diagnostics.');
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch admin diagnostics (${res.status})`);
      }

      const result = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Error connecting to admin diagnostics endpoint.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, [idToken]);

  if (isUnauthorized) {
    return (
      <div id="admin-unauthorized-card" className="max-w-2xl mx-auto my-12 p-8 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-2xl text-center space-y-4">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Admin Authorization Required</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
          This system view is restricted strictly to verified administrators with active admin authorization claims. Private recordings and user transcripts are never accessible.
        </p>
        {onNavigateHome && (
          <button
            onClick={onNavigateHome}
            className="mt-4 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Return to Dashboard
          </button>
        )}
      </div>
    );
  }

  return (
    <div id="admin-diagnostics-page" className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold text-sm mb-1">
            <Activity className="w-4 h-4" />
            <span>Verified Admin System View</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            System Usage & Security Diagnostics
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
            Real-time container performance, usage metrics, and rate limit telemetry. Private transcripts and audio files are excluded.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="refresh-admin-diagnostics-btn"
            onClick={fetchDiagnostics}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {onNavigateHome && (
            <button
              onClick={onNavigateHome}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
            >
              Exit Admin
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-200 text-sm">
          {error}
        </div>
      )}

      {/* Primary Metrics Grid */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">System Status</span>
              <Server className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <span className="text-xl font-bold text-slate-900 dark:text-white capitalize">{data.systemStatus}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {data.firebaseEnabled ? 'Cloud Firestore Active' : 'Offline Sandbox Mode'}
            </p>
          </div>

          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Container Uptime</span>
              <Clock className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">
              {Math.floor(data.uptimeSeconds / 60)}m {data.uptimeSeconds % 60}s
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Continuous operation</p>
          </div>

          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Practice Sessions</span>
              <BarChart3 className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">
              {data.metrics.totalSessions}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Created across environment</p>
          </div>

          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2 shadow-sm">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Evaluations Synthesized</span>
              <Database className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">
              {data.metrics.totalEvaluations}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">AI Band Reports generated</p>
          </div>
        </div>
      )}

      {/* Security & Data Safeguards Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Privacy & Rate Limiting Enforcement</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Active server-side security rules and user limit boundaries.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="font-semibold text-xs text-slate-700 dark:text-slate-300">Session Limit</div>
            <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">15 / User / Day</div>
            <p className="text-xs text-slate-500">Prevents session creation abuse</p>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="font-semibold text-xs text-slate-700 dark:text-slate-300">Ephemeral Token Limit</div>
            <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">20 / User / Day</div>
            <p className="text-xs text-slate-500">Restricts realtime voice session creation</p>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1">
            <div className="font-semibold text-xs text-slate-700 dark:text-slate-300">Evaluation Limit</div>
            <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">10 / User / Day</div>
            <p className="text-xs text-slate-500">Protects Gemini evaluation pipeline</p>
          </div>
        </div>
      </div>
    </div>
  );
};
