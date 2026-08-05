/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { deleteField, doc, getDoc, setDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import {
  isFirebaseEnabled,
  getFirebaseAuth,
  getFirebaseDb,
  getUsersCollection,
  isFirestoreConnectivityError,
  reconnectFirebaseNetwork,
} from './firebaseClient';
import { MockAuthService } from './mockService';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  isFirebaseMode: boolean;
  signUp: (email: string, password: string) => Promise<UserProfile>;
  signIn: (email: string, password: string) => Promise<UserProfile>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<UserProfile>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const PROFILE_CACHE_PREFIX = 'speakready_firebase_profile_v1:';
const FIRESTORE_WRITE_GRACE_MS = 4500;

function profileCacheKey(uid: string): string {
  return `${PROFILE_CACHE_PREFIX}${uid}`;
}

function readCachedProfile(uid: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(profileCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile;
    return parsed?.uid === uid ? parsed : null;
  } catch {
    return null;
  }
}

function cacheProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(profileCacheKey(profile.uid), JSON.stringify(profile));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function clearCachedProfile(uid?: string): void {
  if (!uid) return;
  try {
    localStorage.removeItem(profileCacheKey(uid));
  } catch {
    // Ignore browser storage cleanup failures.
  }
}

function clearPrivateSessionArtifacts(): void {
  // Keep device-level preferences (recording consent, difficulty, mock toggle),
  // but remove authenticated/session-specific recovery data on explicit logout.
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('speakready_recovery_snapshot');
      sessionStorage.removeItem('speakready_tab_id');
    }
  } catch {
    // Ignore restricted/private browser storage failures.
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('speakready_pending_writes_queue');
      const leaseKeys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('speakready_session_lease_')) {
          leaseKeys.push(key);
        }
      }
      leaseKeys.forEach((key) => localStorage.removeItem(key));
    }
  } catch {
    // Logout should still succeed even when browser storage cleanup is blocked.
  }
}

function profileFromFirebaseUser(fbUser: FirebaseUser, fallbackEmail?: string): UserProfile {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    displayName:
      fbUser.displayName ||
      fbUser.email?.split('@')[0] ||
      fallbackEmail?.split('@')[0] ||
      'IELTS Candidate',
    photoURL: fbUser.photoURL || `https://api.dicebear.com/7.x/adventurer/svg?seed=${fbUser.uid}`,
    onboarded: false,
  };
}

