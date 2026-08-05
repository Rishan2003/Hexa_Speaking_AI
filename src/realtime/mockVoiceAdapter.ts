/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RealtimeVoiceProvider, RealtimeVoiceConfig } from './voiceContract';

export class MockVoiceAdapter implements RealtimeVoiceProvider {
  private config: RealtimeVoiceConfig | null = null;
  private status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private currentPart = 1;
  private step = 0;
  private timeoutId: NodeJS.Timeout | null = null;

  async initialize(config: RealtimeVoiceConfig): Promise<void> {
    this.config = config;
    this.status = 'connecting';
    config.onStatusChange(this.status);

    return new Promise((resolve) => {
      this.timeoutId = setTimeout(() => {
        this.status = 'connected';
        if (this.config) {
          this.config.onStatusChange(this.status);
          this.speakFirstQuestion();
        }
        resolve();
      }, 1000);
    });
  }

  sendAudio(chunk: Int16Array): void {
    // In mock mode, we ignore raw audio input buffer bytes,
    // but we can log them or simulate processing.
  }

  sendTextMessage(text: string): void {
    if (!this.config || this.status !== 'connected') return;

    // Echo user text as candidate speech
    this.config.onTranscript('candidate', text, true);

    // Simulate examiner processing candidate speech and replying
    this.timeoutId = setTimeout(() => {
      this.replyToCandidate(text);
    }, 2000);
  }

  private speakFirstQuestion(): void {
    if (!this.config) return;
    const initialText = "Hello! Welcome to HEXA'S Speaking AI. I am your examiner. Let's begin Part 1. Can you tell me your full name and where you are from, please?";
    this.config.onTranscript('examiner', initialText, true);
    this.speakOutLoud(initialText);
  }

  private replyToCandidate(userSpeech: string): void {
    if (!this.config) return;
    this.step++;

    let replyText = "";
    if (this.currentPart === 1) {
      if (this.step === 1) {
        replyText = "Thank you. Let's talk about your daily routine. Do you prefer to study/work in the morning or in the evening, and why?";
      } else if (this.step === 2) {
        replyText = "Interesting. Let's talk about leisure time. What do you usually do on your weekends?";
      } else {
        replyText = "Thank you. That concludes Part 1. We will now proceed to Part 2 of the test.";
        this.step = 0;
        this.currentPart = 2;
      }
    } else if (this.currentPart === 2) {
      replyText = "Thank you. Please describe your cue card topic now. You have 1 to 2 minutes to speak. I will let you know when the time is up.";
      this.currentPart = 3;
    } else if (this.currentPart === 3) {
      if (this.step === 1) {
        replyText = "We are now in Part 3. Let's discuss abstract matters. Do you think people have more free time now than they did in the past?";
      } else if (this.step === 2) {
        replyText = "How do you think technology has changed the way we travel or interact with other cultures?";
      } else {
        replyText = "Thank you very much. That concludes your mock speaking test. Your evaluation report is being generated, please wait a moment.";
      }
    }

    if (replyText) {
      this.config.onTranscript('examiner', replyText, true);
      this.speakOutLoud(replyText);
    }
  }

  private speakOutLoud(text: string): void {
    if ('speechSynthesis' in window) {
      // Clean up previous utterances
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }

  async disconnect(): Promise<void> {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.status = 'disconnected';
    if (this.config) {
      this.config.onStatusChange(this.status);
    }
  }
}
