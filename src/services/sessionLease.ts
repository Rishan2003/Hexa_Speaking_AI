/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SessionLeaseData {
  sessionId: string;
  tabId: string;
  lastHeartbeat: number;
}

const LEASE_PREFIX = 'speakready_session_lease_';
const LEASE_EXPIRY_MS = 5000; // Lease expires if heartbeat stops for > 5 seconds

const inMemoryLeaseStore = new Map<string, string>();

function getStorageItem(key: string): string | null {
  if (typeof localStorage !== 'undefined' && localStorage) {
    return localStorage.getItem(key);
  }
  return inMemoryLeaseStore.get(key) || null;
}

function setStorageItem(key: string, value: string): void {
  if (typeof localStorage !== 'undefined' && localStorage) {
    localStorage.setItem(key, value);
  }
  inMemoryLeaseStore.set(key, value);
}

function removeStorageItem(key: string): void {
  if (typeof localStorage !== 'undefined' && localStorage) {
    localStorage.removeItem(key);
  }
  inMemoryLeaseStore.delete(key);
}

export class SessionLeaseManager {
  private static getKey(sessionId: string): string {
    return `${LEASE_PREFIX}${sessionId}`;
  }

  /**
   * Generates a unique Tab ID for the current browser tab window context.
   */
  public static getOrCreateTabId(): string {
    if (typeof sessionStorage === 'undefined' || !sessionStorage) {
      return `tab-ssr-${Math.random().toString(36).substring(2, 9)}`;
    }
    let tabId = sessionStorage.getItem('speakready_tab_id');
    if (!tabId) {
      tabId = `tab-${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem('speakready_tab_id', tabId);
    }
    return tabId;
  }

  /**
   * Attempts to acquire or maintain a session lease for the given tab.
   */
  public static acquireLease(sessionId: string, tabId: string): { acquired: boolean; ownerTabId: string } {
    const key = this.getKey(sessionId);
    const now = Date.now();
    const raw = getStorageItem(key);

    if (raw) {
      try {
        const lease: SessionLeaseData = JSON.parse(raw);
        // If lease belongs to this tab, renew heartbeat
        if (lease.tabId === tabId) {
          setStorageItem(key, JSON.stringify({ sessionId, tabId, lastHeartbeat: now }));
          return { acquired: true, ownerTabId: tabId };
        }
        // If lease is active from another tab, acquisition fails
        if (now - lease.lastHeartbeat < LEASE_EXPIRY_MS) {
          return { acquired: false, ownerTabId: lease.tabId };
        }
      } catch (e) {
        console.warn('[SessionLeaseManager] Corrupted lease entry, taking over.', e);
      }
    }

    // Acquire new or expired lease
    setStorageItem(key, JSON.stringify({ sessionId, tabId, lastHeartbeat: now }));
    return { acquired: true, ownerTabId: tabId };
  }

  /**
   * Renew the active heartbeat for a tab.
   */
  public static renewLease(sessionId: string, tabId: string): boolean {
    return this.acquireLease(sessionId, tabId).acquired;
  }

  /**
   * Release the session lease when navigating away or closing the tab.
   */
  public static releaseLease(sessionId: string, tabId: string): void {
    const key = this.getKey(sessionId);
    const raw = getStorageItem(key);
    if (raw) {
      try {
        const lease: SessionLeaseData = JSON.parse(raw);
        if (lease.tabId === tabId) {
          removeStorageItem(key);
        }
      } catch (e) {
        removeStorageItem(key);
      }
    }
  }

  /**
   * Checks if a session is currently locked by another tab.
   */
  public static isTabLocked(sessionId: string, tabId: string): boolean {
    const key = this.getKey(sessionId);
    const raw = getStorageItem(key);
    if (!raw) return false;
    try {
      const lease: SessionLeaseData = JSON.parse(raw);
      if (lease.tabId !== tabId && Date.now() - lease.lastHeartbeat < LEASE_EXPIRY_MS) {
        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }
}
