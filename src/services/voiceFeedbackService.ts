/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFirebaseAuth, isFirebaseEnabled } from './firebaseClient';

const VOICE_CHUNK_MAX_CHARS = 650;
const VOICE_CHUNK_TIMEOUT_MS = 45000;
const VOICE_CHUNK_CONCURRENCY = 1;
const VOICE_CHUNK_RETRIES = 1;
// Free-tier Gemini TTS can be as low as 10 requests in the active rate-limit window.
// Keep chunk starts comfortably below that rate while billing is unavailable.
const VOICE_MIN_CHUNK_START_GAP_MS = 7000;

type WavPart = {
  pcm: Uint8Array;
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
};

function normalizeVoiceText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function splitOversizedPiece(piece: string, maxChars: number): string[] {
  const clean = piece.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // Prefer natural clause boundaries before falling back to words.
  const clauses = clean
    .split(/(?<=[,;:—–])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (clauses.length > 1) {
    const results: string[] = [];
    let current = '';
    for (const clause of clauses) {
      if (clause.length > maxChars) {
        if (current) {
          results.push(current);
          current = '';
        }
        results.push(...splitOversizedPiece(clause, maxChars));
        continue;
      }
      const candidate = current ? `${current} ${clause}` : clause;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) results.push(current);
        current = clause;
      }
    }
    if (current) results.push(current);
    return results;
  }

  const words = clean.split(/\s+/).filter(Boolean);
  const results: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) results.push(current);
    if (word.length <= maxChars) {
      current = word;
    } else {
      for (let i = 0; i < word.length; i += maxChars) {
        results.push(word.slice(i, i + maxChars));
      }
      current = '';
    }
  }
  if (current) results.push(current);
  return results;
}

function splitBanglaVoiceText(text: string): string[] {
  const cleanText = normalizeVoiceText(text);
  if (!cleanText) return [];
  if (cleanText.length <= VOICE_CHUNK_MAX_CHARS) return [cleanText];

  const sentences = cleanText
    .match(/[^।!?]+[।!?]?/g)
    ?.map((part) => part.trim())
    .filter(Boolean) || [cleanText];

  const normalizedSentences = sentences.flatMap((sentence) =>
    splitOversizedPiece(sentence, VOICE_CHUNK_MAX_CHARS)
  );

  const chunks: string[] = [];
  let current = '';

  for (const sentence of normalizedSentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= VOICE_CHUNK_MAX_CHARS) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

function parseWav(buffer: ArrayBuffer): WavPart {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44 || readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Bangla voice returned an unexpected audio format. Please try again.');
  }

  let offset = 12;
  let audioFormat = 1;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let pcm: Uint8Array | null = null;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = Math.min(dataStart + chunkSize, buffer.byteLength);

    if (chunkId === 'fmt ' && chunkSize >= 16 && dataStart + 16 <= buffer.byteLength) {
      audioFormat = view.getUint16(dataStart, true);
      channels = view.getUint16(dataStart + 2, true);
      sampleRate = view.getUint32(dataStart + 4, true);
      bitsPerSample = view.getUint16(dataStart + 14, true);
    } else if (chunkId === 'data') {
      pcm = new Uint8Array(buffer.slice(dataStart, dataEnd));
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (!pcm || !pcm.length || !channels || !sampleRate || !bitsPerSample) {
    throw new Error('Bangla voice returned an incomplete WAV file. Please try again.');
  }
  if (audioFormat !== 1) {
    throw new Error('Bangla voice returned a WAV encoding that cannot be merged safely. Please try again.');
  }

  return { pcm, audioFormat, channels, sampleRate, bitsPerSample };
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

async function mergeWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];

  const parts = await Promise.all(blobs.map(async (blob) => parseWav(await blob.arrayBuffer())));
  const first = parts[0];

  for (const part of parts.slice(1)) {
    if (
      part.audioFormat !== first.audioFormat ||
      part.channels !== first.channels ||
      part.sampleRate !== first.sampleRate ||
      part.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error('Bangla voice chunks used different audio settings and could not be joined. Please try again.');
    }
  }

  const dataLength = parts.reduce((sum, part) => sum + part.pcm.length, 0);
  const output = new ArrayBuffer(44 + dataLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);
  const blockAlign = first.channels * (first.bitsPerSample / 8);
  const byteRate = first.sampleRate * blockAlign;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, first.audioFormat, true);
  view.setUint16(22, first.channels, true);
  view.setUint32(24, first.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, first.bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let writeOffset = 44;
  for (const part of parts) {
    bytes.set(part.pcm, writeOffset);
    writeOffset += part.pcm.length;
  }

  return new Blob([output], { type: 'audio/wav' });
}

