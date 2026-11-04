/**
 * Everything /status reports, gathered in one go. Each part fails on its own, so one
 * broken piece, usually Ollama not running, still leaves the rest readable.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EMBED_MODEL, OLLAMA_KEEP_ALIVE, OLLAMA_URL } from './ollama.js';
import { LOG_FILES, MESSAGE_LOG_DAYS } from './logger.js';
import { REPLY_CHECK } from './llm.js';
import { sceneCounts } from './rag.js';
import { counts } from './store.js';

const CHAT_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
// Long enough for a slow machine, short of Discord's 15 minutes by a wide margin.
const OLLAMA_TIMEOUT_MS = 3000;
const VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8')
).version;

// Ollama calls "bge-m3" "bge-m3:latest".
const fullName = (name) => (name.includes(':') ? name : `${name}:latest`);

async function ollama(path) {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function ollamaStatus() {
  try {
    const [{ version }, { models: installed }, { models: loaded }] = await Promise.all([
      ollama('/api/version'),
      ollama('/api/tags'),
      ollama('/api/ps'),
    ]);
    const model = (name) => {
      const running = loaded.find((m) => m.name === fullName(name));
      return {
        name,
        installed: installed.some((m) => m.name === fullName(name)),
        loaded: Boolean(running),
        gpuBytes: running?.size_vram ?? 0,
        context: running?.context_length ?? null,
        unloadsAt: running ? Date.parse(running.expires_at) : null,
      };
    };
    return { reachable: true, version, models: [model(CHAT_MODEL), model(EMBED_MODEL)] };
  } catch (error) {
    return {
      reachable: false,
      error: error.name === 'TimeoutError' ? 'no answer in 3 seconds' : error.message,
    };
  }
}

function safely(read) {
  try {
    return read();
  } catch (error) {
    return { error: error.message };
  }
}

export async function gatherStatus(client) {
  return {
    ollama: await ollamaStatus(),
    url: OLLAMA_URL,
    keepAlive: OLLAMA_KEEP_ALIVE,
    discord: {
      servers: client.guilds.cache.size,
      pingMs: Math.round(client.ws.ping),
      uptimeMs: client.uptime,
    },
    scenes: safely(sceneCounts),
    stored: safely(counts),
    logs: LOG_FILES.map((path) => ({
      name: basename(path),
      bytes: existsSync(path) ? statSync(path).size : 0,
    })),
    messageLogDays: MESSAGE_LOG_DAYS,
    replyCheck: REPLY_CHECK,
    process: { node: process.version, version: VERSION, memoryBytes: process.memoryUsage().rss },
  };
}
