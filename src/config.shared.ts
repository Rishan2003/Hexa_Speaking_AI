/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime-neutral constants shared by the browser app and Node server.
 * Keep this module free of browser-only globals such as import.meta.env,
 * window, and localStorage so it can be bundled safely for CommonJS.
 */
export const LOCAL_HISTORY_STORAGE_KEY = 'speakready_ielts_history_mock';
export const LOCAL_USER_STORAGE_KEY = 'speakready_ielts_user_mock';
