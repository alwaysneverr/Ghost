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

// Hard limit on reply length, roughly 65 words. Prompt rules alone didn't stop
// the model writing essays when asked. Thinking uses up the same budget, so the
// limit only applies with thinking off.
const OLLAMA_MAX_REPLY_TOKENS = Number(process.env.OLLAMA_MAX_REPLY_TOKENS || 90);

// A reply cut off at the limit would end mid-sentence, so end it at the last
// complete one. Left alone if it has none.
function trimToLastSentence(text) {
  return text.match(/^[\s\S]*[.!?…]["”']?(?=\s|$)/)?.[0] ?? text;
}

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
      options: {
        num_ctx: OLLAMA_NUM_CTX,
        ...(OLLAMA_THINK ? {} : { num_predict: OLLAMA_MAX_REPLY_TOKENS }),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.message?.content?.trim();

  if (!reply) throw new Error('Empty response from Ollama');
  return data.done_reason === 'length' ? trimToLastSentence(reply) : reply;
}
