const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const levelValue = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info;

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
