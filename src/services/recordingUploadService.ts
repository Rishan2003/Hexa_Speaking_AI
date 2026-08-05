/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ref, uploadBytes, deleteObject } from 'firebase/storage';
import { getFirebaseStorage, isFirebaseEnabled } from './firebaseClient';
import { FirebaseRepository } from './firebaseRepository';
import { RecordingMetadata } from '../types';
import { APP_CONFIG } from '../config';

export class RecordingUploadService {
  /**
   * Safe upload of a completed session audio recording to Cloud Storage.
   * Uses private path: speaking-recordings/{uid}/{sessionId}/{recordingId}.webm
   */
  public static async uploadSessionRecording(
    uid: string,
    sessionId: string,
    recordingBlob: Blob,
    consentActive: boolean,
    durationSeconds: number = 0
  ): Promise<RecordingMetadata> {
    const recordingId = `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const path = `speaking-recordings/${uid}/${sessionId}/${recordingId}.webm`;
    const now = Date.now();
    const maxRecordingBytes = 25 * 1024 * 1024;

    if (recordingBlob.size > maxRecordingBytes) {
      throw new Error('Recording is larger than the 25 MiB upload limit. Please record a shorter session.');
    }

    // Check explicit consent requirement
    if (!consentActive) {
      console.warn('[RecordingUploadService] Upload aborted: user consent for recording is inactive.');
      const skippedMetadata: RecordingMetadata = {
        recordingId,
        path,
        contentType: 'audio/webm',
        sizeBytes: 0,
        durationSeconds: 0,
        status: 'skipped',
        consentActive: false,
        createdAt: now,
        error: 'Consent not provided'
      };
      await FirebaseRepository.saveRecordingMetadata(sessionId, skippedMetadata);
      return skippedMetadata;
    }

    const pendingMetadata: RecordingMetadata = {
      recordingId,
      path,
      contentType: recordingBlob.type || 'audio/webm',
      sizeBytes: recordingBlob.size,
      durationSeconds,
      status: 'uploading',
      consentActive: true,
      createdAt: now
    };

    // Save initial uploading status
    await FirebaseRepository.saveRecordingMetadata(sessionId, pendingMetadata);

    if (APP_CONFIG.useMocks || !isFirebaseEnabled()) {
      // Mock / local sandbox mode simulation
      console.log(`[RecordingUploadService] Local sandbox mode: Simulated upload of ${recordingBlob.size} bytes to ${path}`);
      const mockUploaded: RecordingMetadata = {
        ...pendingMetadata,
        status: 'uploaded',
        uploadedAt: Date.now()
      };
      await FirebaseRepository.saveRecordingMetadata(sessionId, mockUploaded);
      return mockUploaded;
    }

    try {
      const storage = getFirebaseStorage();
      const storageRef = ref(storage, path);
      
      // Bounded upload to private path
      await uploadBytes(storageRef, recordingBlob, {
        contentType: recordingBlob.type || 'audio/webm',
        customMetadata: {
          uid,
          sessionId,
          recordingId
        }
      });

      const uploadedMetadata: RecordingMetadata = {
        ...pendingMetadata,
        status: 'uploaded',
        uploadedAt: Date.now()
      };

      await FirebaseRepository.saveRecordingMetadata(sessionId, uploadedMetadata);
      return uploadedMetadata;
    } catch (err: any) {
      console.error('[RecordingUploadService] Recording upload failed:', err);
      const failedMetadata: RecordingMetadata = {
        ...pendingMetadata,
        status: 'failed',
        error: err.message || 'Network upload failed'
      };
      await FirebaseRepository.saveRecordingMetadata(sessionId, failedMetadata);
      return failedMetadata;
    }
  }

  /**
   * Lets the user retry a failed recording upload.
   */
  public static async retryUpload(
    uid: string,
    sessionId: string,
    recordingBlob: Blob,
    durationSeconds: number = 0
  ): Promise<RecordingMetadata> {
    return this.uploadSessionRecording(uid, sessionId, recordingBlob, true, durationSeconds);
  }

  /**
   * Lets the user continue without audio if recording upload fails or is skipped.
   * Session remains valid and marked completed.
   */
  public static async skipRecordingUpload(sessionId: string): Promise<RecordingMetadata> {
    const skippedMetadata: RecordingMetadata = {
      recordingId: `skipped-${Date.now()}`,
      path: '',
      contentType: 'audio/webm',
      sizeBytes: 0,
      durationSeconds: 0,
      status: 'skipped',
      consentActive: false,
      createdAt: Date.now()
    };
    await FirebaseRepository.saveRecordingMetadata(sessionId, skippedMetadata);
    return skippedMetadata;
  }

  /**
   * Deletes recording file from Storage and marks metadata as deleted.
   */
  public static async deleteRecording(sessionId: string, path: string): Promise<void> {
    if (path && isFirebaseEnabled()) {
      try {
        const storage = getFirebaseStorage();
        const storageRef = ref(storage, path);
        await deleteObject(storageRef);
      } catch (e) {
        console.warn('[RecordingUploadService] Error deleting storage object:', e);
      }
    }

    const deletedMetadata: RecordingMetadata = {
      recordingId: `deleted-${Date.now()}`,
      path: '',
      contentType: 'audio/webm',
      sizeBytes: 0,
      durationSeconds: 0,
      status: 'deleted',
      consentActive: false,
      createdAt: Date.now()
    };
    await FirebaseRepository.saveRecordingMetadata(sessionId, deletedMetadata);
  }
}
