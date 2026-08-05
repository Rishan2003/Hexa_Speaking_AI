/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../services/authContext';
import { useRouter } from '../services/routerContext';
import { Award, Mail, Lock, Sparkles, KeyRound, ArrowRight, ArrowLeft } from 'lucide-react';
import { HexasBrand } from './HexasBrand';

export const LoginView: React.FC = () => {
  const { signIn, signUp, resetPassword, isFirebaseMode } = useAuth();
  const { navigate } = useRouter();
  
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [localError, setLocalError] = useState('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setSuccessMessage('');
    
    if (!email || !password) {
      setLocalError('Please fill in both email and password.');
      return;
    }
    
    setLoading(true);
    try {
      const loggedInUser = await signIn(email, password);
      if (loggedInUser) {
        if (loggedInUser.onboarded) {
          navigate('/dashboard');
        } else {
          navigate('/onboarding');
        }
      }
    } catch (err: any) {
      setLocalError(err.message || 'Incorrect email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setSuccessMessage('');
    
    if (!email || !password || !confirmPassword) {
      setLocalError('Please fill in all requested fields.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    
    setLoading(true);
    try {
      const registeredUser = await signUp(email, password);
      if (registeredUser) {
        if (registeredUser.onboarded) {
          navigate('/dashboard');
        } else {
          navigate('/onboarding');
        }
      }
    } catch (err: any) {
      setLocalError(err.message || 'Failed to create your account.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setSuccessMessage('');
    
    if (!email) {
      setLocalError('Please enter your email address first.');
      return;
    }
    
    setLoading(true);
    try {
      await resetPassword(email);
      setSuccessMessage('A secure password reset link has been dispatched to your email (if it exists). Check your inbox.');
    } catch (err: any) {
      setLocalError(err.message || 'Could not complete the password reset request.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (emailPreset: string) => {
    setLocalError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      let loggedInUser;
      if (isFirebaseMode) {
        // In real Firebase mode, we use a standard sandbox password
        try {
          loggedInUser = await signIn(emailPreset, 'password123');
        } catch (signInErr: any) {
          console.log(`Sandbox account not found or failed to sign in, attempting auto-signup for ${emailPreset}...`);
          loggedInUser = await signUp(emailPreset, 'password123');
        }
      } else {
        loggedInUser = await signIn(emailPreset, 'mock-sandbox-pass');
      }

      if (loggedInUser) {
        if (loggedInUser.onboarded) {
          navigate('/dashboard');
        } else {
          navigate('/onboarding');
        }
      }
    } catch (err: any) {
      // In case account is not yet provisioned in Firebase, we can populate the form for them
      setEmail(emailPreset);
      setPassword('password123');
      setMode('signup');
      setLocalError(err.message || `This sandbox email is unprovisioned in Firebase Auth. We populated the form so you can click 'Create Account' below to register it instantly!`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="login-view-container" className="min-h-[80vh] flex items-center justify-center py-8 md:py-12 px-2 md:px-4 font-sans select-none">
      <div className="max-w-md w-full bg-white border border-slate-200/80 hexa-brand-card rounded-[2rem] p-7 sm:p-8 transition-all duration-300 relative overflow-hidden">
        
        {/* HEXA'S Product Identity */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[var(--hexa-navy)] via-[var(--hexa-navy)] to-[var(--hexa-red)]" aria-hidden="true" />
        <div className="mb-8">
          <div className="flex justify-center mb-7">
            <HexasBrand />
          </div>
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--hexa-soft-blue)] text-[var(--hexa-navy)] px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] mb-3">
              <Sparkles size={11} className="text-[var(--hexa-red)]" /> Student Portal
            </span>
            <h2 className="text-2xl font-black text-slate-950 tracking-tight">
              {mode === 'signin' && 'Welcome back'}
              {mode === 'signup' && 'Create your student profile'}
              {mode === 'forgot' && 'Reset your password'}
            </h2>
            <p className="text-slate-500 text-xs mt-1.5 max-w-xs mx-auto leading-relaxed">
              {mode === 'signin' && "Sign in to your HEXA'S Speaking AI workspace to practice, review sessions and track IELTS progress."}
              {mode === 'signup' && "Create your HEXA'S Speaking AI profile and begin structured IELTS speaking practice."}
              {mode === 'forgot' && 'Enter your registered email address and we will send a secure reset link.'}
            </p>
          </div>
        </div>

        {/* Global Notifications Panel */}
        {localError && (
          <div id="auth-error-banner" className="bg-red-50 border border-red-100 text-red-700 text-xs font-semibold px-4 py-3 rounded-2xl mb-6 leading-relaxed flex items-start gap-2 animate-fade-in">
            <span className="mt-0.5 shrink-0 font-bold">⚠️</span>
            <span>{localError}</span>
          </div>
        )}

        {successMessage && (
          <div id="auth-success-banner" className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs font-semibold px-4 py-3 rounded-2xl mb-6 leading-relaxed flex items-start gap-2 animate-fade-in">
            <span className="mt-0.5 shrink-0 font-bold">✓</span>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Form rendering */}
        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <Mail size={16} />
                </span>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none hexa-focus transition-all duration-150 text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="login-password" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setLocalError(''); setSuccessMessage(''); }}
                  className="text-[11px] font-bold text-[var(--hexa-navy)] hover:text-[var(--hexa-red)] transition duration-150 cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <Lock size={16} />
                </span>
                <input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none hexa-focus transition-all duration-150 text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            <button
              id="login-submit-button"
              type="submit"
              disabled={loading}
              className="w-full hexa-primary-btn disabled:bg-gray-400 text-white font-bold py-3.5 px-4 rounded-2xl transition duration-150 cursor-pointer flex justify-center items-center gap-2 text-sm min-h-[44px]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            <div className="text-center pt-2">
              <span className="text-xs text-gray-500">Don't have an account? </span>
              <button
                type="button"
                onClick={() => { setMode('signup'); setLocalError(''); setSuccessMessage(''); }}
                className="text-xs font-bold text-[var(--hexa-navy)] hover:text-[var(--hexa-red)] hover:underline transition cursor-pointer"
              >
                Create Account
              </button>
            </div>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-5">
            <div>
              <label htmlFor="signup-email" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <Mail size={16} />
                </span>
                <input
                  id="signup-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none hexa-focus transition-all duration-150 text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            <div>
              <label htmlFor="signup-password" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Create Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <Lock size={16} />
                </span>
                <input
                  id="signup-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full pl-10 pr-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none hexa-focus transition-all duration-150 text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            <div>
              <label htmlFor="signup-confirm-password" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <KeyRound size={16} />
                </span>
                <input
                  id="signup-confirm-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  className="w-full pl-10 pr-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none hexa-focus transition-all duration-150 text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            <button
              id="signup-submit-button"
              type="submit"
              disabled={loading}
              className="w-full hexa-primary-btn disabled:bg-gray-400 text-white font-bold py-3.5 px-4 rounded-2xl transition duration-150 cursor-pointer flex justify-center items-center gap-2 text-sm min-h-[44px]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>

            <div className="text-center pt-2">
              <span className="text-xs text-gray-500">Already registered? </span>
              <button
                type="button"
                onClick={() => { setMode('signin'); setLocalError(''); setSuccessMessage(''); }}
                className="text-xs font-bold text-[var(--hexa-navy)] hover:text-[var(--hexa-red)] hover:underline transition cursor-pointer"
              >
                Sign In Instead
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-5">
            <div>
              <label htmlFor="forgot-email" className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Registered Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <Mail size={16} />
                </span>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-3.5 bg-gray-50/50 border border-gray-200 rounded-2xl text-sm focus:outline-none hexa-focus transition-all duration-150 text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            <button
              id="forgot-submit-button"
              type="submit"
              disabled={loading}
              className="w-full hexa-primary-btn disabled:bg-gray-400 text-white font-bold py-3.5 px-4 rounded-2xl transition duration-150 cursor-pointer flex justify-center items-center gap-2 text-sm min-h-[44px]"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <span>Send Reset Link</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => { setMode('signin'); setLocalError(''); setSuccessMessage(''); }}
              className="w-full flex items-center justify-center gap-1 text-xs font-bold text-gray-500 hover:text-gray-950 py-2 transition cursor-pointer"
            >
              <ArrowLeft size={14} />
              <span>Back to Sign In</span>
            </button>
          </form>
        )}

        {/* Development Sandbox Toggles */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-100"></div>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold">
            <span className="bg-white px-3 text-gray-400">Development Sandbox</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            id="quick-login-student"
            type="button"
            onClick={() => handleQuickLogin('student@speakready.com')}
            className="border border-gray-100 hover:border-gray-200 bg-gray-50/30 hover:bg-gray-50 text-xs font-bold text-gray-700 py-3 px-2 rounded-2xl transition duration-150 cursor-pointer text-center min-h-[44px]"
          >
            Candidate Profile
          </button>
          <button
            id="quick-login-advanced"
            type="button"
            onClick={() => handleQuickLogin('advanced@speakready.com')}
            className="border border-gray-100 hover:border-gray-200 bg-gray-50/30 hover:bg-gray-50 text-xs font-bold text-gray-700 py-3 px-2 rounded-2xl transition duration-150 cursor-pointer text-center min-h-[44px]"
          >
            Expert Speaker
          </button>
        </div>

        {isFirebaseMode && (
          <p className="text-[10px] text-center text-gray-400 mt-4 leading-normal">
            ✓ Firebase Auth is fully active. Accounts will persist securely in the cloud.
          </p>
        )}
      </div>
    </div>
  );
};
export default LoginView;
