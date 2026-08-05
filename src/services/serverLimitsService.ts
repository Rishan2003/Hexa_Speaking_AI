/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getFirebaseAdmin,
  isFirestoreServerAvailable,
  markFirestoreServerUnavailable,
} from './firebaseServer';
import { ServerLogger } from './serverLogger';

export interface UserLimitStatus {
  userId: string;
  sessionsToday: number;
  tokensMintedToday: number;
  evaluationsToday: number;
  lastResetTimestamp: number;
}

export interface LimitCheckResult {
  allowed: boolean;
  limitType: 'session' | 'token' | 'evaluation' | 'rate_limit';
  currentCount: number;
  maxAllowed: number;
  resetTimeMs: number;
  message?: string;
}

// Daily Limit Constants
export const DAILY_LIMITS = {
  MAX_SESSIONS_PER_DAY: 15,
  MAX_TOKENS_MINTED_PER_DAY: 20,
  MAX_EVALUATIONS_PER_DAY: 10,
  DAY_IN_MS: 24 * 60 * 60 * 1000
};

// In-Memory Fallback Cache for Limits (used in sandbox or for fast checking)
const memoryLimitsMap = new Map<string, UserLimitStatus>();

// General IP / User Endpoint Rate Limiter (e.g. 30 requests per minute)
const endpointRateLimitsMap = new Map<string, number[]>();
const ENDPOINT_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_ENDPOINT_REQUESTS_PER_WINDOW = 30;

/**
 * Checks endpoint request rate limit for an IP or userId
 */
export function checkEndpointRateLimit(clientKey: string): { allowed: boolean; remaining: number; resetTimeMs: number } {
  const now = Date.now();
  const timestamps = endpointRateLimitsMap.get(clientKey) || [];
  
  // Clean expired timestamps
  const validTimestamps = timestamps.filter(ts => now - ts < ENDPOINT_RATE_LIMIT_WINDOW_MS);
  endpointRateLimitsMap.set(clientKey, validTimestamps);

  if (validTimestamps.length >= MAX_ENDPOINT_REQUESTS_PER_WINDOW) {
    const oldest = validTimestamps[0];
    const resetTimeMs = oldest + ENDPOINT_RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, remaining: 0, resetTimeMs };
  }

  validTimestamps.push(now);
  endpointRateLimitsMap.set(clientKey, validTimestamps);

  return { allowed: true, remaining: MAX_ENDPOINT_REQUESTS_PER_WINDOW - validTimestamps.length, resetTimeMs: 0 };
}

/**
 * Fetches or initializes user daily limits from Firestore or memory
 */
export async function getUserDailyLimits(userId: string): Promise<UserLimitStatus> {
  const now = Date.now();

  if (isFirestoreServerAvailable()) {
    try {
      const db = getFirebaseAdmin().firestore();
      const limitRef = db.collection('userLimits').doc(userId);
      const docSnap = await limitRef.get();

      if (docSnap.exists) {
        const data = docSnap.data() as UserLimitStatus;
        // Check if 24 hours have elapsed since last reset
        if (now - data.lastResetTimestamp > DAILY_LIMITS.DAY_IN_MS) {
          const resetStatus: UserLimitStatus = {
            userId,
            sessionsToday: 0,
            tokensMintedToday: 0,
            evaluationsToday: 0,
            lastResetTimestamp: now
          };
          await limitRef.set(resetStatus, { merge: true });
          return resetStatus;
        }
        return data;
      } else {
        const initialStatus: UserLimitStatus = {
          userId,
          sessionsToday: 0,
          tokensMintedToday: 0,
          evaluationsToday: 0,
          lastResetTimestamp: now
        };
        await limitRef.set(initialStatus);
        return initialStatus;
      }
    } catch (err) {
      markFirestoreServerUnavailable(err);
      ServerLogger.warn('Failed to fetch user limits from Firestore. Falling back to memory limits cache.', { userId, error: (err as any).message });
    }
  }

  // Memory Fallback
  let cached = memoryLimitsMap.get(userId);
  if (!cached || now - cached.lastResetTimestamp > DAILY_LIMITS.DAY_IN_MS) {
    cached = {
      userId,
      sessionsToday: 0,
      tokensMintedToday: 0,
      evaluationsToday: 0,
      lastResetTimestamp: now
    };
    memoryLimitsMap.set(userId, cached);
  }
  return cached;
}

/**
 * Checks and increments a specific daily resource count for a user (session creation, token minting, evaluation)
 */
export async function checkAndIncrementUserLimit(
  userId: string,
  limitType: 'session' | 'token' | 'evaluation'
): Promise<LimitCheckResult> {
  const limitStatus = await getUserDailyLimits(userId);
  const now = Date.now();
  const resetTimeMs = Math.max(0, limitStatus.lastResetTimestamp + DAILY_LIMITS.DAY_IN_MS - now);

  let currentCount = 0;
  let maxAllowed = 0;

  switch (limitType) {
    case 'session':
      currentCount = limitStatus.sessionsToday;
      maxAllowed = DAILY_LIMITS.MAX_SESSIONS_PER_DAY;
      break;
    case 'token':
      currentCount = limitStatus.tokensMintedToday;
      maxAllowed = DAILY_LIMITS.MAX_TOKENS_MINTED_PER_DAY;
      break;
    case 'evaluation':
      currentCount = limitStatus.evaluationsToday;
      maxAllowed = DAILY_LIMITS.MAX_EVALUATIONS_PER_DAY;
      break;
  }

  if (currentCount >= maxAllowed) {
    ServerLogger.warn(`User daily limit reached for ${limitType}`, {
      userId,
      limitType,
      currentCount,
      maxAllowed,
      resetTimeMs
    });

    return {
      allowed: false,
      limitType,
      currentCount,
      maxAllowed,
      resetTimeMs,
      message: `Daily limit reached for practice ${limitType}s (${currentCount}/${maxAllowed}). Limit resets in ${Math.ceil(resetTimeMs / 60000)} minutes.`
    };
  }

  // Increment limit
  const updatedStatus: UserLimitStatus = {
    ...limitStatus,
    sessionsToday: limitType === 'session' ? limitStatus.sessionsToday + 1 : limitStatus.sessionsToday,
    tokensMintedToday: limitType === 'token' ? limitStatus.tokensMintedToday + 1 : limitStatus.tokensMintedToday,
    evaluationsToday: limitType === 'evaluation' ? limitStatus.evaluationsToday + 1 : limitStatus.evaluationsToday
  };

  memoryLimitsMap.set(userId, updatedStatus);

  if (isFirestoreServerAvailable()) {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('userLimits').doc(userId).set(updatedStatus, { merge: true });
    } catch (err) {
      markFirestoreServerUnavailable(err);
      ServerLogger.warn('Failed to persist limit update to Firestore; memory limits remain active.', { userId, limitType, error: (err as any).message });
    }
  }

  return {
    allowed: true,
    limitType,
    currentCount: currentCount + 1,
    maxAllowed,
    resetTimeMs
  };
}
