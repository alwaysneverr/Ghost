/**
 * What has to survive a restart, in one SQLite file: reminders that haven't gone off
 * yet (src/reminders.js). Uses Node's built-in SQLite, so there's nothing to compile.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.GHOST_DB_PATH || join(__dirname, '..', 'data', 'ghost.db');

let db = null;

function database() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      reason     TEXT NOT NULL,
      minutes    INTEGER NOT NULL,
      due_at     INTEGER NOT NULL
    );
  `);
  return db;
}

// Returns the reminder with its id.
export function addReminder({ userId, channelId, reason, minutes, dueAt }) {
  const { lastInsertRowid } = database()
    .prepare('INSERT INTO reminders (user_id, channel_id, reason, minutes, due_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, channelId, reason, minutes, dueAt);
  return { id: Number(lastInsertRowid), userId, channelId, reason, minutes, dueAt };
}

export function getReminders() {
  return database()
    .prepare('SELECT * FROM reminders ORDER BY due_at')
    .all()
    .map(row => ({
      id: row.id,
      userId: row.user_id,
      channelId: row.channel_id,
      reason: row.reason,
      minutes: row.minutes,
      dueAt: row.due_at,
    }));
}

export function countReminders(userId) {
  return database().prepare('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?').get(userId).n;
}

export function deleteReminder(id) {
  database().prepare('DELETE FROM reminders WHERE id = ?').run(id);
}
