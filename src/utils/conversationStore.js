const MAX_MESSAGES = 20;
const store = new Map();

function getHistory(userId) {
  const history = store.get(userId);
  return history ? [...history] : [];
}

function saveHistory(userId, messages) {
  const trimmed = messages.slice(-MAX_MESSAGES);
  store.set(userId, trimmed);
}

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
