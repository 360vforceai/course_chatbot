const { isRateLimited, recordRequest, getRemainingSeconds } = require('../utils/rateLimiter');
const { splitMessage } = require('../utils/messageUtils');
const { getResponse, getRouterDecision } = require('../agents/aiClient');
const {
  getShortTermHistory,
  searchLongTermMemories,
  saveMemoryAsync
} = require('../utils/memoryService');
const {
  searchCourseCatalog,
  formatCourseCatalogContext,
  searchDegreeRequirements,
  formatDegreeRequirementsContext,
  searchWebReg,
  formatWebRegContext,
  searchRoadmaps,
  formatRoadmapContext
} = require('../agents/courseClient');
const logger = require('../utils/logger');

// Prevent Discord Gateway from replaying the same interaction, thereby avoiding duplicate processing.
const handledInteractions = new Map();

// Periodically purge old IDs that are more than 10 minutes old (interaction tokens have a 15-minute validity period).
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const [interactionId, timestamp] of handledInteractions.entries()) {
    if (timestamp < cutoff) {
      handledInteractions.delete(interactionId);
    }
  }
}, 10 * 60 * 1000);

async function handleAsk(interaction, userId, username) {
  const question = interaction.options.getString('question');

  if (!question) {
    await interaction.reply({
      content: 'Please provide a course question.',
      ephemeral: true
    }).catch((err) => logger.error('Reply failed:', err.message));
    return;
  }

  // Step 1: Serial — First retrieve historical data, then allow the Routing Agent to make a decision.
  const shortTermHistory = await getShortTermHistory(userId);
  const { tables, keywords } = await getRouterDecision(shortTermHistory, question);

  logger.info('Router decision applied', { userId, tables, keywords });

  // Step 2: Concurrent — Based on the routing results, select which tables to search, using keywords as the unified input for retrieval across all sources.
  const [
    { memories, embedding },
    courseCatalogResults,
    degreeRequirementResults,
    webregResults,
    roadmapResults
  ] = await Promise.all([
    tables.includes('community_memory')
      ? searchLongTermMemories(keywords)
      : Promise.resolve({ memories: [], embedding: null }),

    tables.includes('course_catalog')
      ? searchCourseCatalog(keywords)
      : Promise.resolve([]),

    tables.includes('degree_requirements')
      ? searchDegreeRequirements(keywords)
      : Promise.resolve([]),

    tables.includes('webreg')
      ? searchWebReg(keywords)
      : Promise.resolve([]),

    tables.includes('roadmaps')
      ? searchRoadmaps(keywords)
      : Promise.resolve([])
  ]);

  // Step 3: Format the context.
  const ragContext = memories.length > 0
    ? memories.map((memory) => {
        const name = memory.metadata?.username || `user ID ${memory.user_id}`;
        return `Discord user "@${name}" previously said: "${memory.content}"`;
      }).join('\n')
    : null;

  const courseCatalogContext = formatCourseCatalogContext(courseCatalogResults);
  const degreeRequirementsContext = formatDegreeRequirementsContext(degreeRequirementResults);
  const webregContext = formatWebRegContext(webregResults);
  const roadmapContext = formatRoadmapContext(roadmapResults);

  if (ragContext) logger.info('RAG injected community memory', { userId, count: memories.length });
  if (courseCatalogContext) logger.info('RAG injected course catalog results', { userId, count: courseCatalogResults.length });
  if (degreeRequirementsContext) logger.info('RAG injected degree requirement results', { userId, count: degreeRequirementResults.length });
  if (webregContext) logger.info('RAG injected WebReg results', { userId, count: webregResults.length });
  if (roadmapContext) logger.info('RAG injected roadmap results', { userId, count: roadmapResults.length });

  // Step 4: Construct the message sequence, passing in the keywords to allow `getResponse` to inject the relevant context paragraphs.
  const messages = [...shortTermHistory, { role: 'user', content: question }];

  const { content } = await getResponse(messages, {
    ragContext,
    courseCatalogContext,
    degreeRequirementsContext,
    webregContext,
    roadmapContext,
    keywords
  });

  saveMemoryAsync(userId, username, question, content, embedding);

  const chunks = splitMessage(content);

  if (chunks.length === 0) {
    await interaction
      .editReply('I could not generate a response. Please try again.')
      .catch((err) => logger.error('Edit reply failed:', err.message));
    return;
  }

  await interaction
    .editReply(chunks[0])
    .catch((err) => logger.error('Edit reply failed:', err.message));

  for (let i = 1; i < chunks.length; i += 1) {
    await interaction
      .followUp({ content: chunks[i] })
      .catch((err) => logger.error('Follow-up failed:', err.message));
  }

  logger.info('Handled /ask', { userId, username, questionLength: question.length });
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName !== 'ask') return;

  const userId = interaction.user.id;
  const username = interaction.user.username;

  logger.info('Interaction received', {
    userId,
    command: interaction.commandName,
    id: interaction.id
  });

  // Deduplication: Ensure that the same interaction is not processed more than once (as the Gateway may replay events upon reconnection).
  if (handledInteractions.has(interaction.id)) {
    logger.warn('Duplicate interaction skipped', { id: interaction.id });
    return;
  }

  handledInteractions.set(interaction.id, Date.now());

  if (isRateLimited(userId)) {
    const remaining = getRemainingSeconds(userId);

    await interaction.reply({
      content: `Please wait ${remaining} second(s) before asking again.`,
      ephemeral: true
    }).catch((err) => logger.error('Reply failed:', err.message));

    return;
  }

  recordRequest(userId);

  try {
    await interaction.deferReply();
  } catch (err) {
    logger.error('Defer failed (interaction expired or already handled):', err.message);
    return;
  }

  try {
    await handleAsk(interaction, userId, username);
  } catch (err) {
    logger.error('Interaction handler error:', err.message);

    await interaction
      .editReply('Sorry, something went wrong. Please try again later.')
      .catch((editErr) => {
        logger.error('Fallback edit failed:', editErr.message);
      });
  }
}

module.exports = {
  handleInteraction
};