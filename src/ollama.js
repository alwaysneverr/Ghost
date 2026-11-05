/**
 * What every request to Ollama shares, and the embedding call. Used by the chat code
 * (llm.js), retrieval (rag.js) and the habit check (similarity.js), which can't import
 * each other without going round in a circle.
 */

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';

// How long Ollama keeps a model loaded after a request. Its own default is 5 minutes,
// and loading it again made the first reply after a quiet spell take about 9 seconds
// instead of 2-3. A duration like "30m", seconds as a number, "-1" to keep it until
// Ollama stops, or "0" to unload it straight away.
const keepAlive = process.env.OLLAMA_KEEP_ALIVE || '1h';
export const OLLAMA_KEEP_ALIVE = /^-?\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive;

// How long one request may take, reading the reply included, before she gives up on it.
// Without a limit, a PC that's asleep or a model stuck loading left people looking at
// "typing…" for minutes. Loading the model at startup gets longer (WARM_UP_TIMEOUT_MS).
export const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 60_000);
export const WARM_UP_TIMEOUT_MS = 5 * 60_000;

// Ollama itself didn't answer: unreachable, too slow, or an error status. Anything else
// thrown on the way is a bug in her, not an outage.
export class OllamaError extends Error {
  name = 'OllamaError';
}

const timedOut = (error) => error?.name === 'TimeoutError' || error?.name === 'AbortError';

// Turns a timeout while the reply is still being read into an OllamaError too.
export function asOllamaError(error, timeoutMs = OLLAMA_TIMEOUT_MS) {
  if (error instanceof OllamaError || !timedOut(error)) return error;
  return new OllamaError(`no answer in ${Math.round(timeoutMs / 1000)}s`, { cause: error });
}

// A POST to Ollama with a time limit. The limit also covers reading the body, so callers
// read it inside try/catch and pass what's thrown through asOllamaError.
export async function ollamaPost(path, body, timeoutMs = OLLAMA_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (timedOut(error)) throw asOllamaError(error, timeoutMs);
    const why = error.cause?.code ?? error.message;
    throw new OllamaError(`can't reach Ollama at ${OLLAMA_URL} (${why})`, { cause: error });
  }
  if (!res.ok) throw new OllamaError(`Ollama returned HTTP ${res.status}`);
  return res;
}

// One vector per text, in the same order. Also used by scripts/parse-and-index.js
// so indexing and querying always embed the same way.
export async function embedBatch(texts) {
  const res = await ollamaPost('/api/embed', {
    model: EMBED_MODEL,
    input: texts,
    keep_alive: OLLAMA_KEEP_ALIVE,
  });
  try {
    return (await res.json()).embeddings;
  } catch (error) {
    throw asOllamaError(error);
  }
}

export function cosineSimilarity(a, b) {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
