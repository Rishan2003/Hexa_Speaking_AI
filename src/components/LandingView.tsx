/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useRouter } from '../services/routerContext';
import { ArrowRight, AudioLines, Award, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { MockAuthService } from '../services/mockService';
import { HexasBrand } from './HexasBrand';

export const LandingView: React.FC = () => {
  const { navigate } = useRouter();
  const currentUser = MockAuthService.getCurrentUser();

  const handleGetStarted = () => {
    if (currentUser) {
      navigate(currentUser.onboarded ? '/dashboard' : '/onboarding');
    } else {
      navigate('/login');
    }
  };

  return (
    <div id="landing-view-container" className="py-8 md:py-14 px-1 font-sans">
      <section className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white hexa-brand-card">
        <div className="absolute inset-y-0 right-0 hidden lg:block w-[43%] hexa-brand-panel" aria-hidden="true" />
        <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full bg-[var(--hexa-red)]/10 blur-3xl" aria-hidden="true" />

        <div className="relative grid lg:grid-cols-[1.25fr_.75fr] min-h-[520px]">
          <div className="p-7 sm:p-10 lg:p-14 flex flex-col justify-center">
            <HexasBrand className="mb-9" />

            <div className="inline-flex self-start items-center gap-2 rounded-full border border-[rgba(47,51,127,.12)] bg-[var(--hexa-soft-blue)] px-3.5 py-1.5 text-[10px] sm:text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--hexa-navy)] mb-5">
              <Sparkles size={13} className="text-[var(--hexa-red)]" />
              A HEXA'S Education learning experience
            </div>

            <h1 className="max-w-3xl text-4xl sm:text-5xl xl:text-6xl font-black tracking-[-0.045em] leading-[1.02] text-slate-950">
              IELTS Speaking practice that feels <span className="text-[var(--hexa-navy)]">focused</span>, not generic.
            </h1>
            <p className="mt-5 max-w-2xl text-sm sm:text-base leading-7 text-slate-600">
              Practice Parts 1, 2 and 3 with a real-time AI examiner, exam-controlled timers and structured performance feedback inside HEXA'S dedicated speaking workspace.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button
                id="get-started-button"
                onClick={handleGetStarted}
                className="hexa-primary-btn inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-extrabold transition cursor-pointer"
              >
                Start IELTS Speaking Practice
                <ArrowRight size={17} />
              </button>
              {currentUser && (
                <button
                  id="go-dashboard-button"
                  onClick={() => navigate('/dashboard')}
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-bold text-[var(--hexa-navy)] hover:bg-[var(--hexa-soft)] transition cursor-pointer"
                >
                  Open Student Dashboard
                </button>
              )}
            </div>

            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-bold text-slate-500">
              <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-[var(--hexa-red)]" /> Real-time voice examiner</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-[var(--hexa-red)]" /> IELTS Parts 1–3</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-[var(--hexa-red)]" /> Performance report</span>
            </div>
          </div>

          <div className="relative hidden lg:flex p-9 items-end">
            <div className="relative z-10 w-full rounded-3xl border border-white/15 bg-white/10 backdrop-blur-sm p-6 text-white shadow-2xl">
              <div className="flex items-center justify-between mb-7">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/55">HEXA'S Digital Learning</p>
                  <h2 className="text-xl font-black mt-1">Speaking Practice Lab</h2>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-[var(--hexa-red)] flex items-center justify-center shadow-lg">
                  <AudioLines size={21} />
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl bg-white/10 border border-white/10 p-4 flex items-center gap-3">
                  <AudioLines size={18} className="text-white/80" />
                  <div><strong className="text-sm block">Live examiner</strong><span className="text-[10px] text-white/55">Natural realtime voice interaction</span></div>
                </div>
                <div className="rounded-2xl bg-white/10 border border-white/10 p-4 flex items-center gap-3">
                  <Award size={18} className="text-white/80" />
                  <div><strong className="text-sm block">IELTS feedback</strong><span className="text-[10px] text-white/55">Fluency, vocabulary, grammar & more</span></div>
                </div>
                <div className="rounded-2xl bg-white/10 border border-white/10 p-4 flex items-center gap-3">
                  <ShieldCheck size={18} className="text-white/80" />
                  <div><strong className="text-sm block">Student workspace</strong><span className="text-[10px] text-white/55">Private sessions and progress history</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        {[
          ['Exam-structured', 'The interface clearly separates preparation, speaking and assessment so students always know where they are.'],
          ['HEXA\'S branded', 'A focused navy-and-red product language connects the software to the HEXA\'S Education identity.'],
          ['Built for practice', 'Fast access to mock sessions, previous attempts and actionable feedback without unnecessary dashboard clutter.'],
        ].map(([title, copy]) => (
          <div key={title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="w-8 h-1 rounded-full bg-[var(--hexa-red)] mb-4" />
            <h3 className="font-black text-slate-950 text-sm">{title}</h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">{copy}</p>
          </div>
        ))}
      </section>
    </div>
  );
};

export default LandingView;
