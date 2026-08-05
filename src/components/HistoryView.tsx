/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from '../services/routerContext';
import { useAuth } from '../services/authContext';
import { FirebaseRepository } from '../services/firebaseRepository';
import { IELTSPracticeSession, IELTSEvaluation } from '../types';
import { Calendar, ChevronRight, Award, FolderOpen, ArrowLeft } from 'lucide-react';

export const HistoryView: React.FC = () => {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<IELTSPracticeSession[]>([]);
  const [evaluations, setEvaluations] = useState<Record<string, IELTSEvaluation>>({});

  useEffect(() => {
    let active = true;

    const loadHistory = async () => {
      if (!user) return;
      try {
        const history = await FirebaseRepository.getSessionsHistory(user.uid);
        const evaluationPairs = await Promise.all(
          history
            .filter((session) => session.status === 'completed')
            .map(async (session) => [session.id, await FirebaseRepository.getEvaluation(session.id)] as const)
        );
        if (!active) return;

        const evaluationMap: Record<string, IELTSEvaluation> = {};
        evaluationPairs.forEach(([sessionId, evaluation]) => {
          if (evaluation) {
            evaluationMap[evaluation.id] = evaluation;
            evaluationMap[sessionId] = evaluation;
          }
        });
        setSessions(history);
        setEvaluations(evaluationMap);
      } catch (error) {
        console.error('Failed to load practice history:', error);
        if (active) {
          setSessions([]);
          setEvaluations({});
        }
      }
    };

    loadHistory();
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <div id="history-view-container" className="max-w-4xl mx-auto py-8 px-4 font-sans space-y-6">
      
      {/* Back button */}
      <button
        onClick={() => navigate('/dashboard')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 cursor-pointer"
      >
        <ArrowLeft size={14} /> Back to Dashboard
      </button>

      <div className="mb-8 text-left">
        <h1 className="text-3xl font-black text-gray-950">Practice Transcript History</h1>
        <p className="text-gray-500 text-sm mt-1">Review your past scores, category averages, and customized examiner instructions.</p>
      </div>

      {sessions.length === 0 ? (
        <div className="border border-gray-100 bg-white rounded-2xl p-12 text-center shadow-sm">
          <FolderOpen size={48} className="text-gray-300 mx-auto mb-4" />
          <h3 className="font-bold text-gray-950 text-base">No evaluations found</h3>
          <p className="text-gray-500 text-xs mt-1 mb-6">Complete a mock speaking session to save your speaking performance logs here.</p>
          <button
            onClick={() => navigate('/practice/setup')}
            className="bg-gray-950 hover:bg-gray-800 text-white text-xs font-semibold py-3 px-6 rounded-xl transition duration-150 cursor-pointer"
          >
            Launch Setup Wizard
          </button>
        </div>
      ) : (
        <div className="border border-gray-100 bg-white rounded-2xl shadow-sm divide-y divide-gray-100 overflow-hidden text-left">
          {sessions.map((session) => {
            const evalDetails = (session.evaluationId ? evaluations[session.evaluationId] : undefined) || evaluations[session.id];
            return (
              <div key={session.id} className="p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-gray-50/40 transition">
                <div className="space-y-1.5">
                  <h4 className="font-bold text-base text-gray-950 leading-tight">{session.topic}</h4>
                  <div className="flex items-center gap-3 text-xs text-gray-500 font-medium">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(session.createdAt).toLocaleDateString()}
                    </span>
                    <span className="capitalize px-1.5 py-0.5 bg-gray-50 border border-gray-100 rounded">
                      Part: {session.currentPart === 'PART_3' ? 'All Parts Complete' : 'Part 1 Only'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                  {session.status === 'completed' && evalDetails ? (
                    <div className="flex items-center gap-3">
                      <div className="text-left sm:text-right">
                        <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider">Practice Band</span>
                        <strong className="text-sm text-gray-950 font-black font-mono bg-gray-100 px-2 py-0.5 rounded">
                          {evalDetails.estimatedOverallBand.toFixed(1)}
                        </strong>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs font-bold text-yellow-600 bg-yellow-50 px-2.5 py-1 rounded-lg">
                      Draft / Unfinished
                    </span>
                  )}

                  <button
                    id={`history-view-session-btn-${session.id}`}
                    onClick={() => {
                      if (session.status === 'completed') {
                        navigate('/results', { sessionId: session.id });
                      } else {
                        navigate('/practice', { sessionId: session.id });
                      }
                    }}
                    className="flex items-center gap-1 bg-gray-50 hover:bg-gray-100 text-gray-800 text-xs font-semibold py-2 px-4 rounded-xl transition cursor-pointer shrink-0 border border-gray-100"
                  >
                    <span>Analyze</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
export default HistoryView;
