/**
 * In-memory database for web testing.
 * Mirrors the same API as database.ts but stores data in memory.
 * Data does not persist across page refreshes — this is for testing only.
 */
import { InventoryItem, Session } from '../types';
import { validateItem, sanitizeField } from '../services/validation';

const sessions: Map<string, { id: string; created_at: string }> = new Map();
const items: Map<string, InventoryItem> = new Map();

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export async function createSession(): Promise<string> {
  const id = generateUUID();
  sessions.set(id, { id, created_at: new Date().toISOString() });
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
}

export async function deleteAllSessions(): Promise<void> {
  sessions.clear();
  items.clear();
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
  }
}

export async function deleteItem(itemId: string): Promise<void> {
  items.delete(itemId);
}
