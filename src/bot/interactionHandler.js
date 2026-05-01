const { isRateLimited, recordRequest, getRemainingSeconds } = require('../utils/rateLimiter');
const { splitMessage } = require('../utils/messageUtils');
const { getResponse } = require('../agents/aiClient');
const { buildCourseContext } = require('../agents/courseClient');
const { getShortTermHistory, saveMemoryAsync } = require('../utils/memoryService');
const logger = require('../utils/logger');

const handledInteractions = new Set();

setInterval(() => {
  if (handledInteractions.size > 500) handledInteractions.clear();
}, 10 * 60 * 1000);

async function safelyReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (err) {
    logger.error('Discord reply failed:', err.message);
    return null;
  }
}

async function handleAsk(interaction, userId, username) {
  const question = interaction.options.getString('question');

  if (!question || !question.trim()) {
    await safelyReply(interaction, {
      content: 'Please provide a course planning question.',
      ephemeral: true
    });
    return;
  }

  const trimmedQuestion = question.trim();
  const shortTermHistory = await getShortTermHistory(userId);
  const courseContext = buildCourseContext(trimmedQuestion);
  const messages = [...shortTermHistory, { role: 'user', content: trimmedQuestion }];

  const { content } = await getResponse(messages, { courseContext });

  saveMemoryAsync(userId, username, trimmedQuestion, content, null);

  const chunks = splitMessage(content);
  if (!chunks.length) {
    await safelyReply(interaction, 'I could not generate a response. Please try again.');
    return;
  }

  await interaction.editReply(chunks[0]).catch((err) => logger.error('Edit reply failed:', err.message));

  for (let i = 1; i < chunks.length; i += 1) {
    await interaction.followUp({ content: chunks[i] }).catch((err) => logger.error('Follow-up failed:', err.message));
  }

  logger.info('Handled /ask', { userId, username, questionLength: trimmedQuestion.length });
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'ask') return;

  const userId = interaction.user.id;
  const username = interaction.user.username;

  logger.info('Interaction received', { userId, command: interaction.commandName, id: interaction.id });

  if (handledInteractions.has(interaction.id)) {
    logger.warn('Duplicate interaction skipped', { id: interaction.id });
    return;
  }
  handledInteractions.add(interaction.id);

  if (isRateLimited(userId)) {
    const remaining = getRemainingSeconds(userId);
    await interaction.reply({
      content: `Please wait ${remaining} second(s) before asking again.`,
      ephemeral: true
    }).catch((err) => logger.error('Rate-limit reply failed:', err.message));
    return;
  }

  recordRequest(userId);

  try {
    await interaction.deferReply();
  } catch (err) {
    logger.error('Defer failed:', err.message);
    return;
  }

  try {
    await handleAsk(interaction, userId, username);
  } catch (err) {
    logger.error('Interaction handler error:', err.stack || err.message);
    await interaction.editReply('Sorry, something went wrong. Please try again later.').catch((editErr) => {
      logger.error('Fallback edit failed:', editErr.message);
    });
  }
}

module.exports = {
  handleInteraction
};
