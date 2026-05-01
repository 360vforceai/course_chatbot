/**
 * src/utils/messageUtils.js
 *
 * Helpers for formatting messages before sending them to Discord.
 */

// Discord's hard message limit is 2000 characters. Use 1900 to leave room for
// formatting and avoid edge-case failures.
const MAX_CHUNK_SIZE = 1900;

/**
 * Split a long response into Discord-safe chunks.
 *
 * Strategy:
 * 1. Trim blank space.
 * 2. If short enough, return one chunk.
 * 3. Otherwise split near MAX_CHUNK_SIZE.
 * 4. Prefer splitting at a newline.
 * 5. If no newline exists, split at a space.
 * 6. If even that fails, hard split at MAX_CHUNK_SIZE.
 */
function splitMessage(text) {
  if (!text || typeof text !== 'string') return [];

  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHUNK_SIZE) return [trimmed];

  const chunks = [];
  let remaining = trimmed;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_SIZE) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', MAX_CHUNK_SIZE);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf(' ', MAX_CHUNK_SIZE);
    if (splitIndex <= 0) splitIndex = MAX_CHUNK_SIZE;

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks.filter(Boolean);
}

module.exports = {
  splitMessage,
  MAX_CHUNK_SIZE
};
