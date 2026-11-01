/**
 * Optional second pass over retrieved scenes: a cross-encoder reads the message and
 * each scene together, which is more accurate than comparing embeddings but too slow
 * to run over every scene. Ollama has no rerank endpoint, so this runs on the CPU
 * through Transformers.js, an optional dependency loaded only if RAG_RERANK=true.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', 'data', 'models');
const RERANK_MODEL = 'onnx-community/bge-reranker-v2-m3-ONNX';
const MAX_TOKENS = 512;

let loading = null;

// Loaded once, the first time it's needed. Not cached if it fails, so the next
// message tries again.
function loadModel() {
  loading ??= (async () => {
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import(
      '@huggingface/transformers'
    );
    env.cacheDir = CACHE_DIR;
    return {
      tokenizer: await AutoTokenizer.from_pretrained(RERANK_MODEL),
      model: await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: 'q8' }),
    };
  })().catch(error => {
    loading = null;
    throw error;
  });
  return loading;
}

// Returns one relevance score per text, in the same order. Higher is more relevant.
export async function rerank(query, texts) {
  const { tokenizer, model } = await loadModel();
  const inputs = tokenizer(
    texts.map(() => query),
    { text_pair: texts, padding: true, truncation: true, max_length: MAX_TOKENS }
  );
  const { logits } = await model(inputs);
  return Array.from(logits.data, Number);
}
