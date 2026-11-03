/**
 * The script scenes and their embeddings, in a SQLite file of their own: it can be
 * rebuilt at any time, unlike what's in data/ghost.db. Search itself stays in plain
 * JS in rag.js. Measured against sqlite-vec, which is also brute force at this size,
 * this searched 3-18x faster and needs no native extension. Worth revisiting at
 * something like 100,000 scenes, not before.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCENE_INDEX_PATH = process.env.RAG_INDEX_PATH || join(__dirname, '..', 'data', 'index.db');

function toBlob(embedding) {
  const floats = Float32Array.from(embedding);
  return new Uint8Array(floats.buffer);
}

// The slice makes a copy: Float32Array needs its own aligned buffer.
function fromBlob(blob) {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

function open() {
  mkdirSync(dirname(SCENE_INDEX_PATH), { recursive: true });
  const db = new DatabaseSync(SCENE_INDEX_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      file       TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end   INTEGER NOT NULL,
      text       TEXT NOT NULL,
      embedding  BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

// Everything in the index, and the model it was embedded with. Null if there's no
// index yet.
export function readSceneIndex() {
  if (!existsSync(SCENE_INDEX_PATH)) return null;
  const db = open();
  const scenes = db
    .prepare('SELECT * FROM scenes ORDER BY rowid')
    .all()
    .map(row => ({
      file: row.file,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      text: row.text,
      embedding: fromBlob(row.embedding),
    }));
  const model = db.prepare("SELECT value FROM meta WHERE key = 'model'").get()?.value ?? null;
  db.close();
  return { scenes, model };
}

// Replaces the whole index in one transaction, so a failed run leaves the old one.
export function writeSceneIndex(scenes, model) {
  const db = open();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM scenes');
    const insert = db.prepare(
      'INSERT INTO scenes (file, line_start, line_end, text, embedding) VALUES (?, ?, ?, ?, ?)'
    );
    for (const scene of scenes) {
      insert.run(scene.file, scene.lineStart, scene.lineEnd, scene.text, toBlob(scene.embedding));
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('model', ?)").run(model);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
