/**
 * Shows a reply as it's written, by sending it early and editing it as text comes
 * in. Discord rate-limits edits, so most tokens are never shown: the last edit is
 * what matters, and finish() always makes it.
 */

const REPLY_LIMIT = 2000; // Discord's message length limit
const EDIT_INTERVAL_MS = 1200;
const MIN_FIRST_CHARS = 20; // a single word on its own looks like a glitch

export function createStreamer(message) {
  let sent = null;
  let shown = '';
  let lastUpdate = 0;
  let inFlight = null;

  function show(text) {
    const trimmed = text.slice(0, REPLY_LIMIT);
    lastUpdate = Date.now();
    shown = trimmed;
    inFlight = (sent ? sent.edit(trimmed) : message.reply(trimmed))
      .then(result => {
        sent ??= result;
      })
      .catch(error => console.warn('⚠️  Could not update the streamed reply:', error.message))
      .finally(() => {
        inFlight = null;
      });
  }

  return {
    update(text) {
      if (inFlight || text.length < MIN_FIRST_CHARS) return;
      if (Date.now() - lastUpdate >= EDIT_INTERVAL_MS) show(text);
    },

    // Sends the finished reply and returns its message.
    async finish(text) {
      await inFlight;
      if (!sent) return message.reply(text.slice(0, REPLY_LIMIT));
      if (shown !== text.slice(0, REPLY_LIMIT)) {
        // A rejected edit only costs the last few words, so it isn't a failed reply.
        await sent.edit(text.slice(0, REPLY_LIMIT)).catch(error => {
          console.warn('⚠️  Could not finish the streamed reply:', error.message);
        });
      }
      return sent;
    },

    // Generation failed partway: don't leave half a sentence behind.
    async abort() {
      await inFlight;
      await sent?.delete().catch(() => {});
    },
  };
}
