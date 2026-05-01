/**
 * src/utils/rateLimiter.js
 *
 * Simple per-user cooldown.
 *
 * This prevents one Discord user from spamming `/ask` and creating many OpenAI
 * calls. It is intentionally in-memory for the MVP. In a multi-process or
 * serverless deployment, this should become a shared store like Redis.
 */

// Default cooldown is 5 seconds, but .env can override it.
const COOLDOWN_MS = Number(process.env.REQUEST_COOLDOWN_MS || 5000);

// Map shape:
//   userId -> timestamp of last accepted request
const userCooldowns = new Map();

/**
 * Return true if the user is still inside their cooldown window.
 */
function isRateLimited(userId) {
  const lastRequest = userCooldowns.get(userId);
  if (!lastRequest) return false;

  return Date.now() - lastRequest < COOLDOWN_MS;
}

/**
 * Mark the current time as the user's latest accepted request.
 */
function recordRequest(userId) {
  userCooldowns.set(userId, Date.now());
}

/**
 * Return the remaining cooldown time in seconds for user-facing messages.
 */
function getRemainingSeconds(userId) {
  const lastRequest = userCooldowns.get(userId);
  if (!lastRequest) return 0;

  const elapsed = Date.now() - lastRequest;
  return Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000));
}

module.exports = {
  isRateLimited,
  recordRequest,
  getRemainingSeconds,
  COOLDOWN_MS
};
