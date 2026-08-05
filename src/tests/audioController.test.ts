/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserAudioControllerService } from '../services/audioController';

describe('BrowserAudioController Unit & State Logic Tests', () => {
  let controller: BrowserAudioControllerService;

  beforeEach(() => {
    controller = new BrowserAudioControllerService();
  });

  afterEach(() => {
    if (controller) {
      controller.dispose();
    }
  });

  it('should initialize with safe default states and handle consent flag', async () => {
    await controller.initialize({ userConsentForRecording: false });

    const deviceState = controller.getDeviceState();
    const recordingState = controller.getRecordingState();

    expect(deviceState.isMuted).toBe(false);
    expect(deviceState.inputLevel).toBe(0);
    expect(recordingState.consentGiven).toBe(false);
    expect(recordingState.isRecording).toBe(false);
  });

  it('should respect recording consent rules strictly', async () => {
    await controller.initialize({ userConsentForRecording: false });

    // Attempting to start recording without consent must return false
    const startedNoConsent = controller.startRecording();
    expect(startedNoConsent).toBe(false);
    expect(controller.getRecordingState().isRecording).toBe(false);

    // Grant consent and update state
    controller.setRecordingConsent(true);
    expect(controller.getRecordingState().consentGiven).toBe(true);

    // Revoking consent during recording should immediately reset recording state
    controller.setRecordingConsent(false);
    expect(controller.getRecordingState().isRecording).toBe(false);
    expect(controller.getRecordingState().recordingBlob).toBeNull();
  });

  it('should toggle microphone mute/unmute state safely without dropping session', () => {
    expect(controller.isMuted()).toBe(false);

    controller.setMuted(true);
    expect(controller.isMuted()).toBe(true);
    expect(controller.getDeviceState().isMuted).toBe(true);
    expect(controller.getInputLevel()).toBe(0);

    controller.setMuted(false);
    expect(controller.isMuted()).toBe(false);
    expect(controller.getDeviceState().isMuted).toBe(false);
  });

  it('should manage remote audio queue clearing safely', () => {
    expect(() => controller.clearAudioQueue()).not.toThrow();
  });

  it('should execute full disposal and cleanup without errors or resource leaks', () => {
    controller.setRecordingConsent(true);
    expect(() => controller.dispose()).not.toThrow();

    const finalDeviceState = controller.getDeviceState();
    const finalRecordingState = controller.getRecordingState();

    expect(finalDeviceState.inputLevel).toBe(0);
    expect(finalDeviceState.isMuted).toBe(false);
    expect(finalRecordingState.isRecording).toBe(false);
    expect(finalRecordingState.recordingBlob).toBeNull();
  });
});
