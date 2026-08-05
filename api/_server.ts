/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { generateTestSnapshot } from '../src/services/questionBank';
import {
  getFirebaseAdmin,
  isFirebaseServerEnabled,
  isFirestoreServerAvailable,
  markFirestoreServerUnavailable,
  deleteSessionRecursively,
} from '../src/services/firebaseServer';
import { MockPracticeService } from '../src/services/mockService';
import { ServerLogger } from '../src/services/serverLogger';
import { checkEndpointRateLimit, checkAndIncrementUserLimit } from '../src/services/serverLimitsService';
import { validateEnvironmentVariables } from '../src/services/envValidation';

// Load local overrides first, then shared defaults. Local files remain git-ignored.
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

const serverStartTime = Date.now();

async function createApp() {
  // Session-critical modules are statically imported above so Vercel's Node File Trace
  // can include them deterministically in the deployed Function bundle.

  const app = express();
  app.set('trust proxy', 1);

  async function resolveRequestUserId(req: any, res: any): Promise<string | null> {
    const authHeader = req.headers.authorization;

    if (!isFirebaseServerEnabled() && process.env.NODE_ENV === 'production') {
      res.status(503).json({
        error: 'Server authentication is not configured. Firebase Admin credentials are required in production.',
      });
      return null;
    }

    if (isFirebaseServerEnabled()) {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication is required.' });
        return null;
      }

      try {
        const token = authHeader.slice('Bearer '.length).trim();
        const decoded = await getFirebaseAdmin().auth().verifyIdToken(token);
        return decoded.uid;
      } catch (error) {
        ServerLogger.warn('Firebase ID token verification failed', {
          requestId: req.requestId,
          error: (error as Error).message,
        });
        res.status(401).json({ error: 'Unauthorized: Invalid ID token.' });
        return null;
      }
    }

    if (authHeader?.startsWith('Bearer mock-token-')) {
      return authHeader.slice('Bearer mock-token-'.length).trim() || 'mock-user-id';
    }

    return 'mock-user-id';
  }

  app.use(express.json({ limit: '1mb' }));

  // Middleware 1: HTTP Security Headers & CORS Handling
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
    if (origin && allowedOriginsEnv) {
      const allowedList = allowedOriginsEnv.split(',').map(s => s.trim());
      if (allowedList.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
      }
    }

    const scriptPolicy = process.env.NODE_ENV === 'production'
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; ${scriptPolicy}; connect-src 'self' wss://generativelanguage.googleapis.com https://generativelanguage.googleapis.com https://*.firebaseio.com https://*.googleapis.com wss://*.firebaseio.com; frame-src 'self' https://*.firebaseapp.com https://*.web.app; worker-src 'self' blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    next();
  });

  // Middleware 2: Request ID & Endpoint Rate Limiting
  app.use('/api', (req: any, res: any, next: any) => {
    req.requestId = req.headers['x-request-id'] || `req-${randomUUID()}`;
    res.setHeader('X-Request-ID', req.requestId);

    const clientKey = req.ip || req.headers['x-forwarded-for'] || 'anonymous-client';
    const rateCheck = checkEndpointRateLimit(clientKey);

    if (!rateCheck.allowed) {
      ServerLogger.warn('Endpoint request rate limit exceeded', {
        requestId: req.requestId,
        clientKey,
        route: req.originalUrl
      });
      return res.status(429).json({ error: 'Too many requests. Please wait a minute before making additional requests.' });
    }

    next();
  });

  // API ROUTE 1: Health & Readiness Diagnostics
  app.get('/api/health', (req: any, res: any) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000)
    });
  });

  app.get('/api/readiness', async (req: any, res: any) => {
    const envReport = validateEnvironmentVariables();

    // Configuration presence alone is not enough on serverless hosts: a malformed,
    // revoked, or wrong-project service account can initialize Firebase Admin yet
    // fail on the first Firestore RPC. Probe the real database without exposing
    // credential details so deployment problems are diagnosable before a test starts.
    let firestoreReachable = false;
    let firestoreStatus = isFirebaseServerEnabled() ? 'not_probed' : 'firebase_admin_disabled';

    if (isFirebaseServerEnabled()) {
      try {
        const db = getFirebaseAdmin().firestore();
        const probe = db.collection('__speakready_health__').limit(1).get();
        await Promise.race([
          probe,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore readiness probe timed out.')), 6000)),
        ]);
        firestoreReachable = true;
        firestoreStatus = 'reachable';
      } catch (probeError: any) {
        const rawCode = String(probeError?.code ?? '').toLowerCase();
        const rawMessage = String(probeError?.message ?? '').toLowerCase();
        markFirestoreServerUnavailable(probeError);

        if (rawCode.includes('16') || rawCode.includes('unauthenticated') || rawMessage.includes('invalid jwt') || rawMessage.includes('invalid_grant')) {
          firestoreStatus = 'credential_error';
        } else if (rawCode.includes('5') || rawCode.includes('not-found') || rawMessage.includes('database') && rawMessage.includes('does not exist')) {
          firestoreStatus = 'database_not_found';
        } else if (rawCode.includes('7') || rawCode.includes('permission-denied')) {
          firestoreStatus = 'permission_denied';
        } else if (rawCode.includes('4') || rawCode.includes('14') || rawCode.includes('unavailable') || rawMessage.includes('timed out')) {
          firestoreStatus = 'temporarily_unavailable';
        } else {
          firestoreStatus = 'probe_failed';
        }

        ServerLogger.warn('Firestore readiness probe failed', {
          requestId: req.requestId,
          firestoreStatus,
          code: probeError?.code,
          error: probeError?.message,
        });
      }
    }

    const productionBlocked = process.env.NODE_ENV === 'production' && !envReport.firebaseServerConfigured;
    const status = productionBlocked
      ? 'misconfigured'
      : envReport.status === 'ready' && !firestoreReachable
        ? 'degraded'
        : envReport.status;

    res.status(productionBlocked ? 503 : 200).json({
      status,
      timestamp: Date.now(),
      uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
      runtime: process.env.VERCEL ? 'vercel' : 'node',
      environment: {
        geminiApiKeyConfigured: envReport.geminiApiKeyConfigured,
        firebaseServerConfigured: envReport.firebaseServerConfigured,
        firestoreReachable,
        firestoreStatus,
        allowedOriginsConfigured: envReport.allowedOriginsConfigured,
        geminiLiveModel: envReport.geminiLiveModel,
        geminiEvaluationModel: envReport.geminiEvaluationModel
      },
      warnings: [
        ...envReport.warnings,
        ...(!firestoreReachable && envReport.firebaseServerConfigured
          ? [`Firebase Admin is configured, but Firestore probe status is: ${firestoreStatus}. Session creation will use recovery mode until Firestore is reachable.`]
          : [])
      ]
    });
  });

  // API ROUTE 2: Secure Server-Only Session Creation with Test Snapshot Selection
  app.post('/api/session/create', async (req: any, res: any) => {
    const startTime = Date.now();
    let stage = 'request';
    try {
      ServerLogger.info('Session creation request received', {
        requestId: req.requestId,
        mode: req.body?.mode ?? 'full',
        vercel: Boolean(process.env.VERCEL),
      });

      stage = 'authentication';
      const userId = await resolveRequestUserId(req, res);
      if (!userId) return;

      stage = 'request_validation';
      const requestedMode = req.body?.mode ?? 'full';
      if (!['full', 'part1', 'part2', 'part3'].includes(requestedMode)) {
        return res.status(400).json({ error: 'Invalid mode. Expected full, part1, part2, or part3.', code: 'INVALID_SESSION_MODE', requestId: req.requestId });
      }

      const seed = typeof req.body?.seed === 'string' && req.body.seed.length <= 200
        ? req.body.seed
        : `seed-${randomUUID()}`;
      const cueCardId = typeof req.body?.cueCardId === 'string' ? req.body.cueCardId : undefined;

      stage = 'quota_check';
      const limitCheck = await checkAndIncrementUserLimit(userId, 'session');
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: limitCheck.message, code: 'SESSION_DAILY_LIMIT', requestId: req.requestId });
      }

      stage = 'test_generation';
      const snapshot = generateTestSnapshot(seed, requestedMode, cueCardId);

      const sessionId = `session-${randomUUID()}`;
      const newSession = {
        id: sessionId,
        userId,
        createdAt: Date.now(),
        status: 'active',
        currentPart: requestedMode === 'part3'
          ? 'PART_3'
          : requestedMode === 'part2'
            ? 'PART_2'
            : 'PART_1',
        currentState: 'IDLE',
        topic: snapshot.part2CueCard?.title || snapshot.part1Topic?.title || 'Speaking Practice',
        cueCard: snapshot.part2CueCard ? {
          id: snapshot.part2CueCard.id,
          topic: snapshot.part2CueCard.taskStatement,
          bulletPoints: snapshot.part2CueCard.bulletPrompts,
          followUpQuestions: snapshot.part3Questions ? snapshot.part3Questions.map(q => q.text) : []
        } : undefined,
        transcript: [],
        selectedTestSnapshot: snapshot,
        updatedAt: Date.now()
      };

      let persistenceMode: 'firestore' | 'recovery' = 'recovery';

      // Firestore persistence is important, but it must not prevent an authenticated
      // student from launching a test. Browser persistence and the evaluation
      // sessionEvidence payload provide recovery while deployment credentials are fixed.
      stage = 'firestore_persistence';
      if (isFirestoreServerAvailable()) {
        try {
          const db = getFirebaseAdmin().firestore();
          await db.collection('speakingSessions').doc(sessionId).set(newSession);

          const batch = db.batch();
          const parts = [
            { id: 'part-1', sessionId, partIndex: 1, status: 'idle', startedAt: Date.now() },
            { id: 'part-2', sessionId, partIndex: 2, status: 'idle', startedAt: Date.now() },
            { id: 'part-3', sessionId, partIndex: 3, status: 'idle', startedAt: Date.now() }
          ];
          parts.forEach((part) => {
            const partRef = db.collection('speakingSessions').doc(sessionId).collection('parts').doc(part.id);
            batch.set(partRef, part);
          });
          await batch.commit();
          persistenceMode = 'firestore';
        } catch (firestoreError: any) {
          // Suppress known transient/database errors when possible, but recover for
          // every Firestore RPC failure here. Authentication has already succeeded;
          // failing the entire speaking test because persistence is degraded is worse
          // than returning the authenticated session with an explicit recovery mode.
          markFirestoreServerUnavailable(firestoreError);
          ServerLogger.warn('Server Firestore persistence failed during session creation; continuing in recovery mode.', {
            requestId: req.requestId,
            sessionId,
            userId,
            code: firestoreError?.code,
            error: firestoreError?.message,
          });
        }
      }

      stage = 'recovery_cache';
      MockPracticeService.upsertSession(newSession as any);

      res.setHeader('X-SpeakReady-Persistence', persistenceMode);
      res.setHeader('X-SpeakReady-Request-ID', req.requestId);

      ServerLogger.info('Speaking session created', {
        requestId: req.requestId,
        sessionId,
        userId,
        persistenceMode,
        latencyMs: Date.now() - startTime
      });

      return res.status(201).json({
        ...newSession,
        serverPersistence: persistenceMode,
      });
    } catch (err: any) {
      ServerLogger.error('Session creation failed', 'SESSION_CREATE_FAILED', {
        requestId: req.requestId,
        stage,
        code: err?.code,
        error: err?.message || 'Unknown error',
      });

      return res.status(500).json({
        error: `Session creation failed during ${stage}.`,
        code: 'SESSION_CREATE_FAILED',
        stage,
        requestId: req.requestId,
      });
    }
  });

  // API ROUTE 3: Secure Session Token Minting for Gemini Live WebSockets
  app.post('/api/session/mint', async (req: any, res: any, next: any) => {
    const startTime = Date.now();
    try {
      let userId = 'sandbox-user';
      const authHeader = req.headers.authorization;

      if (!isFirebaseServerEnabled() && process.env.NODE_ENV === 'production') {
        return res.status(503).json({
          error: 'Live token minting is disabled until Firebase Admin authentication is configured.',
          code: 'AUTH_NOT_CONFIGURED',
        });
      }

      if (isFirebaseServerEnabled()) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Authentication is required to start a live voice session.' });
        }

        try {
          const idToken = authHeader.slice('Bearer '.length).trim();
          const decoded = await getFirebaseAdmin().auth().verifyIdToken(idToken);
          userId = decoded.uid;
        } catch (authErr) {
          ServerLogger.warn('Live token minting rejected due to an invalid Firebase ID token', {
            requestId: req.requestId,
            error: (authErr as Error).message,
          });
          return res.status(401).json({ error: 'Unauthorized: Invalid ID token.' });
        }
      } else if (authHeader?.startsWith('Bearer mock-token-')) {
        userId = authHeader.slice('Bearer mock-token-'.length).trim() || 'sandbox-user';
      }

      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        return res.status(503).json({
          error: 'Gemini Live is not configured on the server. Enable mock mode or set GEMINI_API_KEY.',
          code: 'GEMINI_NOT_CONFIGURED',
        });
      }

      // Check the quota only after authentication and configuration validation.
      const limitCheck = await checkAndIncrementUserLimit(userId, 'token');
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: limitCheck.message });
      }

      // Load the Gemini SDK only when a live token is actually requested. Keeping
      // provider SDKs out of global server initialization prevents an unrelated
      // provider/bundling failure from taking down /api/health or session creation.
      const { GoogleGenAI, Modality } = await import('@google/genai');

      // Never expose the long-lived API key. Provision a short-lived, single-use token instead.
      // Ephemeral tokens and the constrained Live WebSocket must use the same API version.
      // Google currently documents both token provisioning and client connection on v1beta.
      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
      const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const newSessionExpireTime = new Date(Date.now() + 60 * 1000).toISOString();
      const liveModel = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
      const authToken = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model: liveModel,
            config: {
              responseModalities: [Modality.AUDIO],
              sessionResumption: {},
            },
          },
          // IMPORTANT: when liveConnectConstraints is present and this option is
          // omitted, the GenAI SDK treats the constrained setup as fully locked.
          // That causes the browser's per-part systemInstruction (examinerPrompts)
          // to be ignored by BidiGenerateContentConstrained. An empty mask locks
          // only the fields explicitly constrained above, leaving systemInstruction,
          // speechConfig, transcription, etc. configurable for each live part.
          lockAdditionalFields: [],
        },
      });

      if (!authToken.name) {
        throw new Error('Gemini token provisioning returned an empty token.');
      }

      ServerLogger.info('Minted ephemeral Gemini session token', {
        requestId: req.requestId,
        userId,
        provider: 'GeminiLive',
        latencyMs: Date.now() - startTime,
      });

      return res.json({
        token: authToken.name,
        sandbox: false,
        expiresAt: expireTime,
        apiVersion: 'v1beta',
        message: 'Successfully minted a short-lived Gemini Live token.',
      });
    } catch (err) {
      next(err);
    }
  });

  // API ROUTE 3.1: OpenAI Realtime Ephemeral Session Token Placeholder (Disabled)
  app.all(['/api/session/mint-openai', '/api/session/mint-openai/*'], async (req: any, res: any) => {
    ServerLogger.info('OpenAI Realtime credential requested but provider is disabled by feature flag.', {
      requestId: req.requestId,
      action: 'mint_openai_token_disabled',
      path: req.path
    });

    res.status(501).json({
      error: 'OpenAI Realtime provider is disabled in this build. Gemini Live remains the active production provider.',
      provider: 'openai-realtime',
      enabled: false,
      documentation: 'https://platform.openai.com/docs/guides/realtime'
    });
  });

  // API ROUTE 4: Authenticated Server-Side Post-Test Evaluation Pipeline
  app.post('/api/evaluations/generate', async (req: any, res: any, next: any) => {
    const startTime = Date.now();
    try {
      const userId = await resolveRequestUserId(req, res);
      if (!userId) return;

      const { sessionId, sessionEvidence } = req.body;
      const forceRetry = req.body?.forceRetry === true;
      if (!sessionId) {
        return res.status(400).json({ error: 'Missing required field: sessionId' });
      }

      ServerLogger.info('Evaluation request received', {
        requestId: req.requestId,
        sessionId,
        userId,
        forceRetry,
        browserEvidenceTurns: Array.isArray(sessionEvidence?.transcript) ? sessionEvidence.transcript.length : 0,
      });

      // Fetch the authoritative session from Firestore when available, but do not
      // confuse healthy Firebase Auth with guaranteed Firestore availability.
      // A real evaluation can safely recover from the server cache or the
      // authenticated just-finished browser evidence for this same user/session.
      let session: any = null;
      if (isFirestoreServerAvailable()) {
        try {
          const db = getFirebaseAdmin().firestore();
          const docSnap = await db.collection('speakingSessions').doc(sessionId).get();
          if (docSnap.exists) {
            session = docSnap.data();
            if (!session.transcript || session.transcript.length === 0) {
              const turnsSnap = await db.collection('speakingSessions').doc(sessionId).collection('turns').orderBy('timestamp', 'asc').get();
              session.transcript = turnsSnap.docs.map(
                (d: QueryDocumentSnapshot<DocumentData>) => d.data(),
              );
            }
          }
        } catch (firestoreError) {
          if (!markFirestoreServerUnavailable(firestoreError)) {
            throw firestoreError;
          }
          ServerLogger.warn('Firestore unavailable while loading evaluation evidence; using recovery evidence', {
            requestId: req.requestId,
            sessionId,
            userId,
            error: (firestoreError as Error).message,
          });
        }
      }

      if (!session) {
        session = MockPracticeService.getSessionById(sessionId);
      }

      // Last-resort recovery is allowed only after Firebase Admin authenticated
      // this request and only for matching session/user evidence.
      if (
        !session &&
        sessionEvidence &&
        typeof sessionEvidence === 'object' &&
        sessionEvidence.id === sessionId &&
        (!sessionEvidence.userId || sessionEvidence.userId === userId) &&
        Array.isArray(sessionEvidence.transcript)
      ) {
        session = {
          ...sessionEvidence,
          id: sessionId,
          userId,
        };
        MockPracticeService.upsertSession(session);
        ServerLogger.warn('Recovered evaluation session from authenticated browser evidence', {
          requestId: req.requestId,
          sessionId,
          userId,
          transcriptTurns: sessionEvidence.transcript.length,
        });
      }

      if (!session) {
        return res.status(404).json({
          error: `Speaking session not found: ${sessionId}`,
          code: 'EVALUATION_SESSION_NOT_FOUND',
          requestId: req.requestId,
        });
      }

      if (session.userId && session.userId !== userId) {
        return res.status(403).json({ error: 'Forbidden: This session belongs to another user.' });
      }

      // The client may send the just-finished in-memory evidence along with the
      // request. Firestore writes are asynchronous and can briefly lag behind
      // the final browser transcript, so merge only safe evaluation fields after
      // verifying ownership against the authoritative stored session.
      if (
        sessionEvidence &&
        typeof sessionEvidence === 'object' &&
        sessionEvidence.id === sessionId &&
        (!sessionEvidence.userId || sessionEvidence.userId === userId)
      ) {
        const evidenceTranscript = Array.isArray(sessionEvidence.transcript)
          ? sessionEvidence.transcript
          : [];
        const storedTranscript = Array.isArray(session.transcript) ? session.transcript : [];

        session = {
          ...session,
          status: sessionEvidence.status === 'completed' ? 'completed' : session.status,
          currentState: sessionEvidence.currentState || session.currentState,
          currentPart: sessionEvidence.currentPart || session.currentPart,
          selectedTestSnapshot: sessionEvidence.selectedTestSnapshot || session.selectedTestSnapshot,
          transcript: evidenceTranscript.length >= storedTranscript.length
            ? evidenceTranscript
            : storedTranscript,
          part2Meta: sessionEvidence.part2Meta || session.part2Meta,
          draftNotes: typeof sessionEvidence.draftNotes === 'string'
            ? sessionEvidence.draftNotes
            : session.draftNotes,
        };
      }

      // Count only valid, owned evaluation requests against the daily quota.
      const limitCheck = await checkAndIncrementUserLimit(userId, 'evaluation');
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: limitCheck.message });
      }

      // Load the evaluation provider only for evaluation requests. This keeps
      // session launch independent from the larger Gemini evaluation bundle.
      const { runServerEvaluationPipeline } = await import('../src/services/serverEvaluationPipeline');
      const evaluation = await runServerEvaluationPipeline(session, { forceRetry });

      ServerLogger.info('Generated server evaluation report', {
        requestId: req.requestId,
        sessionId,
        userId,
        overallBand: evaluation.estimatedOverallBand,
        latencyMs: Date.now() - startTime
      });

      res.status(200).json(evaluation);
    } catch (err: any) {
      const message = String(err?.message || 'Unknown evaluation failure');
      ServerLogger.error('Evaluation generation failed', 'EVALUATION_PIPELINE', {
        requestId: req.requestId,
        sessionId: req.body?.sessionId,
        error: message,
        latencyMs: Date.now() - startTime,
      });

      if (message.includes('Rate limit exceeded')) {
        return res.status(429).json({ error: message, code: 'EVALUATION_RATE_LIMITED', requestId: req.requestId });
      }
      if (message.includes('GEMINI_API_KEY')) {
        return res.status(503).json({ error: message, code: 'EVALUATION_NOT_CONFIGURED', requestId: req.requestId });
      }
      if (message.startsWith('Gemini evaluation failed:')) {
        return res.status(502).json({ error: message, code: 'EVALUATION_PROVIDER_FAILED', requestId: req.requestId });
      }
      if (message.includes('could not be saved')) {
        return res.status(503).json({ error: message, code: 'EVALUATION_STORAGE_FAILED', requestId: req.requestId });
      }
      return res.status(500).json({
        error: process.env.NODE_ENV === 'production'
          ? 'Evaluation failed before a valid assessment report could be produced.'
          : message,
        code: 'EVALUATION_PIPELINE_FAILED',
        requestId: req.requestId,
      });
    }
  });

  // API ROUTE 5: Get Existing Evaluation for Session
  app.get('/api/evaluations/:sessionId', async (req: any, res: any, next: any) => {
    try {
      const userId = await resolveRequestUserId(req, res);
      if (!userId) return;

      const { sessionId } = req.params;
      const { SCHEMA_VERSION } = await import('../src/services/serverEvaluationPipeline');
      const evaluationId = `eval_${sessionId}_${SCHEMA_VERSION}`;

      if (isFirestoreServerAvailable()) {
        try {
          const db = getFirebaseAdmin().firestore();
          const sessionSnap = await db.collection('speakingSessions').doc(sessionId).get();
          if (sessionSnap.exists) {
            const ownerId = sessionSnap.data()?.userId;
            if (ownerId && ownerId !== userId) {
              return res.status(403).json({ error: 'Forbidden: This session belongs to another user.' });
            }

            const evalSnap = await db.collection('evaluations').doc(evaluationId).get();
            if (evalSnap.exists) {
              const evaluation = evalSnap.data();
              if (evaluation?.userId && evaluation.userId !== userId) {
                return res.status(403).json({ error: 'Forbidden: This evaluation belongs to another user.' });
              }
              return res.json(evaluation);
            }
          }
        } catch (firestoreError) {
          if (!markFirestoreServerUnavailable(firestoreError)) {
            throw firestoreError;
          }
          ServerLogger.warn('Firestore unavailable during evaluation lookup; checking recovery cache', {
            requestId: req.requestId,
            sessionId,
            userId,
            error: (firestoreError as Error).message,
          });
        }
      }

      const recoverySession = MockPracticeService.getSessionById(sessionId);
      if (recoverySession?.userId && recoverySession.userId !== userId) {
        return res.status(403).json({ error: 'Forbidden: This session belongs to another user.' });
      }
      const existing = MockPracticeService.getEvaluationForSession(sessionId);
      if (existing) {
        if (existing.userId && existing.userId !== userId) {
          return res.status(403).json({ error: 'Forbidden: This evaluation belongs to another user.' });
        }
        return res.json(existing);
      }

      return res.status(404).json({
        error: 'Evaluation report not found for this session',
        code: 'EVALUATION_NOT_FOUND',
        requestId: req.requestId,
      });
    } catch (err: any) {
      next(err);
    }
  });

  // API ROUTE 6: Authenticated Privacy and Data-Erasure Controls
  app.delete('/api/privacy/recordings', async (req: any, res: any, next: any) => {
    try {
      const userId = await resolveRequestUserId(req, res);
      if (!userId) return;

      if (!isFirebaseServerEnabled()) {
        const deletedSessionCount = MockPracticeService.deleteRecordingsForUser(userId);
        return res.json({
          success: true,
          sandbox: true,
          deletedSessionCount,
          message: 'Sandbox recording metadata was removed.',
        });
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const sessionsSnap = await db.collection('speakingSessions').where('userId', '==', userId).get();

      // Remove the private Storage objects first. If this fails, do not claim success.
      await admin.storage().bucket().deleteFiles({
        prefix: `speaking-recordings/${userId}/`,
        force: true,
      });

      for (let index = 0; index < sessionsSnap.docs.length; index += 450) {
        const batch = db.batch();
        sessionsSnap.docs.slice(index, index + 450).forEach((sessionDoc: any) => {
          batch.update(sessionDoc.ref, {
            recordingMetadata: admin.firestore.FieldValue.delete(),
            updatedAt: Date.now(),
          });
        });
        await batch.commit();
      }

      ServerLogger.info('User recording purge completed', {
        requestId: req.requestId,
        userId,
        affectedSessions: sessionsSnap.size,
      });

      return res.json({
        success: true,
        deletedSessionCount: sessionsSnap.size,
        message: 'All stored voice recordings were deleted.',
      });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/privacy/data', async (req: any, res: any, next: any) => {
    try {
      const userId = await resolveRequestUserId(req, res);
      if (!userId) return;

      if (!isFirebaseServerEnabled()) {
        const deleted = MockPracticeService.deleteAllPracticeDataForUser(userId);
        return res.json({
          success: true,
          sandbox: true,
          ...deleted,
          message: 'Sandbox practice history was removed.',
        });
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const sessionsSnap = await db.collection('speakingSessions').where('userId', '==', userId).get();
      const errors: string[] = [];
      let deletedDocumentCount = 0;

      for (const sessionDoc of sessionsSnap.docs) {
        const result = await deleteSessionRecursively(sessionDoc.id, userId);
        deletedDocumentCount += result.deletedCount;
        if (!result.success && result.errors) {
          errors.push(...result.errors.map((message: string) => `${sessionDoc.id}: ${message}`));
        }
      }

      // Delete user-owned practice records that may not be attached to a session.
      const ownedCollections = ['evaluations', 'feedback', 'usageEvents'];
      for (const collectionName of ownedCollections) {
        const snapshot = await db.collection(collectionName).where('userId', '==', userId).get();
        for (let index = 0; index < snapshot.docs.length; index += 450) {
          const batch = db.batch();
          const slice = snapshot.docs.slice(index, index + 450);
          slice.forEach((document: any) => batch.delete(document.ref));
          await batch.commit();
          deletedDocumentCount += slice.length;
        }
      }

      // A user-limit document is operational practice data, not the user account itself.
      const userLimitRef = db.collection('userLimits').doc(userId);
      const userLimitSnap = await userLimitRef.get();
      if (userLimitSnap.exists) {
        await userLimitRef.delete();
        deletedDocumentCount += 1;
      }

      // Catch any orphaned recording objects not represented by a current session document.
      try {
        await admin.storage().bucket().deleteFiles({
          prefix: `speaking-recordings/${userId}/`,
          force: true,
        });
      } catch (storageError: any) {
        errors.push(`Cloud Storage deletion error: ${storageError.message}`);
      }

      if (errors.length > 0) {
        ServerLogger.error('User practice-data purge completed with errors', 'PRIVACY_PURGE_PARTIAL', {
          requestId: req.requestId,
          userId,
          errors,
        });
        return res.status(500).json({
          success: false,
          partial: true,
          deletedDocumentCount,
          errors,
          message: 'Some practice data could not be deleted. Review server logs and retry.',
        });
      }

      ServerLogger.info('User practice-data purge completed', {
        requestId: req.requestId,
        userId,
        deletedDocumentCount,
      });

      return res.json({
        success: true,
        deletedDocumentCount,
        message: 'All practice sessions, transcripts, evaluations, feedback, usage events, and recordings were deleted.',
      });
    } catch (err) {
      next(err);
    }
  });

  // API ROUTE 6: Restricted Basic Admin Usage / Diagnostics View
  app.get('/api/admin/diagnostics', async (req: any, res: any, next: any) => {
    try {
      let isAdminUser = false;
      let adminUid = 'unknown';

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split('Bearer ')[1];
        if (isFirebaseServerEnabled()) {
          try {
            const decoded = await getFirebaseAdmin().auth().verifyIdToken(token);
            adminUid = decoded.uid;
            if (decoded.admin === true || decoded.role === 'admin') {
              isAdminUser = true;
            } else {
              // Check Firestore user document for admin role
              const userSnap = await getFirebaseAdmin().firestore().collection('users').doc(adminUid).get();
              if (userSnap.exists && (userSnap.data()?.role === 'admin' || userSnap.data()?.admin === true)) {
                isAdminUser = true;
              }
            }
          } catch (authErr) {
            ServerLogger.warn('Admin route token verification failed', { requestId: req.requestId, error: (authErr as any).message });
          }
        } else {
          // Sandbox or local testing mode
          if (token === 'mock-admin-token' && process.env.NODE_ENV !== 'production') {
            isAdminUser = true;
            adminUid = 'sandbox-admin';
          }
        }
      }

      if (!isAdminUser) {
        ServerLogger.warn('Unauthorized admin diagnostics access attempt', { requestId: req.requestId, ip: req.ip });
        return res.status(403).json({ error: 'Forbidden: Admin authorization claim required.' });
      }

      // Aggregate aggregate statistics WITHOUT returning transcripts or audio URLs
      let totalSessions = 0;
      let totalEvaluations = 0;
      let totalUsageEvents = 0;

      if (isFirebaseServerEnabled()) {
        const db = getFirebaseAdmin().firestore();
        const [sessSnap, evalSnap, usageSnap] = await Promise.all([
          db.collection('speakingSessions').select('id', 'status', 'createdAt').get(),
          db.collection('evaluations').select('id', 'estimatedOverallBand').get(),
          db.collection('usageEvents').select('id', 'eventType').get()
        ]);

        totalSessions = sessSnap.size;
        totalEvaluations = evalSnap.size;
        totalUsageEvents = usageSnap.size;
      } else {
        totalSessions = 5;
        totalEvaluations = 3;
        totalUsageEvents = 12;
      }

      ServerLogger.info('Admin diagnostics generated', { requestId: req.requestId, adminUid });

      res.json({
        systemStatus: 'healthy',
        timestamp: Date.now(),
        uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
        firebaseEnabled: isFirebaseServerEnabled(),
        metrics: {
          totalSessions,
          totalEvaluations,
          totalUsageEvents,
          memoryUsage: process.memoryUsage()
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // Abuse-Safe Generic Error Handling Middleware
  app.use((err: any, req: any, res: any, _next: any) => {
    ServerLogger.error('Unhandled express exception caught', 'SYSTEM_EXCEPTION', {
      requestId: req.requestId,
      route: req.originalUrl,
      error: err.message || 'Unknown error'
    });

    res.status(500).json({
      error: 'An unexpected error occurred while processing your request.',
      requestId: req.requestId
    });
  });

  // Frontend hosting differs by runtime.
  // - Local development: Vite middleware keeps the single-command developer experience.
  // - Local production: serve the compiled Vite output from ./public.
  // - Vercel: static files in ./public are served by Vercel's CDN, so Express handles API only.
  const isVercelRuntime = Boolean(process.env.VERCEL);
  if (!isVercelRuntime) {
    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('Running Express server in DEVELOPMENT mode with Vite Middleware.');
    } else {
      const publicPath = path.join(process.cwd(), 'public');
      app.use(express.static(publicPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
      });
      console.log('Running Express server in LOCAL PRODUCTION mode serving ./public.');
    }
  }

  return app;
}

// Initialize the Express app lazily. Vercel Functions should be import-safe:
// importing this module must not require every provider/database dependency to
// initialize successfully before a request can be handled. It also avoids a
// top-level await in the serverless entry graph.
let appPromise: ReturnType<typeof createApp> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = createApp();
  }
  return appPromise;
}

async function requestHandler(req: any, res: any) {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (error: any) {
    console.error('[SpeakReady] Server initialization failed:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'The API server could not initialize.',
        code: 'SERVER_INITIALIZATION_FAILED',
        stage: 'server_initialization',
      });
    }
  }
}

export default requestHandler;

// Keep the existing local/container workflow. Vercel provides its own HTTP listener.
if (!process.env.VERCEL) {
  getApp()
    .then((app) => {
      const configuredPort = Number.parseInt(process.env.PORT || '3000', 10);
      const PORT = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`SpeakReady IELTS local server running on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((error) => {
      console.error('[SpeakReady] Local server initialization failed:', error);
      process.exitCode = 1;
    });
}
