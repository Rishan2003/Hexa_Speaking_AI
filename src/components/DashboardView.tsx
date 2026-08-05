/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from '../services/routerContext';
import { useAuth } from '../services/authContext';
import { FirebaseRepository } from '../services/firebaseRepository';
import { IELTSPracticeSession, IELTSEvaluation } from '../types';
import {
  Activity,
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Calendar,
  Clock,
  FileText,
  Mic,
  Play,
  Sparkles,
  Target,
} from 'lucide-react';

const modeCards = [
  {
    mode: 'part1' as const,
    label: 'Part 1',
    title: 'Interview Practice',
    description: 'Short personal questions with realistic 4–5 minute examiner pacing.',
    duration: '4–5 min',
    icon: Mic,
  },
  {
    mode: 'part2' as const,
    label: 'Part 2',
    title: 'Cue Card Long Turn',
    description: 'One minute to prepare, then speak continuously for up to two minutes.',
    duration: '3–4 min',
    icon: BookOpen,
  },
  {
    mode: 'part3' as const,
    label: 'Part 3',
    title: 'Discussion Practice',
    description: 'Develop analytical answers to broader questions linked to an IELTS topic.',
    duration: '4–5 min',
    icon: Award,
  },
  {
    mode: 'full' as const,
    label: 'Recommended',
    title: 'Full Speaking Mock',
    description: 'Complete Parts 1, 2 and 3 with authentic timing and a full assessment report.',
    duration: '11–14 min',
    icon: Play,
    featured: true,
  },
];