async function writeProfileWithOfflineTolerance(
  userRef: ReturnType<typeof doc>,
  payload: Record<string, unknown>,
): Promise<'synced' | 'queued'> {
  const writePromise = setDoc(userRef as any, payload as any, { merge: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'queued'>((resolve) => {
    timeoutId = setTimeout(() => resolve('queued'), FIRESTORE_WRITE_GRACE_MS);
  });

  const result = await Promise.race([
    writePromise
      .then(() => 'synced' as const)
      .catch((error) => ({ failed: true as const, error })),
    timeoutPromise,
  ]);

  if (timeoutId) clearTimeout(timeoutId);

  if (typeof result === 'object') {
    throw result.error;
  }

  if (result === 'queued') {
    // Firestore write promises wait for server acknowledgement. When a proxy or
    // temporary outage blocks Firestore, retain the local profile and allow the
    // SDK to finish syncing later instead of trapping onboarding indefinitely.
    void writePromise.catch((error) => {
      console.warn('Deferred Firestore profile sync failed:', error);
    });
  }

  return result;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFirebaseMode = isFirebaseEnabled();

  // Strip custom roles/admin claims and separate real values from fields the
  // user intentionally cleared. Firestore does not accept raw `undefined`.
  const sanitizeProfile = (profile: Partial<UserProfile>) => {
    const sanitized = { ...profile } as Record<string, unknown>;

    // Prevent client-side privilege injection.
    delete sanitized.role;
    delete sanitized.admin;

    const values: Partial<UserProfile> = {};
    const clearedKeys: Array<Extract<keyof UserProfile, string>> = [];

    for (const [key, value] of Object.entries(sanitized)) {
      if (value === undefined) {
        clearedKeys.push(key as Extract<keyof UserProfile, string>);
      } else {
        (values as Record<string, unknown>)[key] = value;
      }
    }

    return { values, clearedKeys };
  };

  useEffect(() => {
    if (!isFirebaseMode) {
      const localUser = MockAuthService.getCurrentUser();
      setUser(localUser);
      setLoading(false);
      return;
    }

    try {
      const auth = getFirebaseAuth();
      const unsubscribe = onAuthStateChanged(auth, (fbUser: FirebaseUser | null) => {
        if (!fbUser) {
          setUser(null);
          setLoading(false);
          return;
        }

        // Authentication is authoritative. Do not hold the complete application
        // behind a Firestore transport handshake; render from a local profile and
        // reconcile the cloud copy in the background.
        const localProfile = readCachedProfile(fbUser.uid) || profileFromFirebaseUser(fbUser);
        setUser(localProfile);
        setLoading(false);

        void (async () => {
          try {
            const db = getFirebaseDb();
            const userRef = doc(getUsersCollection(db), fbUser.uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
              const remoteProfile = userSnap.data() as UserProfile;
              cacheProfile(remoteProfile);
              setUser(remoteProfile);
            }
          } catch (syncError) {
            if (isFirestoreConnectivityError(syncError)) {
              console.warn('Firestore profile sync is temporarily offline; using the local authenticated profile.');
              void reconnectFirebaseNetwork();
              return;
            }
            console.error('Failed to sync authenticated user profile from Firestore:', syncError);
          }
        })();
      });

      return () => unsubscribe();
    } catch (observerError) {
      console.error('Failed to set up Firebase Auth observer:', observerError);
      const localUser = MockAuthService.getCurrentUser();
      setUser(localUser);
      setLoading(false);
    }
  }, [isFirebaseMode]);

  const signUp = async (email: string, password: string): Promise<UserProfile> => {
    setError(null);
    setLoading(true);

    if (!isFirebaseMode) {
      const mockUser = MockAuthService.login(email, 7.0);
      mockUser.onboarded = false;
      localStorage.setItem('speakready_user_mock', JSON.stringify(mockUser));
      setUser(mockUser);
      setLoading(false);
      return mockUser;
    }

    try {
      const auth = getFirebaseAuth();
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const fbUser = credential.user;
      const newProfile = profileFromFirebaseUser(fbUser, email);

      cacheProfile(newProfile);
      setUser(newProfile);
      setLoading(false);

      const db = getFirebaseDb();
      const userRef = doc(getUsersCollection(db), fbUser.uid);
      await writeProfileWithOfflineTolerance(userRef, {
        ...newProfile,
        role: 'student',
        createdAt: Date.now(),
      });

      return newProfile;
    } catch (signUpError: any) {
      setLoading(false);
      if (signUpError.code && signUpError.code.startsWith('auth/')) {
        let friendlyMessage = 'Failed to create your account. Please check your credentials or try signing in.';
        if (signUpError.code === 'auth/weak-password') {
          friendlyMessage = 'The password is too weak. Please provide at least 6 characters.';
        } else if (signUpError.code === 'auth/email-already-in-use') {
          friendlyMessage = 'An account with this email address already exists. Please try signing in instead.';
        } else if (signUpError.code === 'auth/invalid-email') {
          friendlyMessage = 'Please enter a valid email address.';
        }
        setError(friendlyMessage);
        throw new Error(friendlyMessage);
      }

      if (isFirestoreConnectivityError(signUpError) && getFirebaseAuth().currentUser) {
        const fallback = readCachedProfile(getFirebaseAuth().currentUser!.uid) || profileFromFirebaseUser(getFirebaseAuth().currentUser!, email);
        setUser(fallback);
        setLoading(false);
        void reconnectFirebaseNetwork();
        return fallback;
      }

      const actualMessage = signUpError.message || String(signUpError);
      setError(actualMessage);
      throw signUpError;
    }
  };

  const signIn = async (email: string, password: string): Promise<UserProfile> => {
    setError(null);
    setLoading(true);

    if (!isFirebaseMode) {
      const mockUser = MockAuthService.login(email, 7.0);
      setUser(mockUser);
      setLoading(false);
      return mockUser;
    }

    try {
      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const fbUser = credential.user;
      const fallbackProfile = readCachedProfile(fbUser.uid) || profileFromFirebaseUser(fbUser, email);

      setUser(fallbackProfile);
      setLoading(false);

      try {
        const db = getFirebaseDb();
        const userRef = doc(getUsersCollection(db), fbUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const profile = userSnap.data() as UserProfile;
          cacheProfile(profile);
          setUser(profile);
          return profile;
        }

        await writeProfileWithOfflineTolerance(userRef, {
          ...fallbackProfile,
          role: 'student',
          createdAt: Date.now(),
        });
      } catch (profileError) {
        if (!isFirestoreConnectivityError(profileError)) throw profileError;
        console.warn('Signed in successfully, but Firestore profile sync is offline.');
        void reconnectFirebaseNetwork();
      }

      return fallbackProfile;
    } catch (signInError: any) {
      setLoading(false);
      if (signInError.code && signInError.code.startsWith('auth/')) {
        const friendlyMessage = 'Incorrect email or password. Please try again.';
        setError(friendlyMessage);
        throw new Error(friendlyMessage);
      }

      const actualMessage = signInError.message || String(signInError);
      setError(actualMessage);
      throw signInError;
    }
  };

  const signOut = async (): Promise<void> => {
    setError(null);
    setLoading(true);

    if (!isFirebaseMode) {
      MockAuthService.logout();
      clearPrivateSessionArtifacts();
      setUser(null);
      setLoading(false);
      return;
    }

    const uid = user?.uid;
    try {
      const auth = getFirebaseAuth();
      await fbSignOut(auth);
      clearCachedProfile(uid);
      clearPrivateSessionArtifacts();
      setUser(null);
      setLoading(false);
    } catch (signOutError) {
      setLoading(false);
      setError('Failed to sign out. Please try again.');
      throw signOutError;
    }
  };

  const resetPassword = async (email: string): Promise<void> => {
    setError(null);
    if (!isFirebaseMode) {
      console.log(`[MockAuthService] Password reset link simulated to email: ${email}`);
      return;
    }

    try {
      const auth = getFirebaseAuth();
      await sendPasswordResetEmail(auth, email);
    } catch (resetError: any) {
      if (resetError.code === 'auth/invalid-email') {
        const errorMsg = 'Please enter a valid email address.';
        setError(errorMsg);
        throw new Error(errorMsg);
      }
      console.warn('Password reset error suppressed or processed securely:', resetError.code);
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>): Promise<UserProfile> => {
    if (!user) {
      throw new Error('No authenticated user profile exists to update.');
    }

    const { values: sanitizedUpdates, clearedKeys } = sanitizeProfile(updates);
    const updatedProfile: UserProfile = {
      ...user,
      ...sanitizedUpdates,
    } as UserProfile;

    for (const key of clearedKeys) {
      delete (updatedProfile as Partial<UserProfile>)[key];
    }

    if (!isFirebaseMode) {
      localStorage.setItem('speakready_user_mock', JSON.stringify(updatedProfile));
      setUser(updatedProfile);
      return updatedProfile;
    }

    // Save the completed onboarding/profile locally first. Firestore can then
    // synchronize without controlling navigation or trapping the user offline.
    cacheProfile(updatedProfile);
    setUser(updatedProfile);

    try {
      const db = getFirebaseDb();
      const userRef = doc(getUsersCollection(db), user.uid);
      const firestoreProfile: Record<string, unknown> = {
        ...updatedProfile,
        role: 'student',
        createdAt: Date.now(),
      };

      for (const key of clearedKeys) {
        firestoreProfile[key] = deleteField();
      }

      await writeProfileWithOfflineTolerance(userRef, firestoreProfile);
      return updatedProfile;
    } catch (profileError) {
      if (isFirestoreConnectivityError(profileError)) {
        console.warn('Profile saved locally; Firestore synchronization is temporarily offline.');
        void reconnectFirebaseNetwork();
        return updatedProfile;
      }

      console.error('Failed to update user profile in Firestore:', profileError);
      setError('Your profile was saved locally, but cloud synchronization was rejected. Check Firestore setup and rules.');
      throw profileError;
    }
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      error,
      isFirebaseMode,
      signUp,
      signIn,
      signOut,
      resetPassword,
      updateProfile,
      clearError
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
