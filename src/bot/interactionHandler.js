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
  findOccupation,
  getMajorAutocomplete,
  fetchLiveWebReg,
  fetchRmpForCourse,
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

// Shared helper: send chunks back to Discord 

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

// Shared helper: run RAG + getResponse for a question string 

async function runAdvisor(userId, username, question) {
  const shortTermHistory = await getShortTermHistory(userId);
  const { tables, keywords } = await getRouterDecision(shortTermHistory, question);

  logger.info('Router decision applied', { userId, tables, keywords });

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

  return content;
}

// /ask 

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

async function handleSnipe(interaction, userId, username) {
  const course = interaction.options.getString('course');
  if (!course) {
    await interaction.reply({ content: 'Please provide a course code to check (e.g. `CS 344` or `198:344`).', ephemeral: true })
      .catch(err => logger.error('Reply failed:', err.message));
    return;
  }

  const result = await fetchLiveWebReg(course);

  if (result.type === 'error') {
    await interaction.editReply('⚠️ Could not reach the Rutgers SOC API. Try again in a moment.');
    return;
  }
  if (result.type === 'index_unsupported') {
    await interaction.editReply('Please use a course code like `CS 344` or `198:344` — index lookup isn\'t supported yet.');
    return;
  }
  if (result.type === 'parse_error' || result.type === 'unknown_subject') {
    await interaction.editReply(`Couldn't parse \`${result.input}\`. Try a format like \`CS 344\`, \`198:344\`, or \`MATH 251\`.`);
    return;
  }
  if (result.type === 'not_found') {
    await interaction.editReply(`No course found for \`${result.subjectCode}:${result.courseNum}\` this term. Double-check the course number.`);
    return;
  }

  const { title, courseCode, credits, sections } = result;
  const openSections = sections.filter(s => s.open);
  const closedSections = sections.filter(s => !s.open);
  const displaySections = [...openSections, ...closedSections].slice(0, 25);
  const totalSections = sections.length;
  const shown = displaySections.length;

  const fields = displaySections.map(s => ({
    name: `${s.open ? '🟢' : '🔴'} Index ${s.index} — Section ${s.section}`,
    value: [
      `**Status:** ${s.status}`,
      `**Time:** ${s.meetingTimes}`,
      `**Instructor:** ${s.instructor}`,
    ].join('\n'),
    inline: false,
  }));

  const embed = {
    color: openSections.length > 0 ? 0x57F287 : 0xED4245,
    title: `📋 ${courseCode} — ${title}`,
    description: openSections.length > 0
      ? `**${openSections.length} open section(s)** found.${totalSections > 25 ? ` Showing ${shown}/${totalSections} sections — open sections listed first.` : ''} Register on [WebReg](https://webreg.rutgers.edu) before they fill!`
      : `**No open sections** right now (${totalSections} total).${totalSections > 25 ? ` Showing ${shown}/${totalSections} sections.` : ''}\n\nTo snipe a seat: keep checking WebReg or use a course alert tool.`,
    fields,
    footer: { text: `${credits} credits · Live data from Rutgers SOC` },
    timestamp: new Date().toISOString(),
  };

  await interaction.editReply({ embeds: [embed] });
  logger.info('Handled /snipe', { userId, username, course, openSections: openSections.length });
}

//  /rmp 
// Chains: WebReg (get instructors) → RateMyProfessor (get ratings)

async function handleRmp(interaction, userId, username) {
  const courseInput = interaction.options.getString('course');

  const { webregResult, rmpResults } = await fetchRmpForCourse(courseInput);

  if (webregResult.type === 'error') {
    await interaction.editReply('⚠️ Could not reach the Rutgers SOC API. Try again in a moment.');
    return;
  }
  if (webregResult.type === 'parse_error' || webregResult.type === 'unknown_subject') {
    await interaction.editReply(
      `Couldn't parse \`${webregResult.input}\`. Try a format like \`CS 416\`, \`198:416\`, or \`MATH 251\`.`
    );
    return;
  }
  if (webregResult.type === 'not_found') {
    await interaction.editReply(
      `No course found for \`${courseInput}\` this term. Double-check the course number.`
    );
    return;
  }

  const { title, courseCode } = webregResult;

  if (rmpResults.length === 0) {
    await interaction.editReply(
      `**${courseCode} — ${title}**\n\nNo instructors assigned yet for this term — check back closer to registration.`
    );
    return;
  }

  const fields = rmpResults.map(({ instructor, lastName, rmpData }) => {
    if (!rmpData) {
      return {
        name: `👤 ${instructor}`,
        value: `No RateMyProfessor profile found. Try searching [manually](https://www.ratemyprofessors.com/search/professors/825?q=${encodeURIComponent(lastName)}).`,
        inline: false
      };
    }

    const name = `${rmpData.firstName} ${rmpData.lastName}`;
    const rating = rmpData.avgRating?.toFixed(1) ?? 'N/A';
    const difficulty = rmpData.avgDifficulty?.toFixed(1) ?? 'N/A';
    const wouldTakeAgain = rmpData.wouldTakeAgainPercent >= 0
      ? `${Math.round(rmpData.wouldTakeAgainPercent)}%`
      : 'N/A';
    const numRatings = rmpData.numRatings ?? 0;
    const ratingEmoji = rmpData.avgRating >= 4 ? '🟢' : rmpData.avgRating >= 3 ? '🟡' : '🔴';

    const tags = (rmpData.teacherRatingTags || [])
      .sort((a, b) => b.tagCount - a.tagCount)
      .slice(0, 4)
      .map(t => t.tagName)
      .join(' · ');

    const topComment = (rmpData.ratings?.edges || [])
      .map(e => e.node)
      .find(r => r.comment && r.comment.trim().length > 15);

    const commentLine = topComment
      ? `\n> "${topComment.comment.trim().slice(0, 150)}${topComment.comment.length > 150 ? '...' : ''}"`
      : '';

    const rmpLink = `https://www.ratemyprofessors.com/professor/${rmpData.id.replace('Teacher-', '')}`;

    return {
      name: `${ratingEmoji} ${name} (WebReg: ${instructor})`,
      value: [
        `**Rating:** ${rating}/5 · **Difficulty:** ${difficulty}/5 · **Would Take Again:** ${wouldTakeAgain} *(${numRatings} ratings)*`,
        tags ? `**Tags:** ${tags}` : '',
        commentLine,
        `[View on RMP](${rmpLink})`
      ].filter(Boolean).join('\n'),
      inline: false
    };
  });

  const bestRating = rmpResults
    .filter(r => r.rmpData)
    .reduce((max, r) => Math.max(max, r.rmpData.avgRating || 0), 0);
  const color = bestRating >= 4 ? 0x57F287 : bestRating >= 3 ? 0xFEE75C : 0xED4245;

  const embed = {
    color,
    title: `⭐ RateMyProfessor — ${courseCode}: ${title}`,
    description: `Professors currently teaching this course based on live WebReg data.`,
    fields,
    footer: { text: 'Ratings from RateMyProfessor · Sections from Rutgers SOC' },
    timestamp: new Date().toISOString()
  };

  await interaction.editReply({ embeds: [embed] });
  logger.info('Handled /rmp', { userId, username, courseInput, instructors: rmpResults.length });
}

