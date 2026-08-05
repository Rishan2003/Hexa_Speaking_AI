/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility function to sanitize user-supplied text (transcripts, Part 2 notes, feedback inputs)
 * ensuring no executable HTML or script tags are preserved.
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return '';

  return input
    // Remove script tags and their content
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
    // Remove inline event handlers (e.g., onerror=, onload=)
    .replace(/on\w+\s*=\s*(['"])(.*?)\1/gi, '')
    // Strip standard HTML tags while keeping raw text
    .replace(/<[^>]*>/g, '')
    // Trim leading and trailing whitespace
    .trim();
}

/**
 * Escapes HTML entity characters for safe text insertion
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
