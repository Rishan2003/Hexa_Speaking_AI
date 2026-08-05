/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FirebaseRepository } from './firebaseRepository';
import { SpeechChunk, ExamState, IELTSExamPart } from '../types';

export interface PendingWriteItem {
  id: string; // client eventId
  type: 'turn' | 'sessionState';
  sessionId: string;
  partId?: string;
  payload: any;
  createdAt: number;
  attempts: number;
}

const RETRY_STORAGE_KEY = 'speakready_pending_writes_queue';

export class PersistenceQueueService {
  private queue: PendingWriteItem[] = [];
  private isProcessing = false;
  private timerId: NodeJS.Timeout | null = null;

  constructor() {
    this.loadQueueFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.processQueue());
    }
  }

  private loadQueueFromStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(RETRY_STORAGE_KEY);
      if (raw) {
        this.queue = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[PersistenceQueue] Failed to load retry queue from localStorage:', e);
    }
  }

  private saveQueueToStorage() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(RETRY_STORAGE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.warn('[PersistenceQueue] Failed to save retry queue to localStorage:', e);
    }
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get all unsaved pending turns in memory/localStorage for a specific session.
   * Useful for reconciling local turns on reconnect before Firestore write completes.
   */
  public getPendingTurnsForSession(sessionId: string): SpeechChunk[] {
    return this.queue
      .filter(item => item.sessionId === sessionId && item.type === 'turn')
      .map(item => item.payload as SpeechChunk);
  }

  /**
   * Reconcile local pending events with an existing transcript array without duplicates.
   */
  public reconcileTranscript(sessionId: string, currentTranscript: SpeechChunk[]): SpeechChunk[] {
    const pendingTurns = this.getPendingTurnsForSession(sessionId);
    if (pendingTurns.length === 0) return currentTranscript;

    const map = new Map<string, SpeechChunk>();
    currentTranscript.forEach(turn => {
      const key = turn.eventId || turn.id;
      map.set(key, turn);
    });

    pendingTurns.forEach(turn => {
      const key = turn.eventId || turn.id;
      if (!map.has(key)) {
        map.set(key, turn);
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.sequence !== undefined && b.sequence !== undefined) {
        return a.sequence - b.sequence;
      }
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Save a turn idempotently with sequence, eventId, startTime, endTime, and interrupted marker.
   */
  public async saveTurn(
    sessionId: string,
    partId: string,
    turn: SpeechChunk
  ): Promise<void> {
    const item: PendingWriteItem = {
      id: turn.eventId || turn.id,
      type: 'turn',
      sessionId,
      partId,
      payload: turn,
      createdAt: Date.now(),
      attempts: 0
    };

    try {
      await FirebaseRepository.saveSessionTurn(sessionId, turn, partId);
    } catch (err) {
      console.warn(`[PersistenceQueue] Turn write failed, adding to retry queue: ${item.id}`, err);
      this.enqueue(item);
    }
  }

  /**
   * Update session state in database
   */
  public async updateSessionState(
    sessionId: string,
    state: ExamState,
    part: IELTSExamPart,
    transcript?: SpeechChunk[],
    part2Meta?: any,
    draftNotes?: string
  ): Promise<void> {
    const item: PendingWriteItem = {
      id: `state-${sessionId}-${Date.now()}`,
      type: 'sessionState',
      sessionId,
      payload: { state, part, transcript, part2Meta, draftNotes },
      createdAt: Date.now(),
      attempts: 0
    };

    try {
      await FirebaseRepository.updateSessionState(sessionId, state, part, transcript, part2Meta, draftNotes);
    } catch (err) {
      console.warn(`[PersistenceQueue] Session state write failed, adding to retry queue: ${item.id}`, err);
      this.enqueue(item);
    }
  }

  private enqueue(item: PendingWriteItem) {
    if (!this.queue.some(q => q.id === item.id)) {
      this.queue.push(item);
      this.saveQueueToStorage();
    }
    this.scheduleProcess();
  }

  public scheduleProcess(delayMs = 2000) {
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => this.processQueue(), delayMs);
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const remainingQueue: PendingWriteItem[] = [];

    for (const item of this.queue) {
      try {
        if (item.type === 'turn') {
          await FirebaseRepository.saveSessionTurn(item.sessionId, item.payload, item.partId || 'part-1');
        } else if (item.type === 'sessionState') {
          await FirebaseRepository.updateSessionState(
            item.sessionId,
            item.payload.state,
            item.payload.part,
            item.payload.transcript,
            item.payload.part2Meta,
            item.payload.draftNotes
          );
        }
      } catch (err) {
        item.attempts += 1;
        if (item.attempts < 10) {
          remainingQueue.push(item);
        } else {
          console.error(`[PersistenceQueue] Dropping write item after max retries: ${item.id}`);
        }
      }
    }

    this.queue = remainingQueue;
    this.saveQueueToStorage();
    this.isProcessing = false;

    if (this.queue.length > 0) {
      this.scheduleProcess(5000);
    }
  }
}

export const persistenceQueue = new PersistenceQueueService();
