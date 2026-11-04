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

// One vector per text, in the same order. Also used by scripts/parse-and-index.js
// so indexing and querying always embed the same way.
export async function embedBatch(texts) {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, keep_alive: OLLAMA_KEEP_ALIVE }),
  });
  if (!res.ok) throw new Error(`Embedding request failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.embeddings;
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
