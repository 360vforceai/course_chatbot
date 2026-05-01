const MAX_CHUNK_SIZE = 1900;

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
