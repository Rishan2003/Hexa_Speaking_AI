import { describe, expect, it } from 'vitest';
import { buildOpenAIRealtimeMultipart } from '../../api/session-mint-openai';

describe('OpenAI Realtime WebRTC multipart call creation', () => {
  it('encodes sdp and session as typed multipart fields without filenames', () => {
    const sdp = [
      'v=0',
      'o=- 123 456 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      '',
    ].join('\r\n');

    const { body, contentType } = buildOpenAIRealtimeMultipart(
      sdp,
      { type: 'realtime', model: 'gpt-realtime-2.1' },
      'mint-test-request'
    );

    const encoded = body.toString('utf8');

    expect(contentType).toMatch(/^multipart\/form-data; boundary=----hexa-openai-/);
    expect(encoded).toContain('Content-Disposition: form-data; name="sdp"\r\nContent-Type: application/sdp\r\n\r\nv=0');
    expect(encoded).toContain('Content-Disposition: form-data; name="session"\r\nContent-Type: application/json\r\n\r\n{"type":"realtime","model":"gpt-realtime-2.1"}');
    expect(encoded).not.toMatch(/name="sdp";\s*filename=/);
    expect(encoded).not.toMatch(/name="session";\s*filename=/);
  });
});
