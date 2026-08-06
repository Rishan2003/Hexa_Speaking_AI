const API_REVISION = '1.4.0-bangla-voice-feedback';
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

function findAudioContent(payload: any): { data: string; mimeType: string } | null {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.type !== 'model_output' || !Array.isArray(step?.content)) continue;
    for (let j = step.content.length - 1; j >= 0; j -= 1) {
      const item = step.content[j];
      if (item?.type === 'audio' && typeof item?.data === 'string' && item.data) {
        return {
          data: item.data,
          mimeType: typeof item?.mime_type === 'string' && item.mime_type ? item.mime_type : 'audio/mpeg',
        };
      }
    }
  }

  // Some SDK-shaped gateways expose this convenience property. Keeping this
  // fallback makes the endpoint tolerant to either response representation.
  if (typeof payload?.output_audio?.data === 'string' && payload.output_audio.data) {
    return {
      data: payload.output_audio.data,
      mimeType: payload.output_audio.mime_type || 'audio/mpeg',
    };
  }

  return null;
}

async function requestTts(apiKey: string, model: string, voice: string, text: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 42_000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20',
      },
      body: JSON.stringify({
        model,
        input: `Synthesize speech only. Speak in natural Bangladeshi Bangla with a warm, calm IELTS-teacher tone. Use a clear moderate pace. Do not read these instructions aloud. Read only the spoken transcript below.\n\nSpoken transcript:\n${text}`,
        response_format: {
          type: 'audio',
          mime_type: 'audio/mp3',
          delivery: 'inline',
        },
        generation_config: {
          speech_config: [
            { voice },
          ],
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

    if (!text) {
      return sendJson(res, 400, {
        error: 'Bangla feedback text is required.',
        code: 'VOICE_FEEDBACK_TEXT_MISSING',
        stage: 'voice_feedback_input',
        requestId: rid,
        apiRevision: API_REVISION,
      });
    }

    if (text.length > 3200) {
      return sendJson(res, 413, {
        error: 'Bangla feedback is too long for a single voice response.',
        code: 'VOICE_FEEDBACK_TEXT_TOO_LONG',
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

    // Gemini TTS documentation notes a rare transient 500 where text tokens are
    // returned instead of audio. Retry that specific server-side failure once.
    let attempt = await requestTts(apiKey, model, voice, text);
    if (attempt.response.status === 500) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      attempt = await requestTts(apiKey, model, voice, text);
    }

    if (!attempt.response.ok) {
      return sendJson(res, attempt.response.status >= 500 ? 502 : attempt.response.status, {
        error: upstreamMessage(attempt.result.payload, `Gemini TTS returned HTTP ${attempt.response.status}.`),
        code: attempt.result.payload?.error?.status || `GEMINI_TTS_HTTP_${attempt.response.status}`,
        stage: 'gemini_tts',
        upstreamStatus: attempt.response.status,
        requestId: rid,
        apiRevision: API_REVISION,
        ttsModel: model,
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
      });
    }

    const bytes = Buffer.from(audio.data, 'base64');
    if (!bytes.length) {
      return sendJson(res, 502, {
        error: 'Gemini TTS returned an empty audio payload.',
        code: 'GEMINI_TTS_AUDIO_EMPTY',
        stage: 'gemini_tts_response',
        requestId: rid,
        apiRevision: API_REVISION,
        ttsModel: model,
      });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', audio.mimeType || 'audio/mpeg');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-HEXA-Voice-Revision', API_REVISION);
    res.setHeader('X-HEXA-TTS-Model', model);
    res.setHeader('X-Request-ID', rid);
    return res.status(200).send(bytes);
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError';
    console.error('[HEXA Bangla voice feedback]', rid, error?.name, error?.message);
    return sendJson(res, timedOut ? 504 : 500, {
      error: timedOut
        ? 'Bangla voice generation timed out. Please try again.'
        : (error?.message || 'The Bangla voice-feedback endpoint encountered an unexpected error.'),
      code: timedOut ? 'VOICE_FEEDBACK_TIMEOUT' : 'VOICE_FEEDBACK_UNEXPECTED_ERROR',
      stage: 'voice_feedback',
      requestId: rid,
      apiRevision: API_REVISION,
    });
  }
}
