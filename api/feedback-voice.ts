const API_REVISION = '1.4.4-chunked-bangla-voice';
const runtimeEnv: Record<string, string | undefined> = (globalThis as any)?.process?.env || {};

function requestId() {
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sendJson(res: any, status: number, body: Record<string, unknown>) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-HEXA-Voice-Revision', API_REVISION);
  return res.status(status).json(body);
}

async function readJsonSafe(response: Response) {
  const text = await response.text();
  try {
    return { payload: text ? JSON.parse(text) : {}, text };
  } catch {
    return { payload: {}, text };
  }
}

function upstreamMessage(payload: any, fallback: string) {
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}

async function verifyFirebaseIdToken(idToken: string) {
  const firebaseWebApiKey = String(runtimeEnv.FIREBASE_WEB_API_KEY || runtimeEnv.VITE_FIREBASE_API_KEY || '').trim();
  if (!firebaseWebApiKey) {
    return {
      ok: false as const,
      status: 503,
      code: 'FIREBASE_WEB_API_KEY_MISSING',
      error: 'Firebase Web API key is not available to the voice-feedback function.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      }
    );
    const result = await readJsonSafe(response);
    const uid = result.payload?.users?.[0]?.localId;
    if (!response.ok || typeof uid !== 'string' || !uid) {
      return {
        ok: false as const,
        status: 401,
        code: String(result.payload?.error?.message || 'INVALID_ID_TOKEN'),
        error: 'Your sign-in session could not be verified. Sign in again and retry.',
      };
    }
    return { ok: true as const, uid };
  } catch (error: any) {
    return {
      ok: false as const,
      status: 502,
      code: error?.name === 'AbortError' ? 'FIREBASE_AUTH_TIMEOUT' : 'FIREBASE_AUTH_NETWORK_ERROR',
      error: error?.name === 'AbortError'
        ? 'Firebase authentication verification timed out.'
        : 'Could not reach Firebase Authentication to verify the user.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findAudioContent(payload: any): { data: string; mimeType: string; sampleRate: number; channels: number } | null {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData || part?.inline_data;
      if (typeof inlineData?.data !== 'string' || !inlineData.data) continue;

      const mimeType = String(inlineData?.mimeType || inlineData?.mime_type || 'audio/L16;codec=pcm;rate=24000');
      const rateMatch = mimeType.match(/rate=(\d+)/i);
      return {
        data: inlineData.data,
        mimeType,
        sampleRate: rateMatch ? Number(rateMatch[1]) : 24000,
        channels: 1,
      };
    }
  }
  return null;
}

