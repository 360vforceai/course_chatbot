/**
 * src/utils/logger.js
 *
 * Minimal logger used across the bot.
 *
 * Why not console.log everywhere?
 * - Consistent timestamp format
 * - Easy LOG_LEVEL filtering through .env
 * - Same interface for debug/info/warn/error
 */

// Lower number means more verbose.
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// Default to info if LOG_LEVEL is missing or invalid.
const currentLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const levelValue = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;

/**
 * Prefix every log with ISO timestamp and uppercase level.
 *
 * Return an array because console.log accepts multiple arguments. This lets us
 * preserve objects as objects in logs instead of stringifying everything.
 */
function formatMessage(level, ...args) {
  return [`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args];
}

module.exports = {
  debug(...args) {
    if (levelValue <= LOG_LEVELS.debug) console.log(...formatMessage('debug', ...args));
  },

  info(...args) {
    if (levelValue <= LOG_LEVELS.info) console.log(...formatMessage('info', ...args));
  },

  warn(...args) {
    if (levelValue <= LOG_LEVELS.warn) console.warn(...formatMessage('warn', ...args));
  },

  error(...args) {
    if (levelValue <= LOG_LEVELS.error) console.error(...formatMessage('error', ...args));
  }
};
