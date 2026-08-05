/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AudioDeviceState,
  LocalRecordingState,
  BrowserAudioControllerOptions
} from '../types';
import { BrowserAudioControllerService } from './audioController';

export function useAudioController(options?: BrowserAudioControllerOptions) {
  const controllerRef = useRef<BrowserAudioControllerService | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new BrowserAudioControllerService(options);
  }

  const controller = controllerRef.current;

  const [deviceState, setDeviceState] = useState<AudioDeviceState>(controller.getDeviceState());
  const [recordingState, setRecordingState] = useState<LocalRecordingState>(controller.getRecordingState());
  const [inputLevel, setInputLevel] = useState<number>(0);

  useEffect(() => {
    controller.initialize({
      ...options,
      onStateChange: (ds) => setDeviceState(ds),
      onRecordingStateChange: (rs) => setRecordingState(rs),
      onInputLevelChange: (lvl) => setInputLevel(lvl)
    });

    return () => {
      controller.dispose();
    };
  }, []);

  const startMic = useCallback(async (deviceId?: string) => {
    return await controller.startMicrophone(deviceId);
  }, [controller]);

  const stopMic = useCallback(() => {
    controller.stopMicrophone();
  }, [controller]);

  const toggleMute = useCallback(() => {
    controller.setMuted(!controller.isMuted());
  }, [controller]);

  const setMuted = useCallback((muted: boolean) => {
    controller.setMuted(muted);
  }, [controller]);

  const startRecord = useCallback(() => {
    return controller.startRecording();
  }, [controller]);

  const stopRecord = useCallback(async () => {
    return await controller.stopRecording();
  }, [controller]);

  const deleteRecord = useCallback(() => {
    controller.deleteRecording();
  }, [controller]);

  const setConsent = useCallback((consent: boolean) => {
    controller.setRecordingConsent(consent);
  }, [controller]);

  const playChunk = useCallback(async (data: ArrayBuffer | Float32Array | Int16Array, sampleRate?: number) => {
    await controller.playAudioChunk(data, sampleRate);
  }, [controller]);

  const clearQueue = useCallback(() => {
    controller.clearAudioQueue();
  }, [controller]);

  return {
    controller,
    deviceState,
    recordingState,
    inputLevel,
    startMic,
    stopMic,
    toggleMute,
    setMuted,
    startRecord,
    stopRecord,
    deleteRecord,
    setConsent,
    playChunk,
    clearQueue
  };
}