function pcm16LeToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : 24000;
  const safeChannels = Number.isFinite(channels) && channels > 0 ? Math.floor(channels) : 1;
  const bitsPerSample = 16;
  const blockAlign = safeChannels * (bitsPerSample / 8);
  const byteRate = safeRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(safeChannels, 22);
  header.writeUInt32LE(safeRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function requestTts(
  apiKey: string,
  model: string,
  voice: string,
  text: string,
  chunkIndex: number,
  chunkCount: number
) {
  // Keep well below Vercel's 60 second function limit. The browser now sends
  // short chunks and can retry an individual chunk as a fresh invocation.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 36_000);

  try {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const continuityHint = chunkCount > 1
      ? `This is segment ${chunkIndex + 1} of ${chunkCount} from one continuous coaching review. `
      : '';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text:
              'Read exactly the Bangla feedback below. ' +
              continuityHint +
              'Use natural Bangladeshi Bangla, a warm and calm IELTS-teacher tone, a clear moderate pace, and natural short pauses. ' +
              'Do not summarize, paraphrase, add an introduction, add a conclusion, or read these instructions aloud.\n\n' +
              text,
          }],
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },
        },
      }),
      signal: controller.signal,
    });

    const result = await readJsonSafe(response);
    return { response, result };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: any, res: any) {
  const rid = requestId();

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, {
      error: 'Method not allowed.',
      code: 'METHOD_NOT_ALLOWED',
      stage: 'voice_feedback_route',
      requestId: rid,
      apiRevision: API_REVISION,
    });
  }

  try {
    const authHeader = String(req.headers?.authorization || '');
    if (!authHeader.startsWith('Bearer ')) {
      return sendJson(res, 401, {
        error: 'Authentication is required to generate voice feedback.',
        code: 'AUTH_REQUIRED',
        stage: 'authentication',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const verified = await verifyFirebaseIdToken(authHeader.slice(7).trim());
    if (!verified.ok) {
      return sendJson(res, verified.status, {
        error: verified.error,
        code: verified.code,
        stage: 'authentication',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const text = String(body.text || '').replace(/\s+/g, ' ').trim();
    const chunkIndex = Number.isInteger(body.chunkIndex) && body.chunkIndex >= 0 ? body.chunkIndex : 0;
    const chunkCount = Number.isInteger(body.chunkCount) && body.chunkCount > 0 ? body.chunkCount : 1;

    if (!text) {
      return sendJson(res, 400, {
        error: 'Bangla feedback text is required.',
        code: 'VOICE_FEEDBACK_TEXT_MISSING',
        stage: 'voice_feedback_input',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    // Long feedback is intentionally sent as several short requests by the
    // client so no single serverless invocation has to synthesize 2-3 minutes.
    if (text.length > 900) {
      return sendJson(res, 413, {
        error: 'This voice segment is too long. Please send the feedback in smaller chunks.',
        code: 'VOICE_FEEDBACK_CHUNK_TOO_LONG',
        stage: 'voice_feedback_input',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const apiKey = String(runtimeEnv.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return sendJson(res, 503, {
        error: 'GEMINI_API_KEY is not configured on the server.',
        code: 'GEMINI_NOT_CONFIGURED',
        stage: 'tts_configuration',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    const model = String(runtimeEnv.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview').trim();
    const voice = String(runtimeEnv.GEMINI_TTS_VOICE || 'Kore').trim();

    // Do not retry inside one Vercel invocation. A retry after a long upstream
    // delay can itself hit maxDuration. The browser retries only the failed
    // chunk as a brand-new function call instead.
    const attempt = await requestTts(apiKey, model, voice, text, chunkIndex, chunkCount);

    if (!attempt.response.ok) {
      return sendJson(res, attempt.response.status >= 500 ? 502 : attempt.response.status, {
        error: upstreamMessage(attempt.result.payload, `Gemini TTS returned HTTP ${attempt.response.status}.`),
        code: attempt.result.payload?.error?.status || `GEMINI_TTS_HTTP_${attempt.response.status}`,
        stage: 'gemini_tts',
        upstreamStatus: attempt.response.status,
        requestId: rid,
        apiRevision: API_REVISION,
        ttsModel: model,
        chunkIndex,
        chunkCount,
      });
    }

    const audio = findAudioContent(attempt.result.payload);
    if (!audio) {
      return sendJson(res, 502, {
        error: 'Gemini TTS completed without returning playable audio.',
        code: 'GEMINI_TTS_AUDIO_MISSING',
        stage: 'gemini_tts_response',
        requestId: rid,
        apiRevision: API_REVISION,
        ttsModel: model,
        chunkIndex,
        chunkCount,
      });
    }

    let bytes = Buffer.from(audio.data, 'base64');
    if (!bytes.length) {
      return sendJson(res, 502, {
        error: 'Gemini TTS returned an empty audio payload.',
        code: 'GEMINI_TTS_AUDIO_EMPTY',
        stage: 'gemini_tts_response',
        requestId: rid,
        apiRevision: API_REVISION,
        ttsModel: model,
        chunkIndex,
        chunkCount,
      });
    }

    let responseMimeType = audio.mimeType || 'audio/l16';
    const normalizedMime = responseMimeType.toLowerCase();
    if (normalizedMime.includes('audio/l16') || normalizedMime.includes('audio/pcm')) {
      bytes = pcm16LeToWav(bytes, audio.sampleRate, audio.channels);
      responseMimeType = 'audio/wav';
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', responseMimeType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-HEXA-Voice-Revision', API_REVISION);
    res.setHeader('X-HEXA-TTS-Model', model);
    res.setHeader('X-HEXA-Voice-Chunk', `${chunkIndex + 1}/${chunkCount}`);
    res.setHeader('X-Request-ID', rid);
    return res.status(200).send(bytes);
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError';
    console.error('[HEXA Bangla voice feedback]', rid, error?.name, error?.message);
    return sendJson(res, timedOut ? 504 : 500, {
      error: timedOut
        ? 'This Bangla voice segment timed out. It can be retried separately.'
        : (error?.message || 'The Bangla voice-feedback endpoint encountered an unexpected error.'),
      code: timedOut ? 'VOICE_FEEDBACK_CHUNK_TIMEOUT' : 'VOICE_FEEDBACK_UNEXPECTED_ERROR',
      stage: 'voice_feedback',
      requestId: rid,
      apiRevision: API_REVISION,
    });
  }
}
