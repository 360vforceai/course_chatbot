/**
 * src/utils/conversationStore.js
 *
 * Tiny in-memory conversation store.
 *
 * This is used when Supabase is not configured. It lets the bot remember a few
 * recent turns during local development without requiring a database.
 *
 * Important limitation:
 * This memory disappears whenever the Node process restarts. That is fine for an
 * MVP fallback, but real deployments should use Supabase/DynamoDB/Postgres/etc.
 */

// Keep only the latest 20 messages per user so memory does not grow forever.
const MAX_MESSAGES = 20;

// Map shape:
//   userId -> [{ role: 'user' | 'assistant', content: string }, ...]
const store = new Map();

/**
 * Return a copy of one user's conversation history.
 *
 * Returning a copy prevents callers from accidentally mutating the internal Map
 * array directly.
 */
function getHistory(userId) {
  const history = store.get(userId);
  return history ? [...history] : [];
}

/**
 * Save a user's history after trimming it to MAX_MESSAGES.
 */
function saveHistory(userId, messages) {
  const trimmed = messages.slice(-MAX_MESSAGES);
  store.set(userId, trimmed);
}

/**
 * Append one complete user/assistant turn.
 *
 * This is the main method memoryService.js uses for the no-database fallback.
 */
function appendTurn(userId, question, answer) {
  const history = getHistory(userId);

  history.push({ role: 'user', content: question });
  history.push({ role: 'assistant', content: answer });

  saveHistory(userId, history);
}

module.exports = {
  MAX_MESSAGES,
  getHistory,
  saveHistory,
  appendTurn
};
