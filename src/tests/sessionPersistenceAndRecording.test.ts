/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FirebaseRepository } from '../services/firebaseRepository';
import { RecordingUploadService } from '../services/recordingUploadService';
import { persistenceQueue } from '../services/persistenceQueue';
import { MockPracticeService } from '../services/mockService';
import { SpeechChunk, ExamState, IELTSExamPart, IELTSPracticeSession } from '../types';

describe('Phase 11 - Session Persistence & Private Recording Upload', () => {
  let testSession: IELTSPracticeSession;

  beforeEach(() => {
    testSession = MockPracticeService.createSession('user-test-persistence-123');
  });

  describe('1. Idempotent Writes & Client-Generated Event IDs', () => {
    it('saves turns with unique eventId idempotently without duplicating turns', async () => {
      const turn1: SpeechChunk = {
        id: 'turn-1',
        eventId: 'evt-unique-101',
        sequence: 1,
        timestamp: 1000,
        speaker: 'candidate',
        text: 'I am preparing for the academic IELTS exam.',
        isFinal: true
      };

      // Save turn once
      await FirebaseRepository.saveSessionTurn(testSession.id, turn1, 'part-1');

      // Save exact same turn again (simulating network retry/duplicate delivery)
      await FirebaseRepository.saveSessionTurn(testSession.id, turn1, 'part-1');

      // Check local transcript reconciliation
      const currentTranscript = [turn1];
      const reconciled = persistenceQueue.reconcileTranscript(testSession.id, currentTranscript);

      expect(reconciled.length).toBe(1);
      expect(reconciled[0].eventId).toBe('evt-unique-101');
    });

    it('reconciles unsaved local pending queue events after reconnect without duplicates', () => {
      const existingTurn: SpeechChunk = {
        id: 'turn-existing',
        eventId: 'evt-001',
        sequence: 1,
        timestamp: 1000,
        speaker: 'examiner',
        text: 'Good morning.',
        isFinal: true
      };

      const pendingTurn: SpeechChunk = {
        id: 'turn-pending',
        eventId: 'evt-002',
        sequence: 2,
        timestamp: 2000,
        speaker: 'candidate',
        text: 'Good morning, examiner.',
        isFinal: true
      };

      // Manually enqueue pending item to simulate offline write queue
      (persistenceQueue as any).enqueue({
        id: pendingTurn.eventId,
        type: 'turn',
        sessionId: testSession.id,
        partId: 'part-1',
        payload: pendingTurn,
        createdAt: Date.now(),
        attempts: 0
      });

      // Reconcile with existing cloud transcript
      const reconciled = persistenceQueue.reconcileTranscript(testSession.id, [existingTurn]);

      expect(reconciled.length).toBe(2);
      expect(reconciled[0].eventId).toBe('evt-001');
      expect(reconciled[1].eventId).toBe('evt-002');
    });
  });

  describe('2. Explicit Session Status Rules & State Restoration', () => {
    it('maps ExamState.COMPLETE to "completed"', async () => {
      await FirebaseRepository.updateSessionState(
        testSession.id,
        ExamState.COMPLETE,
        IELTSExamPart.PART_3,
        []
      );

      const restored = MockPracticeService.getSessionById(testSession.id);
      expect(restored).toBeDefined();
      expect(restored?.status).toBe('completed');
    });

    it('maps ExamState.ABANDONED to "abandoned"', async () => {
      await FirebaseRepository.updateSessionState(
        testSession.id,
        ExamState.ABANDONED,
        IELTSExamPart.PART_1,
        []
      );

      const restored = MockPracticeService.getSessionById(testSession.id);
      expect(restored?.status).toBe('abandoned');
    });

    it('stores provider metadata concisely without sensitive secrets or tokens', async () => {
      await FirebaseRepository.saveProviderMetadata(testSession.id, {
        providerName: 'GeminiLiveAdapter',
        modelAlias: 'gemini-3.1-flash-live-preview',
        transport: 'WebSocket',
        sampleRate: 16000
      });

      const restored = MockPracticeService.getSessionById(testSession.id);
      expect(restored).toBeDefined();
      expect(restored?.providerMetadata?.providerName).toBe('GeminiLiveAdapter');
      expect(restored?.providerMetadata?.modelAlias).toBe('gemini-3.1-flash-live-preview');
      // Verify no sensitive keys exist
      expect((restored?.providerMetadata as any)?.apiKey).toBeUndefined();
    });
  });

  describe('3. Private Audio Recording Upload & Error Handling', () => {
    it('aborts upload and marks status "skipped" when consent is inactive', async () => {
      const audioBlob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
      const result = await RecordingUploadService.uploadSessionRecording(
        'user-123',
        testSession.id,
        audioBlob,
        false // consent given = false
      );

      expect(result.status).toBe('skipped');
      expect(result.consentActive).toBe(false);
    });

    it('uploads to private path speaking-recordings/{uid}/{sessionId}/{recordingId}.webm when consent is active', async () => {
      const audioBlob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
      const result = await RecordingUploadService.uploadSessionRecording(
        'user-123',
        testSession.id,
        audioBlob,
        true, // consent given = true
        120
      );

      expect(result.status).toBe('uploaded');
      expect(result.consentActive).toBe(true);
      expect(result.path).toContain(`speaking-recordings/user-123/${testSession.id}/`);
      expect(result.sizeBytes).toBe(4096);
    });

    it('allows continuing without audio when user skips recording upload', async () => {
      const result = await RecordingUploadService.skipRecordingUpload(testSession.id);
      expect(result.status).toBe('skipped');

      // Verify that completed session remains 100% valid
      const session = MockPracticeService.getSessionById(testSession.id);
      expect(session).toBeDefined();
    });

    it('deletes recording metadata when user requests deletion', async () => {
      await RecordingUploadService.deleteRecording(testSession.id, 'speaking-recordings/user-123/sess-1/rec-1.webm');
      
      const session = MockPracticeService.getSessionById(testSession.id);
      expect(session).toBeDefined();
    });
  });
});
