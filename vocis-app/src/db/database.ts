import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { InventoryItem, Session } from '../types';
import { validateItem, sanitizeField } from '../services/validation';

const isWeb = Platform.OS === 'web';

const DB_KEY_STORE = 'vocis_db_key_v1';

/**
 * Retrieve or generate the 32-byte hex encryption key for the SQLite database.
 * Key is stored in iOS Keychain / Android Keystore — never in source code.
 */
async function getOrCreateDbKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(DB_KEY_STORE);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await SecureStore.setItemAsync(DB_KEY_STORE, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return key;
}

let db: SQLite.SQLiteDatabase | null = null;
let initializationFailed = false;

/**
 * Open the encrypted database.
 * expo-sqlite v16 native encryption is enabled via the encryptionKey option on iOS.
 * The key is generated once and stored in the iOS Keychain / Android Keystore.
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
    // Open the database (always plain open — SQLCipher encryption applied via PRAGMA key below)
    db = await SQLite.openDatabaseAsync('vocis.db');

    // SQLCipher encryption — native only (not available on web).
    // Requires expo-sqlite plugin built with useSQLCipher: true in app.json.
    // PRAGMA key must be the first statement after opening.
    if (!isWeb) {
      const encryptionKey = await getOrCreateDbKey();
      await db.execAsync(`PRAGMA key = '${escapeSQLString(encryptionKey)}';`);
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
 * Escape single quotes in SQL strings to prevent PRAGMA key injection.
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
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
