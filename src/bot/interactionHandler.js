/**
 * src/bot/interactionHandler.js
 *
 * This file owns the Discord interaction lifecycle for the `/ask` command.
 *
 * Important boundary:
 * - This file should know about Discord interactions.
 * - This file should NOT contain course requirement data.
 * - This file should NOT directly call OpenAI SDK methods.
 *
 * Flow for one /ask request:
 * 1. Discord sends an interaction.
 * 2. We ignore anything that is not `/ask`.
 * 3. We deduplicate the interaction so Discord replay events do not double-run.
 * 4. We rate-limit the user.
 * 5. We defer the reply so Discord does not think the bot timed out.
 * 6. We load short-term history.
 * 7. We build course context from the seed course layer.
 * 8. We call the LLM adapter.
 * 9. We save the conversation turn.
 * 10. We split long responses and send them back to Discord.
 */

const { isRateLimited, recordRequest, getRemainingSeconds } = require('../utils/rateLimiter');
const { splitMessage } = require('../utils/messageUtils');
const { getResponse } = require('../agents/aiClient');
const { buildCourseContext } = require('../agents/courseClient');
const { getShortTermHistory, saveMemoryAsync } = require('../utils/memoryService');
const logger = require('../utils/logger');

/**
 * Discord can sometimes replay interaction events after reconnects.
 *
 * Without this set, the bot could answer the same `/ask` command twice, which
 * would waste API calls and create duplicate messages. We store interaction IDs
 * that have already been handled.
 */
const handledInteractions = new Set();

/**
 * Clear the deduplication set periodically.
 *
 * This is a lightweight memory safety guard. Interaction IDs only need to be
 * remembered for a short period, because Discord interaction tokens expire.
 */
setInterval(() => {
  if (handledInteractions.size > 500) handledInteractions.clear();
}, 10 * 60 * 1000);

/**
 * Reply helper that works whether the interaction has already been deferred or
 * not.
 *
 * Discord has two different response paths:
 * - interaction.reply(...) if no response has been started yet
 * - interaction.editReply(...) after deferReply() has been called
 *
 * This helper prevents duplicated try/catch blocks in simple error paths.
 */
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

/**
 * Handle the actual business logic for `/ask`.
 *
 * This function assumes the command is already validated and rate-limited by
 * handleInteraction(). Its job is to convert a user question into an answer.
 */
async function handleAsk(interaction, userId, username) {
  // Slash command option defined in register-commands.js.
  const question = interaction.options.getString('question');

  if (!question || !question.trim()) {
    await safelyReply(interaction, {
      content: 'Please provide a course planning question.',
      ephemeral: true
    });
    return;
  }

  const trimmedQuestion = question.trim();

  /**
   * Load recent conversation history.
   *
   * This lets the bot handle follow-ups like:
   * - "what about if I want AI?"
   * - "what should I take after that?"
   *
   * The memory service uses Supabase if configured. Otherwise it falls back to
   * an in-memory store that resets when the process restarts.
   */
  const shortTermHistory = await getShortTermHistory(userId);

  /**
   * Build retrieved course context.
   *
   * For this redesign branch, buildCourseContext() pulls from static seed data.
   * Later this can be replaced or expanded with WebReg/catalog/RAG retrieval.
   */
  const courseContext = buildCourseContext(trimmedQuestion);

  // The OpenAI adapter expects standard chat messages.
  const messages = [...shortTermHistory, { role: 'user', content: trimmedQuestion }];

  // Generate the answer using the LLM adapter and the retrieved course context.
  const { content } = await getResponse(messages, { courseContext });

  /**
   * Save the conversation.
   *
   * The final parameter is questionEmbedding. This redesign branch does not
   * generate an embedding for the question in this path, so we pass null. The
   * memory service still saves short-term history and falls back safely if
   * Supabase is not configured.
   */
  saveMemoryAsync(userId, username, trimmedQuestion, content, null);

  /**
   * Discord messages have a hard character limit. splitMessage() keeps each
   * chunk below a safe threshold so long LLM responses do not fail to send.
   */
  const chunks = splitMessage(content);

  if (!chunks.length) {
    await safelyReply(interaction, 'I could not generate a response. Please try again.');
    return;
  }

  // Because handleInteraction() already called deferReply(), the first visible
  // response must use editReply().
  await interaction.editReply(chunks[0]).catch((err) => {
    logger.error('Edit reply failed:', err.message);
  });

  // If the answer is longer than one Discord message, send the rest as follow-up
  // messages in the same interaction thread.
  for (let i = 1; i < chunks.length; i += 1) {
    await interaction.followUp({ content: chunks[i] }).catch((err) => {
      logger.error('Follow-up failed:', err.message);
    });
  }

  logger.info('Handled /ask', {
    userId,
    username,
    questionLength: trimmedQuestion.length
  });
}

/**
 * Main exported Discord interaction router.
 *
 * index.js calls this every time Discord emits an interactionCreate event.
 * This function filters the interaction down to the one command this bot
 * currently supports: `/ask`.
 */
async function handleInteraction(interaction) {
  // Ignore button clicks, dropdowns, modals, autocomplete, etc.
  if (!interaction.isChatInputCommand()) return;

  // This bot only handles the /ask command for now.
  if (interaction.commandName !== 'ask') return;

  const userId = interaction.user.id;
  const username = interaction.user.username;

  logger.info('Interaction received', {
    userId,
    command: interaction.commandName,
    id: interaction.id
  });

  // Deduplication guard. If Discord sends the same interaction twice, skip the
  // second copy.
  if (handledInteractions.has(interaction.id)) {
    logger.warn('Duplicate interaction skipped', { id: interaction.id });
    return;
  }

  handledInteractions.add(interaction.id);

  // Per-user cooldown. This protects the OpenAI API from spam and makes local
  // testing safer.
  if (isRateLimited(userId)) {
    const remaining = getRemainingSeconds(userId);

    await interaction.reply({
      content: `Please wait ${remaining} second(s) before asking again.`,
      ephemeral: true
    }).catch((err) => logger.error('Rate-limit reply failed:', err.message));

    return;
  }

  // Store the timestamp for rate limiting after confirming the user is allowed
  // to proceed.
  recordRequest(userId);

  try {
    /**
     * deferReply() tells Discord: "the bot received the command and is working."
     *
     * Discord requires bots to acknowledge interactions quickly. OpenAI calls can
     * take longer than that, so defer first, then edit the deferred reply later.
     */
    await interaction.deferReply();
  } catch (err) {
    logger.error('Defer failed:', err.message);
    return;
  }

  try {
    await handleAsk(interaction, userId, username);
  } catch (err) {
    // Catch any unhandled error so the user gets a clean failure message instead
    // of the bot silently crashing or leaving the interaction pending.
    logger.error('Interaction handler error:', err.stack || err.message);

    await interaction.editReply('Sorry, something went wrong. Please try again later.').catch((editErr) => {
      logger.error('Fallback edit failed:', editErr.message);
    });
  }
}

module.exports = {
  handleInteraction
};
