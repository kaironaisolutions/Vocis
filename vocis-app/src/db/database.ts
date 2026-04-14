import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { InventoryItem, Session } from '../types';
import { SecureStorage } from '../services/secureStorage';
import { validateItem, sanitizeField } from '../services/validation';

const isWeb = Platform.OS === 'web';

let db: SQLite.SQLiteDatabase | null = null;
let initializationFailed = false;

/**
 * Open the encrypted database.
 * SQLCipher is enabled via expo-sqlite plugin config.
 * The encryption key is derived from the device keychain/keystore,
 * ensuring data cannot be read even on jailbroken devices without
 * the original secure enclave key.
 *
 * CRITICAL: The app must not start if encryption cannot be initialized.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (initializationFailed) {
    throw new Error(
      'Database encryption failed to initialize. The app cannot operate without encrypted storage.'
    );
  }

  if (db) return db;

  try {
    db = await SQLite.openDatabaseAsync('vocis.db');

    // SQLCipher encryption — native only (not available on web)
    if (!isWeb) {
      const encryptionKey = await SecureStorage.getDbEncryptionKey();
      await db.execAsync(`PRAGMA key = '${escapeSQLString(encryptionKey)}';`);
      await db.execAsync('PRAGMA cipher_version;');
    }

    // Enable WAL mode for better performance
    await db.execAsync('PRAGMA journal_mode = WAL;');

    // Enable foreign keys
    await db.execAsync('PRAGMA foreign_keys = ON;');

    // Create tables
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        size TEXT NOT NULL,
        decade TEXT NOT NULL,
        item_name TEXT NOT NULL,
        price REAL NOT NULL CHECK(price >= 0),
        raw_title TEXT NOT NULL,
        session_id TEXT NOT NULL,
        logged_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);

    return db;
  } catch (error) {
    initializationFailed = true;
    db = null;
    throw new Error(
      'Failed to initialize encrypted database. Please restart the app. ' +
      'If this persists, your device keychain may be inaccessible.'
    );
  }
}

/**
 * Escape single quotes in SQL strings to prevent injection.
 */
function escapeSQLString(str: string): string {
  return str.replace(/'/g, "''");
}

// --- Sessions ---

export async function createSession(): Promise<string> {
  const database = await getDatabase();
  const id = generateUUID();
  await database.runAsync(
    'INSERT INTO sessions (id) VALUES (?)',
    id
  );
  return id;
}

export async function getSessions(): Promise<Session[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<Session>(
    `SELECT s.id, s.created_at,
            COUNT(i.id) as item_count,
            COALESCE(SUM(i.price), 0) as total_value
     FROM sessions s
     LEFT JOIN items i ON i.session_id = s.id
     GROUP BY s.id
     ORDER BY s.created_at DESC`
  );
  return rows;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM items WHERE session_id = ?', sessionId);
  await database.runAsync('DELETE FROM sessions WHERE id = ?', sessionId);
}

export async function deleteAllSessions(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync('DELETE FROM items; DELETE FROM sessions;');
}

export async function purgeOldSessions(daysOld: number = 90): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `DELETE FROM items WHERE session_id IN (
      SELECT id FROM sessions WHERE created_at < datetime('now', ? || ' days')
    )`,
    `-${daysOld}`
  );
  await database.runAsync(
    "DELETE FROM sessions WHERE created_at < datetime('now', ? || ' days')",
    `-${daysOld}`
  );
}

// --- Items ---

export async function addItem(item: Omit<InventoryItem, 'id' | 'logged_at'>): Promise<string> {
  // Sanitize all string fields
  const sanitized = {
    ...item,
    size: sanitizeField(item.size),
    decade: sanitizeField(item.decade),
    item_name: sanitizeField(item.item_name),
    raw_title: sanitizeField(item.raw_title),
  };

  // Validate before writing
  const validation = validateItem(sanitized);
  if (!validation.valid) {
    throw new Error(`Invalid item data: ${validation.errors.join(', ')}`);
  }

  const database = await getDatabase();
  const id = generateUUID();
  await database.runAsync(
    `INSERT INTO items (id, size, decade, item_name, price, raw_title, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    sanitized.size,
    sanitized.decade,
    sanitized.item_name,
    sanitized.price,
    sanitized.raw_title,
    sanitized.session_id
  );
  return id;
}

export async function getSessionItems(sessionId: string): Promise<InventoryItem[]> {
  const database = await getDatabase();
  return database.getAllAsync<InventoryItem>(
    'SELECT * FROM items WHERE session_id = ? ORDER BY logged_at ASC',
    sessionId
  );
}

export async function updateItem(item: InventoryItem): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE items SET size = ?, decade = ?, item_name = ?, price = ?, raw_title = ?
     WHERE id = ?`,
    item.size,
    item.decade,
    item.item_name,
    item.price,
    item.raw_title,
    item.id
  );
}

export async function deleteItem(itemId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM items WHERE id = ?', itemId);
}

// --- Utilities ---

function generateUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  // Fallback using crypto.getRandomValues (available in React Native)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    // Set version 4 and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error('No cryptographic random source available for UUID generation.');
}
