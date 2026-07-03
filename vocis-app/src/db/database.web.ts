/**
 * Web database: in-memory Maps snapshotted to localStorage after every
 * mutation, so sessions survive refreshes and browser restarts.
 * Mirrors the same API as database.ts. Unlike the native build, data at
 * rest is NOT encrypted — localStorage has no SQLCipher equivalent.
 */
import { InventoryItem, Session } from '../types';
import { validateItem, sanitizeField } from '../services/validation';

const STORAGE_KEY = 'vocis_web_db_v1';

const sessions: Map<string, { id: string; created_at: string }> = new Map();
const items: Map<string, InventoryItem> = new Map();

function storage(): Storage | null {
  // Accessing localStorage can throw (SSR, cookies disabled, private mode).
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessions: Array.from(sessions.values()),
        items: Array.from(items.values()),
      })
    );
  } catch (e) {
    // Quota exceeded or storage revoked — keep serving from memory.
    console.warn('[DB] Failed to persist to localStorage:', e);
  }
}

function hydrate(): void {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return;
    const snapshot = JSON.parse(raw);
    for (const session of snapshot.sessions ?? []) {
      if (session?.id && session?.created_at) sessions.set(session.id, session);
    }
    for (const item of snapshot.items ?? []) {
      if (item?.id && item?.session_id) items.set(item.id, item);
    }
  } catch (e) {
    console.warn('[DB] Corrupt localStorage snapshot, starting fresh:', e);
  }
}

hydrate();

function generateUUID(): string {
  // Web Crypto API is available in all modern browsers — CSPRNG-backed.
  return crypto.randomUUID();
}

export async function createSession(): Promise<string> {
  const id = generateUUID();
  sessions.set(id, { id, created_at: new Date().toISOString() });
  persist();
  return id;
}

export async function getSessions(): Promise<Session[]> {
  const result: Session[] = [];
  for (const session of sessions.values()) {
    const sessionItems = Array.from(items.values()).filter(
      (i) => i.session_id === session.id
    );
    result.push({
      id: session.id,
      created_at: session.created_at,
      item_count: sessionItems.length,
      total_value: sessionItems.reduce((sum, i) => sum + i.price, 0),
    });
  }
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return result;
}

export async function deleteSession(sessionId: string): Promise<void> {
  for (const [id, item] of items) {
    if (item.session_id === sessionId) items.delete(id);
  }
  sessions.delete(sessionId);
  persist();
}

export async function deleteAllSessions(): Promise<void> {
  sessions.clear();
  items.clear();
  persist();
}

export async function purgeOldSessions(daysOld: number = 90): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  for (const [id, session] of sessions) {
    if (new Date(session.created_at) < cutoff) {
      for (const [itemId, item] of items) {
        if (item.session_id === id) items.delete(itemId);
      }
      sessions.delete(id);
    }
  }
  persist();
}

export async function addItem(
  item: Omit<InventoryItem, 'id' | 'logged_at'>
): Promise<string> {
  const sanitized = {
    ...item,
    size: sanitizeField(item.size),
    decade: sanitizeField(item.decade),
    item_name: sanitizeField(item.item_name),
    raw_title: sanitizeField(item.raw_title),
  };

  const validation = validateItem(sanitized);
  if (!validation.valid) {
    throw new Error(`Invalid item data: ${validation.errors.join(', ')}`);
  }

  const id = generateUUID();
  const full: InventoryItem = {
    ...sanitized,
    id,
    logged_at: new Date().toISOString(),
  };
  items.set(id, full);
  persist();
  return id;
}

export async function getSessionItems(
  sessionId: string
): Promise<InventoryItem[]> {
  return Array.from(items.values())
    .filter((i) => i.session_id === sessionId)
    .sort((a, b) => a.logged_at.localeCompare(b.logged_at));
}

export async function updateItem(item: InventoryItem): Promise<void> {
  if (items.has(item.id)) {
    items.set(item.id, item);
    persist();
  }
}

export async function deleteItem(itemId: string): Promise<void> {
  items.delete(itemId);
  persist();
}
