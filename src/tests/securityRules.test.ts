/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { checkEndpointRateLimit, checkAndIncrementUserLimit, DAILY_LIMITS } from '../services/serverLimitsService';
import fs from 'fs';
import path from 'path';

describe('Security Rules & Server Limit Enforcement Tests', () => {
  beforeEach(() => {
    // Reset test isolation
  });

  describe('1. Firestore Security Rules Policy Inspection', () => {
    const rulesPath = path.join(process.cwd(), 'firestore.rules');
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');

    it('denies unauthenticated access by default', () => {
      expect(rulesContent).toContain('allow read, write: if false;');
    });

    it('enforces own-user isolation on user profiles and speaking sessions', () => {
      expect(rulesContent).toContain('request.auth.uid == userId');
      expect(rulesContent).toContain('resource.data.userId == request.auth.uid');
    });

    it('prevents forged-admin role escalation on user documents', () => {
      expect(rulesContent).toContain("request.resource.data.role == 'student'");
      expect(rulesContent).toContain("(!request.resource.data.keys().hasAny(['admin']) || isAdmin())");
      expect(rulesContent).toContain("request.resource.data.diff(resource.data).affectedKeys()");
    });

    it('enforces immutable test snapshot fields', () => {
      expect(rulesContent).toContain("!request.resource.data.keys().hasAny(['selectedTestSnapshot'])");
      expect(rulesContent).toContain("request.resource.data.selectedTestSnapshot == resource.data.selectedTestSnapshot");
    });

    it('protects evaluations subcollection to admin/server writes only', () => {
      expect(rulesContent).toContain('match /evaluations/{evaluationId}');
      expect(rulesContent).toContain('allow create, update: if isAdmin();');
    });

    it('makes usageEvents write-once and immutable', () => {
      expect(rulesContent).toContain('match /usageEvents/{eventId}');
      expect(rulesContent).toContain('allow update, delete: if false;');
    });
  });

  describe('2. Cloud Storage Security Rules Policy Inspection', () => {
    const storageRulesPath = path.join(process.cwd(), 'storage.rules');
    const storageRulesContent = fs.readFileSync(storageRulesPath, 'utf8');

    it('restricts recording paths strictly to owner uid match', () => {
      expect(storageRulesContent).toContain('match /speaking-recordings/{uid}/{sessionId}/{recordingId}');
      expect(storageRulesContent).toContain('request.auth != null && request.auth.uid == uid');
    });

    it('enforces audio MIME type and size validation on recording uploads', () => {
      expect(storageRulesContent).toContain("request.resource.contentType.matches('audio/.*')");
      expect(storageRulesContent).toContain('request.resource.size <= 25 * 1024 * 1024');
    });
  });

  describe('3. Server Endpoint Rate Limiter & Abuse Safeguards', () => {
    it('allows requests within threshold and blocks requests exceeding limit', () => {
      const clientKey = `test-ip-${Date.now()}`;

      // Execute up to threshold (30 requests)
      for (let i = 0; i < 30; i++) {
        const check = checkEndpointRateLimit(clientKey);
        expect(check.allowed).toBe(true);
      }

      // 31st request should be rate limited
      const blockedCheck = checkEndpointRateLimit(clientKey);
      expect(blockedCheck.allowed).toBe(false);
      expect(blockedCheck.remaining).toBe(0);
      expect(blockedCheck.resetTimeMs).toBeGreaterThan(0);
    });
  });

  describe('4. Per-User Daily Resource Limits', () => {
    it('enforces max 15 practice sessions per user per day', async () => {
      const userId = `test-limit-user-sessions-${Date.now()}`;

      // Consume 15 session creations
      for (let i = 0; i < 15; i++) {
        const result = await checkAndIncrementUserLimit(userId, 'session');
        expect(result.allowed).toBe(true);
        expect(result.currentCount).toBe(i + 1);
      }

      // 16th session creation must be blocked
      const blockedResult = await checkAndIncrementUserLimit(userId, 'session');
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.currentCount).toBe(15);
      expect(blockedResult.maxAllowed).toBe(DAILY_LIMITS.MAX_SESSIONS_PER_DAY);
      expect(blockedResult.message).toContain('Daily limit reached');
    });

    it('enforces max 20 ephemeral token mints per user per day', async () => {
      const userId = `test-limit-user-tokens-${Date.now()}`;

      for (let i = 0; i < 20; i++) {
        const result = await checkAndIncrementUserLimit(userId, 'token');
        expect(result.allowed).toBe(true);
      }

      const blockedResult = await checkAndIncrementUserLimit(userId, 'token');
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.maxAllowed).toBe(DAILY_LIMITS.MAX_TOKENS_MINTED_PER_DAY);
    });

    it('enforces max 10 evaluation generations per user per day', async () => {
      const userId = `test-limit-user-evals-${Date.now()}`;

      for (let i = 0; i < 10; i++) {
        const result = await checkAndIncrementUserLimit(userId, 'evaluation');
        expect(result.allowed).toBe(true);
      }

      const blockedResult = await checkAndIncrementUserLimit(userId, 'evaluation');
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.maxAllowed).toBe(DAILY_LIMITS.MAX_EVALUATIONS_PER_DAY);
    });
  });
});
