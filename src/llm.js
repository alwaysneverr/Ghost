/**
 * One place that talks to Ollama's chat endpoint — used by the bot
 * (messageCreate.js) and scripts/eval-prompts.js.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

// Qwen3 "thinks" before answering unless told not to — slow, and pointless
// for casual chat. OLLAMA_THINK=true turns it back on.
const OLLAMA_THINK = process.env.OLLAMA_THINK === 'true';

// Room for the persona + script references + history, with headroom to raise
// RAG_TOP_K or MAX_HISTORY. Ollama's default is small enough that it would
// silently drop content. 16384 uses about 7.5 GB of VRAM on qwen3:8b.
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 16384);

// messages: [{ role: 'system' | 'user' | 'assistant', content }]
export async function chat(messages, model = OLLAMA_MODEL) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      think: OLLAMA_THINK,
      options: { num_ctx: OLLAMA_NUM_CTX },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.message?.content?.trim();

  if (!reply) throw new Error('Empty response from Ollama');
  return reply;
}
