const COOLDOWN_MS = Number(process.env.REQUEST_COOLDOWN_MS || 5000);
const userCooldowns = new Map();

function isRateLimited(userId) {
  const lastRequest = userCooldowns.get(userId);
  if (!lastRequest) return false;
  return Date.now() - lastRequest < COOLDOWN_MS;
}

function recordRequest(userId) {
  userCooldowns.set(userId, Date.now());
}

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
