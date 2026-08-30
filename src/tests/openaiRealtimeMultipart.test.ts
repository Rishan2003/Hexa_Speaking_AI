import { describe, expect, it } from 'vitest';
import { buildOpenAIRealtimeFormData } from '../../api/session-mint-openai';

describe('OpenAI Realtime multipart form', () => {
  it('uses plain string fields for SDP and session', () => {
    const sdp = [
      'v=0',
      'o=- 123 456 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      '',
    ].join('\r\n');
    const session = { type: 'realtime', model: 'gpt-realtime-2.1' };

    const form = buildOpenAIRealtimeFormData(sdp, session);

    expect(form.get('sdp')).toBe(sdp);
    expect(form.get('session')).toBe(JSON.stringify(session));
    expect(typeof form.get('sdp')).toBe('string');
    expect(typeof form.get('session')).toBe('string');
  });
});