type VoiceHttpError = Error & {
  status?: number;
  retryAfterMs?: number;
};

function parseRetryDelayMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.ceil(value);
  const text = String(value || '').trim();
  if (!text) return 0;

  const milliseconds = text.match(/([0-9]+(?:\.[0-9]+)?)\s*ms/i);
  if (milliseconds) return Math.ceil(Number(milliseconds[1]) || 0);

  const seconds = text.match(/([0-9]+(?:\.[0-9]+)?)\s*s(?:ec(?:ond)?s?)?/i);
  if (seconds) return Math.ceil((Number(seconds[1]) || 0) * 1000);

  const numericSeconds = Number(text);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) return Math.ceil(numericSeconds * 1000);
  return 0;
}

async function readErrorResponse(response: Response): Promise<VoiceHttpError> {
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

  const retryHeaderMs = parseRetryDelayMs(response.headers.get('Retry-After'));
  const retryBodyMs = parseRetryDelayMs(errorData.retryAfterMs);
  const retryMessageMatch = String(baseMessage).match(/retry\s+in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  const retryMessageMs = retryMessageMatch ? Math.ceil(Number(retryMessageMatch[1]) * 1000) : 0;

  const error = new Error(suffix ? `${baseMessage}\n${suffix}` : baseMessage) as VoiceHttpError;
  error.status = response.status;
  error.retryAfterMs = Math.max(retryHeaderMs, retryBodyMs, retryMessageMs);
  return error;
}

async function fetchVoiceChunk(
  token: string,
  text: string,
  chunkIndex: number,
  chunkCount: number,
  retriesLeft = VOICE_CHUNK_RETRIES
): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_CHUNK_TIMEOUT_MS);

  try {
    const response = await fetch('/api/feedback/voice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ text, chunkIndex, chunkCount }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await readErrorResponse(response);
      const retryable = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
      if (retryable && retriesLeft > 0) {
        const retryDelayMs = response.status === 429
          ? Math.max(error.retryAfterMs || 0, VOICE_MIN_CHUNK_START_GAP_MS) + 750
          : 1000;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return fetchVoiceChunk(token, text, chunkIndex, chunkCount, retriesLeft - 1);
      }
      throw error;
    }

    const blob = await response.blob();
    if (!blob.size) {
      throw new Error(`Bangla voice feedback chunk ${chunkIndex + 1} returned an empty audio file.`);
    }
    return blob;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      if (retriesLeft > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return fetchVoiceChunk(token, text, chunkIndex, chunkCount, retriesLeft - 1);
      }
      throw new Error(`Bangla voice feedback chunk ${chunkIndex + 1} took too long twice. Please try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generateChunksWithLimit(token: string, chunks: string[]): Promise<Blob[]> {
  const results = new Array<Blob>(chunks.length);
  let nextIndex = 0;
  let lastChunkStartedAt = 0;

  async function waitForRequestPacing() {
    const elapsed = Date.now() - lastChunkStartedAt;
    const waitMs = lastChunkStartedAt > 0
      ? Math.max(0, VOICE_MIN_CHUNK_START_GAP_MS - elapsed)
      : 0;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastChunkStartedAt = Date.now();
  }

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= chunks.length) return;
      await waitForRequestPacing();
      results[index] = await fetchVoiceChunk(token, chunks[index], index, chunks.length);
    }
  }

  const workers = Array.from(
    { length: Math.min(VOICE_CHUNK_CONCURRENCY, chunks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export const VoiceFeedbackService = {
  async generateBanglaAudio(text: string): Promise<Blob> {
    const cleanText = normalizeVoiceText(text);
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

    const chunks = splitBanglaVoiceText(cleanText);
    if (!chunks.length) {
      throw new Error('Bangla feedback text is unavailable for this report.');
    }

    const token = await auth.currentUser.getIdToken();
    const audioChunks = await generateChunksWithLimit(token, chunks);
    return mergeWavBlobs(audioChunks);
  },
};
