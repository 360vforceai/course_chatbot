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
  formatRoadmapContext,
  getMajorImage,
  findOccupation
} = require('../agents/courseClient');
const logger = require('../utils/logger');

// Prevent Discord Gateway from replaying the same interaction, avoiding duplicate processing.
const handledInteractions = new Map();

// Periodically purge IDs older than 10 minutes (interaction tokens expire after 15 min).
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, timestamp] of handledInteractions.entries()) {
    if (timestamp < cutoff) handledInteractions.delete(id);
  }
}, 10 * 60 * 1000);

//Shared helper: send chunks back to Discord

async function sendChunks(interaction, content) {
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
  for (let i = 1; i < chunks.length; i++) {
    await interaction
      .followUp({ content: chunks[i] })
      .catch((err) => logger.error('Follow-up failed:', err.message));
  }
}

//Shared helper: run RAG + getResponse for a question string 

async function runAdvisor(userId, username, question) {
  // Step 1: get history, then let router decide which tables + keywords to use
  const shortTermHistory = await getShortTermHistory(userId);
  const { tables, keywords } = await getRouterDecision(shortTermHistory, question);

  logger.info('Router decision applied', { userId, tables, keywords });

  // Step 2: concurrent searches across all relevant tables
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

  // Step 3: format results into context strings
  const ragContext = memories.length > 0
    ? memories.map((m) => {
        const name = m.metadata?.username || `user ID ${m.user_id}`;
        return `Discord user "@${name}" previously said: "${m.content}"`;
      }).join('\n')
    : null;

  const courseCatalogContext = formatCourseCatalogContext(courseCatalogResults);
  const degreeRequirementsContext = formatDegreeRequirementsContext(degreeRequirementResults);
  const webregContext = formatWebRegContext(webregResults);
  const roadmapContext = formatRoadmapContext(roadmapResults);

  if (ragContext) logger.info('RAG injected community memory', { userId, count: memories.length });
  if (courseCatalogContext) logger.info('RAG injected course catalog', { userId, count: courseCatalogResults.length });
  if (degreeRequirementsContext) logger.info('RAG injected degree requirements', { userId, count: degreeRequirementResults.length });
  if (webregContext) logger.info('RAG injected webreg', { userId, count: webregResults.length });
  if (roadmapContext) logger.info('RAG injected roadmaps', { userId, count: roadmapResults.length });

  // Step 4: build message list and call the advisor
  const messages = [...shortTermHistory, { role: 'user', content: question }];

  const { content } = await getResponse(messages, {
    ragContext,
    courseCatalogContext,
    degreeRequirementsContext,
    webregContext,
    roadmapContext,
    keywords
  });

  // Save to short-term history in the background — don't block the reply
  saveMemoryAsync(userId, username, question, content, embedding);

  return content;
}

// /ask 
// General course question: routes through the full RAG pipeline.

async function handleAsk(interaction, userId, username) {
  const question = interaction.options.getString('question');
  if (!question) {
    await interaction.reply({ content: 'Please provide a course question.', ephemeral: true })
      .catch((err) => logger.error('Reply failed:', err.message));
    return;
  }

  const content = await runAdvisor(userId, username, question);
  await sendChunks(interaction, content);
  logger.info('Handled /ask', { userId, username, questionLength: question.length });
}

//  /roadmap 
// Generates a personalized semester-by-semester plan.
// Options: completed (required), goal (required), semesters (optional)

async function handleRoadmap(interaction, userId, username) {
  const completed = interaction.options.getString('completed');
  const goal = interaction.options.getString('goal');
  const semesters = interaction.options.getString('semesters') || 'not specified';

  const question =
    `Generate a semester-by-semester course roadmap for a Rutgers CS student. ` +
    `Completed courses: ${completed}. ` +
    `Career goal / track: ${goal}. ` +
    `Semesters remaining: ${semesters}. ` +
    `Account for prereq chains, difficulty balance, and degree requirements.`;

  const content = await runAdvisor(userId, username, question);
  await sendChunks(interaction, content);
  logger.info('Handled /roadmap', { userId, username, goal });
}

//  /search 
// Looks up a specific course by name or code.

async function handleSearch(interaction, userId, username) {
  const course = interaction.options.getString('course');
  if (!course) {
    await interaction.reply({ content: 'Please provide a course name or code.', ephemeral: true })
      .catch((err) => logger.error('Reply failed:', err.message));
    return;
  }

  const question =
    `Look up the course "${course}". ` +
    `Provide the course code, full title, credits, prerequisites, and a description. ` +
    `Also note which degree requirement (core, track, elective) it fulfills if known.`;

  const content = await runAdvisor(userId, username, question);
  await sendChunks(interaction, content);
  logger.info('Handled /search', { userId, username, course });
}

//  /snipe 
// Checks WebReg seat availability for a course.