export const DashboardView: React.FC = () => {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<IELTSPracticeSession[]>([]);
  const [evaluations, setEvaluations] = useState<Record<string, IELTSEvaluation>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadDashboardData = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const history = await FirebaseRepository.getSessionsHistory(user.uid);
        if (!active) return;
        setSessions(history);

        const evalsMap: Record<string, IELTSEvaluation> = {};
        for (const session of history) {
          if (session.status !== 'completed') continue;
          const evaluation = await FirebaseRepository.getEvaluation(session.id);
          if (!evaluation) continue;
          evalsMap[evaluation.id] = evaluation;
          evalsMap[session.id] = evaluation;
        }
        if (active) setEvaluations(evalsMap);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadDashboardData();
    return () => {
      active = false;
    };
  }, [user]);

  if (!user) return null;

  const completedSessions = sessions.filter((session) => session.status === 'completed');
  const uniqueEvaluations = Array.from(
    new Map(Object.values(evaluations).map((evaluation) => [evaluation.id, evaluation])).values(),
  ).filter((evaluation) => evaluation.userId === user.uid);

  const average = (selector: (evaluation: IELTSEvaluation) => number) =>
    uniqueEvaluations.length
      ? Number((uniqueEvaluations.reduce((sum, evaluation) => sum + selector(evaluation), 0) / uniqueEvaluations.length).toFixed(1))
      : 0;

  const avgBand = average((evaluation) => evaluation.estimatedOverallBand);
  const avgFluency = average((evaluation) => evaluation.criteria.fluencyAndCoherence.score);
  const avgLexical = average((evaluation) => evaluation.criteria.lexicalResource.score);
  const avgGrammar = average((evaluation) => evaluation.criteria.grammaticalRangeAccuracy.score);
  const avgPronunciation = average((evaluation) => evaluation.criteria.pronunciation.score);

  const recentCompletedSession = [...completedSessions].sort((a, b) => b.createdAt - a.createdAt)[0];
  const recentEvaluation = recentCompletedSession
    ? (recentCompletedSession.evaluationId ? evaluations[recentCompletedSession.evaluationId] : undefined) || evaluations[recentCompletedSession.id]
    : undefined;

  const skills = [
    { name: 'Fluency', score: avgFluency },
    { name: 'Vocabulary', score: avgLexical },
    { name: 'Grammar', score: avgGrammar },
    { name: 'Pronunciation', score: avgPronunciation },
  ];

  const scoredSkills = skills.filter((skill) => skill.score > 0);
  const weakestSkill = scoredSkills.length
    ? scoredSkills.reduce((weakest, skill) => (skill.score < weakest.score ? skill : weakest), scoredSkills[0])
    : null;

  const firstName = user.displayName?.trim().split(/\s+/)[0] || 'Student';
  const formatExamDate = (value?: string) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <main id="dashboard-view-container" className="max-w-6xl mx-auto py-7 md:py-10 px-4 space-y-7 font-sans">
      <section className="hexa-brand-panel rounded-[2rem] text-white overflow-hidden shadow-xl relative">
        <div className="absolute inset-y-0 right-0 w-1/2 opacity-15 bg-[radial-gradient(circle_at_75%_25%,white,transparent_42%)]" />
        <div className="relative p-6 md:p-9 grid gap-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em]">
              <Sparkles size={13} className="text-red-300" />
              HEXA'S Student Speaking Centre
            </span>
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight">Good to see you, {firstName}.</h1>
              <p className="mt-2 max-w-2xl text-sm md:text-base text-white/70 leading-relaxed">
                Build exam confidence through guided IELTS speaking practice, realistic timing and evidence-based feedback.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 text-xs font-semibold text-white/80">
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <Target size={14} className="text-red-300" /> Target band {user.targetBand?.toFixed(1) || '7.0'}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <Calendar size={14} className="text-red-300" />
                {user.examDate ? `Exam ${formatExamDate(user.examDate)}` : 'Exam date not set'}
              </span>
            </div>
          </div>

          <button
            id="dashboard-new-practice-btn"
            onClick={() => navigate('/practice/setup', { mode: 'full' })}
            className="group w-full lg:w-auto min-w-[220px] rounded-2xl bg-[var(--hexa-red)] hover:bg-[var(--hexa-red-dark)] px-6 py-4 text-left shadow-lg transition cursor-pointer"
          >
            <span className="block text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/70">Primary action</span>
            <span className="mt-1 flex items-center justify-between gap-5 text-base font-black">
              Start a Speaking Session
              <ArrowRight size={19} className="transition-transform group-hover:translate-x-1" />
            </span>
          </button>
        </div>
      </section>

      {loading ? (
        <section className="py-20 flex flex-col items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--hexa-navy)] border-t-transparent" />
          <p className="mt-4 text-xs font-semibold text-slate-500">Loading your speaking progress…</p>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-7">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hexa-red)]">Practice formats</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">Choose your session</h2>
                </div>
                <span className="hidden sm:inline-flex rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Feedback included
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {modeCards.map(({ mode, label, title, description, duration, icon: Icon, featured }) => (
                  <button
                    key={mode}
                    onClick={() => navigate('/practice/setup', { mode })}
                    className={`group rounded-2xl border p-5 text-left transition cursor-pointer ${
                      featured
                        ? 'border-[var(--hexa-navy)] bg-[var(--hexa-navy)] text-white shadow-md hover:bg-[var(--hexa-navy-deep)]'
                        : 'border-slate-200 bg-white hover:border-[rgba(47,51,127,.35)] hover:bg-[var(--hexa-soft)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className={`rounded-xl p-2.5 ${featured ? 'bg-white/10' : 'bg-[var(--hexa-soft-blue)] text-[var(--hexa-navy)]'}`}>
                        <Icon size={19} />
                      </span>
                      <span className={`text-[10px] font-black uppercase tracking-[0.15em] ${featured ? 'text-red-200' : 'text-slate-400'}`}>
                        {label}
                      </span>
                    </div>
                    <h3 className={`mt-4 text-sm font-black ${featured ? 'text-white' : 'text-slate-950'}`}>{title}</h3>
                    <p className={`mt-1.5 text-xs leading-relaxed ${featured ? 'text-white/68' : 'text-slate-500'}`}>{description}</p>
                    <div className={`mt-4 flex items-center justify-between text-[10px] font-bold ${featured ? 'text-white/60' : 'text-slate-400'}`}>
                      <span className="inline-flex items-center gap-1.5"><Clock size={12} /> {duration}</span>
                      <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hexa-red)]">Latest assessment</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">Recent performance</h2>
                </div>
                <button onClick={() => navigate('/history')} className="text-xs font-bold text-[var(--hexa-navy)] hover:text-[var(--hexa-red)] cursor-pointer">
                  View history
                </button>
              </div>

              {recentCompletedSession && recentEvaluation ? (
                <div className="rounded-2xl bg-slate-50 p-5 border border-slate-100">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-400">{new Date(recentCompletedSession.createdAt).toLocaleDateString()}</p>
                      <h3 className="mt-1 font-black text-slate-950">{recentCompletedSession.topic}</h3>
                      <p className="mt-2 text-xs text-slate-500 line-clamp-2">{recentEvaluation.examinerNote}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                      <div className="rounded-2xl bg-[var(--hexa-navy)] px-4 py-3 text-center text-white">
                        <span className="block text-[9px] font-bold uppercase tracking-widest text-white/55">Band</span>
                        <strong className="font-mono text-2xl font-black">{recentEvaluation.estimatedOverallBand.toFixed(1)}</strong>
                      </div>
                      <button
                        onClick={() => navigate('/results', { sessionId: recentCompletedSession.id })}
                        className="inline-flex items-center gap-1 text-xs font-black text-[var(--hexa-navy)] hover:text-[var(--hexa-red)] cursor-pointer"
                      >
                        Open report <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-9 text-center">
                  <FileText size={30} className="mx-auto text-slate-300" />
                  <h3 className="mt-3 text-sm font-black text-slate-900">No assessment report yet</h3>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                    Complete your first speaking session and your latest band estimate, strengths and improvement priorities will appear here.
                  </p>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hexa-red)]">Progress</p>
                  <h2 className="mt-1 text-base font-black text-slate-950">Your snapshot</h2>
                </div>
                <BarChart3 size={20} className="text-[var(--hexa-navy)]" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-[var(--hexa-soft)] p-4">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">Sessions</span>
                  <strong className="mt-1 block text-2xl font-black text-slate-950">{completedSessions.length}</strong>
                </div>
                <div className="rounded-2xl bg-[var(--hexa-soft)] p-4">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">Average band</span>
                  <strong className="mt-1 block text-2xl font-black text-[var(--hexa-navy)]">{avgBand ? avgBand.toFixed(1) : '—'}</strong>
                </div>
              </div>

              {scoredSkills.length > 0 ? (
                <div className="mt-5 space-y-3">
                  {skills.map((skill) => (
                    <div key={skill.name}>
                      <div className="mb-1 flex justify-between text-[11px] font-bold text-slate-600">
                        <span>{skill.name}</span>
                        <span>{skill.score ? skill.score.toFixed(1) : '—'}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[var(--hexa-navy)]" style={{ width: `${Math.min(100, (skill.score / 9) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-xs leading-relaxed text-slate-500">Your skill averages will appear after the first completed evaluation.</p>
              )}
            </section>

            <section className="rounded-3xl border border-[rgba(47,51,127,.16)] bg-[var(--hexa-soft-blue)] p-5">
              <div className="flex items-center gap-2 text-[var(--hexa-navy)]">
                <Target size={18} />
                <h2 className="text-sm font-black">Coach's focus</h2>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                {weakestSkill
                  ? `Your current lowest average is ${weakestSkill.name} at band ${weakestSkill.score.toFixed(1)}. Focus your next sessions on clearer development, controlled pacing and accurate language.`
                  : 'Complete a full mock first. It gives HEXA\'S Speaking AI enough evidence to create a useful baseline across the speaking criteria.'}
              </p>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Activity size={18} className="text-[var(--hexa-red)]" />
                <h2 className="text-sm font-black">Quick access</h2>
              </div>
              <div className="mt-3 divide-y divide-slate-100 text-xs font-bold">
                <button onClick={() => navigate('/history')} className="flex w-full items-center justify-between py-3 text-left text-slate-600 hover:text-[var(--hexa-navy)] cursor-pointer">
                  Practice history <ArrowRight size={14} />
                </button>
                <button onClick={() => navigate('/settings')} className="flex w-full items-center justify-between py-3 text-left text-slate-600 hover:text-[var(--hexa-navy)] cursor-pointer">
                  Profile and exam settings <ArrowRight size={14} />
                </button>
              </div>
            </section>
          </aside>
        </div>
      )}

      <p className="px-1 text-center text-[10px] leading-relaxed text-slate-400">
        HEXA'S Speaking AI provides simulated practice estimates for learning purposes and does not issue official IELTS scores.
      </p>
    </main>
  );
};

export default DashboardView;
