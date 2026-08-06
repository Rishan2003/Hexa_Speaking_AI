/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFirebaseAuth, isFirebaseEnabled } from './firebaseClient';

const VOICE_FEEDBACK_TIMEOUT_MS = 50000;

export const VoiceFeedbackService = {
  async generateBanglaAudio(text: string): Promise<Blob> {
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('Bangla feedback text is unavailable for this report.');
    }

    if (!isFirebaseEnabled()) {
      throw new Error('Voice feedback is unavailable because Firebase authentication is not configured.');
    }

    const auth = getFirebaseAuth();
    if (!auth.currentUser) {
      throw new Error('Your sign-in session has expired. Please sign in again.');
    }

    const token = await auth.currentUser.getIdToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VOICE_FEEDBACK_TIMEOUT_MS);

    try {
      const response = await fetch('/api/feedback/voice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ text: cleanText }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const errorData = contentType.includes('application/json')
          ? await response.json().catch(() => ({} as any))
          : {} as any;
        const requestId = errorData.requestId || response.headers.get('X-Request-ID');
        const code = errorData.code || `HTTP_${response.status}`;
        const baseMessage = errorData.error || `Bangla voice feedback failed (${response.status}).`;
        const suffix = [code ? `Code: ${code}` : '', requestId ? `Request ID: ${requestId}` : '']
          .filter(Boolean)
          .join(' · ');
        throw new Error(suffix ? `${baseMessage}\n${suffix}` : baseMessage);
      }

      const blob = await response.blob();
      if (!blob.size) {
        throw new Error('Bangla voice feedback returned an empty audio file.');
      }
      return blob;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Bangla voice feedback took too long to generate. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
};
