/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from '../services/routerContext';
import { useAuth } from '../services/authContext';
import { useBilling } from '../services/billingContext';
import { Route, RoutePath, UserProfile } from '../types';
import { Sparkles, LayoutDashboard, History, Settings, LogIn, LogOut, Compass, GraduationCap, Menu, X, ShieldCheck, Activity, AlertTriangle, CreditCard, BadgeDollarSign } from 'lucide-react';
import { LandingView } from './LandingView';
import { LoginView } from './LoginView';
import { OnboardingView } from './OnboardingView';
import { DashboardView } from './DashboardView';
import { PracticeSetupView } from './PracticeSetupView';
import { PracticeSessionView } from './PracticeSessionView';
import { ResultsView } from './ResultsView';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';
import { PrivacySettingsView } from './PrivacySettingsView';
import { AdminDiagnosticsView } from './AdminDiagnosticsView';
import { BillingView } from './BillingView';
import { AdminBillingView } from './AdminBillingView';
import { HexasBrand } from './HexasBrand';

export const NavigationShell: React.FC = () => {
  const { currentRoute, navigate } = useRouter();
  const { user, loading, signOut } = useAuth();
  const { isAdmin } = useBilling();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [redirectRoute, setRedirectRoute] = useState<Route | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const [userConsent, setUserConsent] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('userConsentForRecording');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const handleConsentChange = (newConsent: boolean) => {
    setUserConsent(newConsent);
    try {
      localStorage.setItem('userConsentForRecording', String(newConsent));
    } catch {}
  };

  useEffect(() => {
    if (loading) return;

    const publicPaths: RoutePath[] = ['/', '/login'];
    const isPublic = publicPaths.includes(currentRoute.path);

    if (!user) {
      if (!isPublic) {
        // Preserve deep links for normal auth expiry/login flows, but an explicit
        // sign-out should always return to a clean login state.
        console.log(`[Auth Protection] Route '${currentRoute.path}' is protected. Redirecting to /login`);
        if (!isSigningOut) {
          setRedirectRoute({ ...currentRoute });
        }
        navigate('/login');
      }
    } else {
      // User is authenticated
      if (!user.onboarded) {
        if (currentRoute.path !== '/onboarding') {
          console.log('[Auth Protection] Profile not complete. Redirecting to onboarding.');
          navigate('/onboarding');
        }
      } else {
        // User is onboarded
        if (currentRoute.path === '/login' || currentRoute.path === '/onboarding') {
          if (redirectRoute) {
            console.log(`[Auth Protection] Navigating to preserved target route: ${redirectRoute.path}`);
            const dest = { ...redirectRoute };
            setRedirectRoute(null);
            navigate(dest.path, dest.params);
          } else {
            navigate('/dashboard');
          }
        }
      }
    }
  }, [user, loading, currentRoute.path, isSigningOut]);

  const handleNav = (path: any) => {
    setIsMobileMenuOpen(false);
    navigate(path);
  };

  const requestSignOut = () => {
    setIsMobileMenuOpen(false);
    setSignOutError(null);
    setShowSignOutConfirm(true);
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError(null);

    try {
      // An explicit logout should never preserve a protected redirect target.
      setRedirectRoute(null);
      await signOut();
      setShowSignOutConfirm(false);
      navigate('/login');
    } catch (error) {
      console.error('Sign out failed:', error);
      setSignOutError('We could not sign you out. Please check your connection and try again.');
    } finally {
      setIsSigningOut(false);
    }
  };

  if (loading) {
    return (
      <div id="global-loading-screen" className="min-h-screen bg-[var(--hexa-soft)] hexa-grid-bg flex flex-col justify-center items-center p-6 font-sans">
        <div className="relative mb-4 flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-white rounded-full"></div>
          <div className="w-16 h-16 border-4 border-[var(--hexa-navy)] border-t-[var(--hexa-red)] rounded-full animate-spin absolute"></div>
          <Sparkles className="text-[var(--hexa-red)] animate-pulse absolute" size={22} />
        </div>
        <h3 className="font-extrabold text-gray-950 text-base tracking-tight">Initializing HEXA'S Speaking AI</h3>
        <p className="text-gray-500 text-xs mt-1.5 animate-pulse">Preparing your HEXA'S IELTS practice workspace...</p>
      </div>
    );
  }

  const renderActiveView = () => {
    switch (currentRoute.path) {
      case '/':
        return <LandingView />;
      case '/login':
        return <LoginView />;
      case '/onboarding':
        return <OnboardingView />;
      case '/dashboard':
        return <DashboardView />;
      case '/practice/setup':
        return <PracticeSetupView />;
      case '/practice':
        return <PracticeSessionView sessionId={currentRoute.params?.sessionId} />;
      case '/results':
        return <ResultsView sessionId={currentRoute.params?.sessionId} />;
      case '/history':
        return <HistoryView />;
      case '/billing':
        return <BillingView />;
      case '/settings':
        return <SettingsView />;
      case '/privacy':
        return (
          <PrivacySettingsView
            userId={user?.uid}
            userConsent={userConsent}
            onConsentChange={handleConsentChange}
            onNavigateHome={() => navigate('/dashboard')}
          />
        );
      case '/admin/billing':
        return <AdminBillingView />;
      case '/admin':
        return (
          <AdminDiagnosticsView
            onNavigateHome={() => navigate('/dashboard')}
          />
        );
      default:
        // Friendly 404 fallback page
        return (
          <div id="not-found-screen" className="min-h-[70vh] flex flex-col justify-center items-center text-center p-6">
            <Compass size={48} className="text-gray-300 mb-4 animate-bounce" />
            <h1 className="text-3xl font-black text-gray-950">Route Not Found</h1>
            <p className="text-gray-500 text-sm mt-1 max-w-sm">
              The page you are looking for does not exist. Let's return to the student classroom dashboard.
            </p>
            <button
              id="return-dashboard-404-btn"
              onClick={() => navigate(user ? '/dashboard' : '/')}
              className="mt-6 bg-gray-950 hover:bg-gray-800 text-white font-semibold py-3 px-6 rounded-xl text-xs transition duration-150 cursor-pointer"
            >
              Back to Safety
            </button>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-transparent flex flex-col text-slate-900 selection:bg-[var(--hexa-red)] selection:text-white">
      
      {/* Top Application Header Bar */}
      <header className="bg-white/95 backdrop-blur-xl border-b border-slate-200/80 py-3 px-4 md:px-6 sticky top-0 z-50 shrink-0 shadow-[0_8px_24px_rgba(31,36,95,0.035)]">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          
          {/* Logo */}
          <button
            id="brand-logo-trigger"
            onClick={() => handleNav(user ? '/dashboard' : '/')}
            className="cursor-pointer select-none text-left rounded-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(47,51,127,.10)]"
            aria-label="HEXA'S Education Speaking AI home"
          >
            <HexasBrand compact />
          </button>

          {/* Desktop Navigation Links (Only shown when logged in) */}
          {user ? (
            <nav className="hidden md:flex items-center gap-1">
              <button
                id="nav-link-dashboard"
                onClick={() => handleNav('/dashboard')}
                className={`flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg transition duration-150 cursor-pointer ${
                  currentRoute.path === '/dashboard' ? 'bg-[var(--hexa-navy)] text-white shadow-sm' : 'text-gray-600 hover:text-gray-950 hover:bg-gray-50'
                }`}
              >
                <LayoutDashboard size={14} />
                <span>Dashboard</span>
              </button>

              <button
                id="nav-link-history"
                onClick={() => handleNav('/history')}
                className={`flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg transition duration-150 cursor-pointer ${
                  currentRoute.path === '/history' ? 'bg-[var(--hexa-navy)] text-white shadow-sm' : 'text-gray-600 hover:text-gray-950 hover:bg-gray-50'
                }`}
              >
                <History size={14} />
                <span>History</span>
              </button>

              <button
                id="nav-link-billing"
                onClick={() => handleNav('/billing')}
                className={`flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg transition duration-150 cursor-pointer ${
                  currentRoute.path === '/billing' ? 'bg-[var(--hexa-navy)] text-white shadow-sm' : 'text-gray-600 hover:text-gray-950 hover:bg-gray-50'
                }`}
              >
                <CreditCard size={14} />
                <span>Buy Tests</span>
              </button>

              <button
                id="nav-link-settings"
                onClick={() => handleNav('/settings')}
                className={`flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg transition duration-150 cursor-pointer ${
                  currentRoute.path === '/settings' ? 'bg-[var(--hexa-navy)] text-white shadow-sm' : 'text-gray-600 hover:text-gray-950 hover:bg-gray-50'
                }`}
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>

              <button
                id="nav-link-privacy"
                onClick={() => handleNav('/privacy')}
                className={`flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg transition duration-150 cursor-pointer ${
                  currentRoute.path === '/privacy' ? 'bg-[var(--hexa-navy)] text-white shadow-sm' : 'text-gray-600 hover:text-gray-950 hover:bg-gray-50'
                }`}
              >
                <ShieldCheck size={14} />
                <span>Privacy</span>
              </button>

              {isAdmin && (
                <>
                  <button
                    id="nav-link-admin-billing"
                    onClick={() => handleNav('/admin/billing')}
                    className={`flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg transition duration-150 cursor-pointer ${
                      currentRoute.path === '/admin/billing' ? 'bg-[var(--hexa-navy)] text-white shadow-sm' : 'text-gray-600 hover:text-gray-950 hover:bg-gray-50'
                    }`}
                  >
                    <BadgeDollarSign size={14} />
                    <span>Billing Admin</span>
                  </button>
                  <button
                    id="nav-link-admin"
                    onClick={() => handleNav('/admin')}
                    className={`flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg transition duration-150 cursor-pointer ${
                      currentRoute.path === '/admin' ? 'bg-[var(--hexa-navy)] text-white shadow-sm' : 'text-gray-600 hover:text-gray-950 hover:bg-gray-50'
                    }`}
                  >
                    <Activity size={14} />
                    <span>Diagnostics</span>
                  </button>
                </>
              )}

              <div className="h-6 w-px bg-gray-200 mx-1" aria-hidden="true" />

              <button
                id="nav-sign-out"
                onClick={requestSignOut}
                className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-lg text-gray-500 hover:text-red-700 hover:bg-red-50 transition duration-150 cursor-pointer"
                title="Sign out of HEXA'S Speaking AI"
              >
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </nav>
          ) : (
            <button
              id="header-login-btn"
              onClick={() => handleNav('/login')}
              className="hidden md:flex items-center gap-1.5 hexa-primary-btn text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer"
            >
              <LogIn size={14} />
              <span>Sign In Profile</span>
            </button>
          )}

          {/* Mobile hamburger menu toggle */}
          {user && (
            <button
              id="mobile-menu-toggle"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-1.5 text-gray-500 hover:text-gray-950 hover:bg-gray-50 rounded-lg transition shrink-0"
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}
          {!user && !['/', '/login'].includes(currentRoute.path) && (
            <button
              onClick={() => handleNav('/login')}
              className="md:hidden text-xs font-bold text-gray-950 flex items-center gap-1 shrink-0"
            >
              <LogIn size={14} /> Sign In
            </button>
          )}

        </div>
      </header>

      {/* Mobile Slide-out Menu */}
      {isMobileMenuOpen && user && (
        <div className="md:hidden bg-white border-b border-gray-100 flex flex-col p-4 space-y-2 text-left absolute w-full top-[65px] z-40 shadow-lg animate-fade-in">
          <button
            id="mobile-nav-dashboard"
            onClick={() => handleNav('/dashboard')}
            className={`flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left ${
              currentRoute.path === '/dashboard' ? 'bg-[var(--hexa-navy)] text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <LayoutDashboard size={16} />
            <span>Classroom Dashboard</span>
          </button>
          <button
            id="mobile-nav-history"
            onClick={() => handleNav('/history')}
            className={`flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left ${
              currentRoute.path === '/history' ? 'bg-[var(--hexa-navy)] text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <History size={16} />
            <span>Practice History</span>
          </button>
          <button
            id="mobile-nav-billing"
            onClick={() => handleNav('/billing')}
            className={`flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left ${
              currentRoute.path === '/billing' ? 'bg-[var(--hexa-navy)] text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <CreditCard size={16} />
            <span>Buy Tests</span>
          </button>
          <button
            id="mobile-nav-settings"
            onClick={() => handleNav('/settings')}
            className={`flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left ${
              currentRoute.path === '/settings' ? 'bg-[var(--hexa-navy)] text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Settings size={16} />
            <span>Preferences & Mock Config</span>
          </button>
          <button
            id="mobile-nav-privacy"
            onClick={() => handleNav('/privacy')}
            className={`flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left ${
              currentRoute.path === '/privacy' ? 'bg-[var(--hexa-navy)] text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <ShieldCheck size={16} />
            <span>Privacy</span>
          </button>
          {isAdmin && (
            <>
              <button
                id="mobile-nav-admin-billing"
                onClick={() => handleNav('/admin/billing')}
                className={`flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left ${
                  currentRoute.path === '/admin/billing' ? 'bg-[var(--hexa-navy)] text-white' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <BadgeDollarSign size={16} />
                <span>Billing Admin</span>
              </button>
              <button
                id="mobile-nav-admin"
                onClick={() => handleNav('/admin')}
                className={`flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left ${
                  currentRoute.path === '/admin' ? 'bg-[var(--hexa-navy)] text-white' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Activity size={16} />
                <span>Diagnostics</span>
              </button>
            </>
          )}

          <div className="border-t border-gray-100 pt-3 mt-1">
            <div className="px-4 pb-2">
              <p className="text-[10px] uppercase tracking-[0.16em] font-black text-gray-400">Signed in as</p>
              <p className="text-xs font-semibold text-gray-700 truncate mt-1">{user.email || user.displayName || 'IELTS Candidate'}</p>
            </div>
            <button
              id="mobile-nav-sign-out"
              onClick={requestSignOut}
              className="w-full flex items-center gap-2.5 text-xs font-bold py-3 px-4 rounded-xl text-left text-red-700 hover:bg-red-50 transition"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}

      {/* Primary dynamic content viewport */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 mb-16 md:mb-0">
        {renderActiveView()}
      </main>

      {/* Mobile Sticky Footer Bottom Navigation (For quick tactile access) */}
      {user && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 py-2.5 px-6 flex justify-around items-center z-50 shadow-2xl">
          <button
            id="mobile-footer-dashboard"
            onClick={() => handleNav('/dashboard')}
            className={`flex flex-col items-center gap-1 text-[10px] font-bold ${
              currentRoute.path === '/dashboard' ? 'text-[var(--hexa-navy)]' : 'text-gray-400'
            }`}
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </button>

          <button
            id="mobile-footer-history"
            onClick={() => handleNav('/history')}
            className={`flex flex-col items-center gap-1 text-[10px] font-bold ${
              currentRoute.path === '/history' ? 'text-[var(--hexa-navy)]' : 'text-gray-400'
            }`}
          >
            <History size={18} />
            <span>History</span>
          </button>

          <button
            id="mobile-footer-settings"
            onClick={() => handleNav('/settings')}
            className={`flex flex-col items-center gap-1 text-[10px] font-bold ${
              currentRoute.path === '/settings' ? 'text-[var(--hexa-navy)]' : 'text-gray-400'
            }`}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </nav>
      )}

      {showSignOutConfirm && user && (
        <div
          id="sign-out-confirmation-overlay"
          className="fixed inset-0 z-[100] bg-gray-950/40 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sign-out-dialog-title"
        >
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
            <div className="p-6 md:p-7">
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                  currentRoute.path === '/practice' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {currentRoute.path === '/practice' ? <AlertTriangle size={20} /> : <LogOut size={20} />}
                </div>
                <div className="min-w-0">
                  <h2 id="sign-out-dialog-title" className="text-lg font-black tracking-tight text-gray-950">
                    Sign out of HEXA'S Speaking AI?
                  </h2>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">
                    {currentRoute.path === '/practice'
                      ? 'You are currently in a practice session. Signing out will leave this session and remove temporary local recovery data.'
                      : 'You will need to sign in again to access your dashboard, practice history, and assessment reports.'}
                  </p>
                  <p className="text-xs text-gray-400 mt-3 truncate">{user.email || user.displayName || 'IELTS Candidate'}</p>
                </div>
              </div>

              {signOutError && (
                <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
                  {signOutError}
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
                <button
                  id="cancel-sign-out-btn"
                  type="button"
                  onClick={() => {
                    if (isSigningOut) return;
                    setShowSignOutConfirm(false);
                    setSignOutError(null);
                  }}
                  disabled={isSigningOut}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  id="confirm-sign-out-btn"
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="px-5 py-2.5 rounded-xl hexa-primary-btn text-xs font-bold transition flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isSigningOut ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Signing out…
                    </>
                  ) : (
                    <>
                      <LogOut size={14} />
                      Sign out
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
export default NavigationShell;