async function handleSnipe(interaction, userId, username) {
  const course = interaction.options.getString('course');
  if (!course) {
    await interaction.reply({ content: 'Please provide a course code to check.', ephemeral: true })
      .catch((err) => logger.error('Reply failed:', err.message));
    return;
  }

  const question =
    `Check WebReg for current seat availability for "${course}". ` +
    `List all open sections with their index numbers, meeting times, professor, and number of open seats. ` +
    `If no seats are available, explain how course sniping works so the student can register when a seat opens.`;

  const content = await runAdvisor(userId, username, question);
  await sendChunks(interaction, content);
  logger.info('Handled /snipe', { userId, username, course });
}

// /tree
// generates the tree for the user with the desired major
async function handleTree(interaction) {
  const major = interaction.options.getString('major');

  const imageResult = await getMajorImage(major);

  if (!imageResult) {
    await interaction.editReply(`No degree tree found for ${major}.`);
    return;
  }

  await interaction.editReply({
    embeds: [{
      title: imageResult.label,
      image: { url: imageResult.image_url }
    }]
  });
}

// /career
async function handleCareer(interaction, userId, username) {
  const goal = interaction.options.getString('goal');

  const occupation = await findOccupation(goal);

  if (!occupation) {
    await interaction.editReply(
      `I couldn't find a career matching "${goal}" in the Rutgers career database.`
    );
    return;
  }

  const question = `Career Goal: ${occupation.occupation}

  Recommended Rutgers majors:
  ${occupation.recommended_majors}

  Only rank the majors listed above.

  For each major explain:
  - Why it fits
  - Common occupations
  - Salary outlook
  - Recommended minors or double majors

  IMPORTANT:
  Only recommend Rutgers-New Brunswick majors, minors, certificates, or concentrations that actually exist. Do not invent programs.
  `;

  const content = await runAdvisor(
    userId,
    username,
    question)
  ;

  await sendChunks(interaction, content);

  logger.info('Handled /career', {
    userId,
    username,
    goal,
    majors: occupation.recommended_majors
  });


}

//  /help 
// Shows all available commands — no RAG needed, just a static reply.

async function handleHelp(interaction) {
  const helpText = [
    '**Rutgers Academic Course Advisor — Commands**',
    '',
    '`/ask <question>` — Ask anything about courses, prereqs, professors, or degree requirements.',
    '`/roadmap <completed> <goal> [semesters]` — Get a personalized semester-by-semester course plan.',
    '`/search <course>` — Look up a specific course by name or code (e.g. CS 344, "algorithms").',
    '`/snipe <course>` — Check WebReg seat availability and learn how to snipe open seats.',
    '`/career <goal>` — Find the Rutgers majors that best match a career goal.',
    '`/help` — Show this message.',
    '',
    'All advice is based on official Rutgers Course data. Always verify on WebReg before registering.'
  ].join('\n');

  await interaction.editReply(helpText)
    .catch((err) => logger.error('Help reply failed:', err.message));

  logger.info('Handled /help');
}

//  Main dispatcher 

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const validCommands = ['ask', 'roadmap', 'search', 'snipe', 'tree','career','help'];
  if (!validCommands.includes(commandName)) return;

  const userId = interaction.user.id;
  const username = interaction.user.username;

  logger.info('Interaction received', { userId, command: commandName, id: interaction.id });

  // Deduplication: skip if we've already handled this interaction ID
  if (handledInteractions.has(interaction.id)) {
    logger.warn('Duplicate interaction skipped', { id: interaction.id });
    return;
  }
  handledInteractions.set(interaction.id, Date.now());

  // Rate limiting
  if (isRateLimited(userId)) {
    const remaining = getRemainingSeconds(userId);
    await interaction.reply({
      content: `Please wait ${remaining} second(s) before using another command.`,
      ephemeral: true
    }).catch((err) => logger.error('Reply failed:', err.message));
    return;
  }
  recordRequest(userId);

  // Defer the reply so Discord doesn't time out while we fetch data
  try {
    await interaction.deferReply();
  } catch (err) {
    logger.error('Defer failed (interaction expired or already handled):', err.message);
    return;
  }

  try {
    if (commandName === 'ask')     await handleAsk(interaction, userId, username);
    if (commandName === 'roadmap') await handleRoadmap(interaction, userId, username);
    if (commandName === 'search')  await handleSearch(interaction, userId, username);
    if (commandName === 'snipe')   await handleSnipe(interaction, userId, username);
    if (commandName === 'career')  await handleCareer(interaction, userId, username);
    if (commandName === 'help')    await handleHelp(interaction);
    if (interaction.commandName === 'tree') await handleTree(interaction);
  } catch (err) {
    logger.error('Interaction handler error:', err.message);
    await interaction
      .editReply('Sorry, something went wrong. Please try again later.')
      .catch((editErr) => logger.error('Fallback edit failed:', editErr.message));
  }
}

module.exports = { handleInteraction };