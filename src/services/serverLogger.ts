/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface StructuredLogPayload {
  requestId?: string;
  sessionId?: string;
  userId?: string;
  provider?: string;
  route?: string;
  action?: string;
  latencyMs?: number;
  errorCategory?: string;
  message?: string;
  status?: number;
  [key: string]: any;
}

/**
 * Sanitizes log payloads to prevent accidental leakage of sensitive tokens,
 * passwords, API keys, bearer credentials, or raw audio PCM buffers.
 */
function sanitizeLogPayload(payload: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  const sensitiveKeys = ['authorization', 'token', 'key', 'apikey', 'secret', 'password', 'pcm', 'audiobuffer', 'rawaudio'];

  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveKeys.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogPayload(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Server Structured Logger
 */
export class ServerLogger {
  static info(action: string, payload: StructuredLogPayload = {}): void {
    const logObj = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      action,
      ...sanitizeLogPayload(payload)
    };
    console.log(JSON.stringify(logObj));
  }

  static warn(action: string, payload: StructuredLogPayload = {}): void {
    const logObj = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      action,
      ...sanitizeLogPayload(payload)
    };
    console.warn(JSON.stringify(logObj));
  }

  static error(action: string, errorCategory: string, payload: StructuredLogPayload = {}): void {
    const logObj = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      errorCategory,
      action,
      ...sanitizeLogPayload(payload)
    };
    console.error(JSON.stringify(logObj));
  }
}
