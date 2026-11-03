/**
 * Everything that has to survive a restart, in one SQLite file: each channel's
 * recent conversation, the facts people have told her about themselves
 * (src/memory.js), and reminders that haven't gone off yet (src/reminders.js). Uses
 * Node's built-in SQLite, so there's nothing to compile.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.GHOST_DB_PATH || join(__dirname, '..', 'data', 'ghost.db');

// A conversation this old is over. It also limits how long a message about
// someone's worst day stays on disk: long enough for the crisis handling to
// survive a restart, and no longer.
const HISTORY_MAX_AGE_MS = Number(process.env.HISTORY_MAX_AGE_HOURS || 24) * 60 * 60 * 1000;

const MAX_FACTS_PER_PERSON = 20;

let db = null;

function database() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_state (
      channel_id   TEXT PRIMARY KEY,
      history      TEXT NOT NULL,
      past_replies TEXT NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_facts (
      user_id    TEXT NOT NULL,
      scope      TEXT NOT NULL,
      fact       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, scope, fact)
    );
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

// channelId -> { history, pastReplies, updatedAt }. Handlers share these objects,
// so two messages arriving at once in a channel don't overwrite each other.
const channels = new Map();

function freshChannel() {
  return { history: [], pastReplies: [], updatedAt: Date.now() };
}

// A channel's conversation: from memory, else from disk, else a new one.
// Anything past its age limit is deleted, not just ignored.
export function getChannel(channelId) {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  database().prepare('DELETE FROM channel_state WHERE updated_at < ?').run(cutoff);

  const cached = channels.get(channelId);
  if (cached && cached.updatedAt >= cutoff) return cached;

  const row = database().prepare('SELECT * FROM channel_state WHERE channel_id = ?').get(channelId);
  const channel = row
    ? {
        history: JSON.parse(row.history),
        pastReplies: JSON.parse(row.past_replies),
        updatedAt: row.updated_at,
      }
    : freshChannel();
  channels.set(channelId, channel);
  return channel;
}

export function saveChannel(channelId) {
  const channel = channels.get(channelId);
  channel.updatedAt = Date.now();
  database()
    .prepare(
      `INSERT INTO channel_state (channel_id, history, past_replies, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (channel_id) DO UPDATE SET
         history = excluded.history,
         past_replies = excluded.past_replies,
         updated_at = excluded.updated_at`
    )
    .run(channelId, JSON.stringify(channel.history), JSON.stringify(channel.pastReplies), channel.updatedAt);
}

// Keeps the most recent facts once someone goes over the limit.
export function addFact(userId, scope, fact) {
  const now = Date.now();
  database()
    .prepare('INSERT OR IGNORE INTO user_facts (user_id, scope, fact, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, scope, fact, now);
  database()
    .prepare(
      `DELETE FROM user_facts WHERE user_id = ? AND scope = ? AND fact NOT IN (
         SELECT fact FROM user_facts WHERE user_id = ? AND scope = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?
       )`
    )
    .run(userId, scope, userId, scope, MAX_FACTS_PER_PERSON);
}

// Newest first.
export function getFacts(userId, scope, limit = MAX_FACTS_PER_PERSON) {
  return database()
    .prepare(
      `SELECT fact FROM user_facts WHERE user_id = ? AND scope = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(userId, scope, limit)
    .map(row => row.fact);
}

// Everything held on a person, in every server and DM, for /memory show.
export function getAllFacts(userId) {
  return database()
    .prepare('SELECT scope, fact FROM user_facts WHERE user_id = ? ORDER BY scope, created_at DESC')
    .all(userId);
}

// Returns how many facts were deleted.
export function forgetFacts(userId) {
  return Number(database().prepare('DELETE FROM user_facts WHERE user_id = ?').run(userId).changes);
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

// Whether a reminder is still waiting: it isn't once it's been sent or cancelled.
export function hasReminder(id) {
  return Boolean(database().prepare('SELECT 1 FROM reminders WHERE id = ?').get(id));
}

export function getRemindersFor(userId) {
  return getReminders().filter(reminder => reminder.userId === userId);
}

export function deleteReminder(id) {
  database().prepare('DELETE FROM reminders WHERE id = ?').run(id);
}

// How much is stored, for /status.
export function counts() {
  const count = table => database().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { conversations: count('channel_state'), facts: count('user_facts'), reminders: count('reminders') };
}

// Only theirs: anyone can try any number. Returns whether there was one to delete.
export function deleteReminderFor(userId, id) {
  return database().prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}