//  /tree 

async function handleTree(interaction) {
  const major = interaction.options.getString('major');
  const imageResult = await getMajorImage(major);

  if (!imageResult) {
    await interaction.editReply(
      `No degree tree found for "${major}". Try typing the full major name, e.g. **Computer Science**, **Data Science CS**, **Math Actuarial**, **Biology Delayed Chem**.`
    );
    return;
  }

  await interaction.editReply({
    embeds: [{
      title: imageResult.label,
      image: { url: imageResult.image_url }
    }]
  });

  logger.info('Handled /tree', { major });
}

//  /career 

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

  const content = await runAdvisor(userId, username, question);
  await sendChunks(interaction, content);
  logger.info('Handled /career', { userId, username, goal, majors: occupation.recommended_majors });
}

// /help 

async function handleHelp(interaction) {
  const helpText = [
    '**Rutgers Academic Course Advisor — Commands**',
    '',
    '`/ask <question>` — Ask anything about courses, prereqs, professors, or degree requirements.',
    '`/roadmap [major] [current semester] [future y/n]` — Get your personalized semester-by-semester course plan.',
    '`/search <course>` — Look up a specific course by name or code (e.g. CS 344, "algorithms").',
    '`/snipe <course>` — Check WebReg seat availability and learn how to snipe open seats.',
    '`/rmp <course>` — Look up RateMyProfessor ratings for professors teaching a course this semester.',
    '`/career <goal>` — Find the Rutgers majors that best match a career goal.',
    '`/tree [major]` — Provide a major, returns a tree for which courses to take in a tree structure.',
    '`/help` — Show this message.',
    '',
    'All advice is based on official Rutgers Course data. Always verify on WebReg before registering.'
  ].join('\n');

  await interaction.editReply(helpText)
    .catch((err) => logger.error('Help reply failed:', err.message));

  logger.info('Handled /help');
}

// Autocomplete dispatcher 

async function handleAutocomplete(interaction) {
  if (interaction.commandName === 'tree') {
    try {
      const focused = interaction.options.getFocused();
      const suggestions = await getMajorAutocomplete(focused);
      await interaction.respond(suggestions);
    } catch (err) {
      logger.error('handleTreeAutocomplete failed:', err.message);
      await interaction.respond([]).catch(() => {});
    }
  }
}

// Main dispatcher 

async function handleInteraction(interaction) {
  // FIX: handle autocomplete BEFORE isChatInputCommand check —
  // autocomplete interactions return false for isChatInputCommand()
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const validCommands = ['ask', 'roadmap', 'search', 'snipe', 'rmp', 'tree', 'career', 'help'];
  if (!validCommands.includes(commandName)) return;

  const userId = interaction.user.id;
  const username = interaction.user.username;

  logger.info('Interaction received', { userId, command: commandName, id: interaction.id });

  if (handledInteractions.has(interaction.id)) {
    logger.warn('Duplicate interaction skipped', { id: interaction.id });
    return;
  }
  handledInteractions.set(interaction.id, Date.now());

  if (isRateLimited(userId)) {
    const remaining = getRemainingSeconds(userId);
    await interaction.reply({
      content: `Please wait ${remaining} second(s) before using another command.`,
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
    if (commandName === 'ask')     await handleAsk(interaction, userId, username);
    if (commandName === 'roadmap') await handleRoadmap(interaction, userId, username);
    if (commandName === 'search')  await handleSearch(interaction, userId, username);
    if (commandName === 'snipe')   await handleSnipe(interaction, userId, username);
    if (commandName === 'rmp')     await handleRmp(interaction, userId, username);
    if (commandName === 'tree')    await handleTree(interaction);
    if (commandName === 'career')  await handleCareer(interaction, userId, username);
    if (commandName === 'help')    await handleHelp(interaction);
  } catch (err) {
    logger.error('Interaction handler error:', err.message);
    await interaction
      .editReply('Sorry, something went wrong. Please try again later.')
      .catch((editErr) => logger.error('Fallback edit failed:', editErr.message));
  }
}

module.exports = { handleInteraction, handleAutocomplete };