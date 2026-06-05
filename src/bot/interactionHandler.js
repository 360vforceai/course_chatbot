const { isRateLimited, recordRequest, getRemainingSeconds } = require('../utils/rateLimiter');
const { splitMessage } = require('../utils/messageUtils');
const { getResponse, getRouterDecision } = require('../agents/aiClient');
const { startSession, getSession, endSession, hasSession } = require('../utils/sessionStore');
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
  getMajorImage,
  findOccupation,
  getMajorAutocomplete,
  fetchLiveWebReg,
  fetchRmpForCourse,
  getRoadmapMode,
  getRoadmapBySemester,
  getRoadmapBySection,
  getRoadmapMajorAutocomplete,
  getRoadmapSectionAutocomplete,
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

// ── Shared helper: send chunks back to Discord ────────────────────────────────

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

// ── Shared helper: run RAG + getResponse for a question string ────────────────

async function runAdvisor(userId, username, question) {
  const shortTermHistory = await getShortTermHistory(userId);
  const { tables, keywords } = await getRouterDecision(shortTermHistory, question);

  logger.info('Router decision applied', { userId, tables, keywords });

  const [
    { memories, embedding },
    courseCatalogResults,
    degreeRequirementResults,
    webregResults,
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
    keywords
  });

  saveMemoryAsync(userId, username, question, content, embedding);

  return content;
}

// ── /ask ──────────────────────────────────────────────────────────────────────

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

// ── /roadmap ──────────────────────────────────────────────────────────────────
// Resolves the right image based on major mode (semester vs picker),
// optionally sends it to OpenAI with the user's question.

async function handleRoadmap(interaction, userId, username) {
  const majorRaw  = interaction.options.getString('major');   // may be "Data Science||CS"
  const semStr    = interaction.options.getString('semester'); // '1'–'8' or null
  const future    = interaction.options.getString('future');  // 'yes'|'no'|null
  const section   = interaction.options.getString('section'); // picker label or null
  const question  = interaction.options.getString('question');// optional free text

  if (!majorRaw) {
    await interaction.editReply('Please select a major from the dropdown.');
    return;
  }

  // Split pipe-delimited value back into major + track
  const [major, track] = majorRaw.includes('||')
    ? majorRaw.split('||')
    : [majorRaw, null];

  // 1. Determine mode from DB
  logger.info('Roadmap debug', { majorRaw, major, track });
  const mode = await getRoadmapMode(major, track);
  logger.info('Roadmap mode', { mode });

  if (!mode) {
    await interaction.editReply(`No roadmap data found for **${major}${track ? ` — ${track}` : ''}**. Try a different major.`);
    return;
  }

  let imageRow = null;

  // ── Semester-based path ──────────────────────────────────────────────────
  if (mode === 'semester') {
    if (!semStr) {
      await interaction.editReply(
        `**${major}** uses a semester-by-semester roadmap. Please fill in the **semester** option (1–8).`
      );
      return;
    }

    let semNum = parseInt(semStr, 10);

    // If user wants next semester, bump by 1 (cap at 8)
    if (future === 'yes') {
      semNum = Math.min(semNum + 1, 8);
    }

    imageRow = await getRoadmapBySemester(major, semNum, track);

    if (!imageRow) {
      await interaction.editReply(`Couldn't find semester ${semNum} for **${major}${track ? ` — ${track}` : ''}**.`);
      return;
    }
  }

  // ── Picker-based path ────────────────────────────────────────────────────
  if (mode === 'picker') {
    if (!section) {
      // Tell user what sections are available instead of silently failing
      const available = await getRoadmapSectionAutocomplete(majorRaw, '');
      const list = available.map((s) => `• ${s.name}`).join('\n');
      await interaction.editReply(
        `**${major}** doesn't use semester numbers — please fill in the **section** option.\n\nAvailable sections:\n${list}`
      );
      return;
    }

    imageRow = await getRoadmapBySection(major, section);

    if (!imageRow) {
      await interaction.editReply(`Couldn't find the **${section}** image for **${major}**.`);
      return;
    }
  }

  // ── Build the embed ──────────────────────────────────────────────────────
  const embed = {
    title: imageRow.label,
    image: { url: imageRow.image_url },
    color: 0x5865F2,
    footer: question
      ? { text: 'Sending your question to the advisor…' }
      : { text: 'Rutgers Academic Advisor · /roadmap' }
  };

  await interaction.editReply({ embeds: [embed] });

  // ── Optional AI question with image context ──────────────────────────────
  if (question) {
    try {
      // Fetch the image as base64 so it can be sent to the vision model
      const imgRes  = await fetch(imageRow.image_url);
      const imgBuf  = await imgRes.arrayBuffer();
      const b64     = Buffer.from(imgBuf).toString('base64');
      const mimeType = imgRes.headers.get('content-type') || 'image/png';

      const { getClient } = require('../agents/aiClient');
      const openai = getClient();

      const aiRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1024,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful Rutgers University academic advisor. ' +
              'The student has shared their degree roadmap image. ' +
              'Answer their question using the course information visible in the image. ' +
              'Be specific — reference course codes, semester order, and prereq chains. ' +
              'Never invent course data not visible in the image.' +
              'Do not ask follow up questions.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${b64}`
                }
              },
              {
                type: 'text',
                text: question
              }
            ]
          }
        ]
      });

      const answer = aiRes.choices[0]?.message?.content?.trim();
      if (answer) {
        const chunks = splitMessage(answer);
        for (const chunk of chunks) {
          await interaction.followUp({ content: chunk });
        }
      }

      // Persist to short-term memory so /ask follows on naturally
      saveMemoryAsync(userId, username, question, answer || '', null);

    } catch (err) {
      logger.error('Roadmap vision call failed:', err.message);
      await interaction.followUp({
        content: '⚠️ Couldn\'t process your question right now. Try `/ask` for follow-up questions.',
      });
    }
  }

  logger.info('Handled /roadmap', { userId, username, major, mode, section, semStr, future, hasQuestion: !!question });
}

// ── /search ───────────────────────────────────────────────────────────────────

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

// ── /snipe ────────────────────────────────────────────────────────────────────

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

// ── /rmp ─────────────────────────────────────────────────────────────────────
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

  const fields = rmpResults.map(({ instructor, lastName, result }) => {
    // No result from either seeded data or live RMP
    if (!result) {
      return {
        name: `👤 ${instructor}`,
        value: `No RateMyProfessor profile found. Try searching [manually](https://www.ratemyprofessors.com/search/professors/825?q=${encodeURIComponent(lastName)}).`,
        inline: false
      };
    }

    // Seeded result — content is pre-formatted text, show it directly
    if (result.source === 'seeded') {
      const meta = result.metadata || {};
      const rating = meta.avg_rating?.toFixed(1) ?? 'N/A';
      const difficulty = meta.avg_difficulty?.toFixed(1) ?? 'N/A';
      const numRatings = meta.num_ratings ?? 0;
      const ratingEmoji = (meta.avg_rating >= 4) ? '🟢' : (meta.avg_rating >= 3) ? '🟡' : '🔴';
      const profName = `${meta.first_name || ''} ${meta.last_name || ''}`.trim() || instructor;
      const rmpLink = `https://www.ratemyprofessors.com/search/professors/825?q=${encodeURIComponent(meta.last_name || lastName)}`;

      // Parse tags and comment from the stored content string
      const tagMatch = result.content.match(/Tags: ([^\n]+)/);
      const commentMatch = result.content.match(/Student comments: "([^"]+)"/);
      const tags = tagMatch ? tagMatch[1] : '';
      const commentLine = commentMatch ? `\n> "${commentMatch[1].slice(0, 150)}${commentMatch[1].length > 150 ? '...' : ''}"` : '';

      return {
        name: `${ratingEmoji} ${profName} (WebReg: ${instructor}) *(from database)*`,
        value: [
          `**Rating:** ${rating}/5 · **Difficulty:** ${difficulty}/5 *(${numRatings} ratings)*`,
          tags ? `**Tags:** ${tags}` : '',
          commentLine,
          `[Search on RMP](${rmpLink})`
        ].filter(Boolean).join('\n'),
        inline: false
      };
    }

    // Live RMP result
    const rmpData = result.rmpData;
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

    // Decode base64 RMP ID to get numeric profile ID
    let rmpNumericId = rmpData.id;
    try {
      const decoded = Buffer.from(rmpData.id, 'base64').toString('utf8');
      const m = decoded.match(/Teacher-(\d+)/);
      if (m) rmpNumericId = m[1];
    } catch (_) {
      const m = String(rmpData.id).match(/Teacher-(\d+)/);
      if (m) rmpNumericId = m[1];
    }
    const rmpLink = `https://www.ratemyprofessors.com/professor/${rmpNumericId}`;

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
    .filter(r => r.result?.source === 'live' ? r.result.rmpData?.avgRating : r.result?.metadata?.avg_rating)
    .reduce((max, r) => {
      const val = r.result?.source === 'live' ? r.result.rmpData?.avgRating : r.result?.metadata?.avg_rating;
      return Math.max(max, val || 0);
    }, 0);
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

// ── /tree ─────────────────────────────────────────────────────────────────────

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

// ── /career ───────────────────────────────────────────────────────────────────

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

// ── /session ───────────────────────────────────────────────────────────────────

async function handleSession(interaction, userId, username) {
  const action = interaction.options.getString('action');
  const topic = interaction.options.getString('topic') || 'general advising';

  if (action === 'start') {
    startSession(userId, topic);
    await interaction.editReply(
      `✅ **Session started!**\n\n` +
      `**Topic:** ${topic}\n\n` +
      `Use any command as normal — \`/ask\`, \`/search\`, \`/snipe\`, etc.\n` +
      `When you're done, use \`/session\` → **End session** to get a summary of everything discussed.`
    );
    logger.info('Session started', { userId, topic });
    return;
  }

  if (action === 'end') {
    const session = getSession(userId);

    if (!session) {
      await interaction.editReply(
        `You don't have an active session. Use \`/session\` → **Start session** to begin one.`
      );
      return;
    }

    // Pull all messages since the session started from app_chat_history
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    const { data: messages, error } = await supabase
      .from('app_chat_history')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .gte('created_at', session.startedAt)
      .order('created_at', { ascending: true });

    endSession(userId);

    if (error || !messages || messages.length === 0) {
      await interaction.editReply(
        `Session ended. No messages were recorded during this session.`
      );
      return;
    }

    // Build conversation text for the summary
    const historyText = messages
      .map(m => `${m.role === 'user' ? '**Student**' : '**Advisor**'}: ${m.content}`)
      .join('\n\n');

    // Generate summary with AI
    const { getClient } = require('../agents/aiClient');
    const openai = getClient();

    let summary = 'Could not generate summary.';
    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content:
              'You are summarizing a Rutgers academic advising session for a student. ' +
              'Write a concise summary using Discord markdown with these sections:\n' +
              '**What you asked about** — brief list of topics/questions\n' +
              '**Key info covered** — important courses, requirements, or advice given\n' +
              '**Next steps** — 2-3 actionable things the student should do\n\n' +
              'Be specific — use actual course codes and details from the conversation. Keep it under 400 words.'
          },
          {
            role: 'user',
            content: `Session topic: ${session.topic}\n\nConversation:\n${historyText}`
          }
        ]
      });
      summary = res.choices[0]?.message?.content?.trim() || summary;
    } catch (err) {
      logger.error('Session summary generation failed:', err.message);
    }

    await interaction.editReply({
      embeds: [{
        color: 0x5865F2,
        title: '📋 Session Summary',
        description: summary,
        footer: {
          text: `Session topic: ${session.topic} · ${messages.length / 2} exchanges`
        },
        timestamp: new Date().toISOString()
      }]
    });

    logger.info('Session ended', { userId, messageCount: messages.length });
  }
}

// ── /help ─────────────────────────────────────────────────────────────────────

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
    '`/session [action] <topic>` — Start a session with the bot and end it with a summary.', 
    '`/help` — Show this message.',
    '',
    'All advice is based on official Rutgers Course data. Always verify on WebReg before registering.'
  ].join('\n');

  await interaction.editReply(helpText)
    .catch((err) => logger.error('Help reply failed:', err.message));

  logger.info('Handled /help');
}

// ── Autocomplete dispatcher ───────────────────────────────────────────────────

async function handleAutocomplete(interaction) {
  const { commandName } = interaction;
  const focused = interaction.options.getFocused(true); // { name, value }

  // /tree — major field
  if (commandName === 'tree' && focused.name === 'major') {
    const suggestions = await getMajorAutocomplete(focused.value);
    await interaction.respond(suggestions).catch(() => {});
    return;
  }

  // /roadmap — major field
  if (commandName === 'roadmap' && focused.name === 'major') {
    const suggestions = await getRoadmapMajorAutocomplete(focused.value);
    await interaction.respond(suggestions).catch(() => {});
    return;
  }

  // /roadmap — section field (depends on which major is already chosen)
  if (commandName === 'roadmap' && focused.name === 'section') {
    // Read the already-typed major value from the other option
    const majorValue = interaction.options.getString('major') || '';
    const suggestions = await getRoadmapSectionAutocomplete(majorValue, focused.value);
    await interaction.respond(suggestions).catch(() => {});
    return;
  }

  // fallback — respond with empty so Discord doesn't show an error
  await interaction.respond([]).catch(() => {});
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

async function handleInteraction(interaction) {
  // FIX: handle autocomplete BEFORE isChatInputCommand check —
  // autocomplete interactions return false for isChatInputCommand()
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const validCommands = ['ask', 'roadmap', 'search', 'snipe', 'rmp', 'tree', 'career', 'session', 'help'];
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
    if (commandName === 'session') await handleSession(interaction, userId, username);
    if (commandName === 'help')    await handleHelp(interaction);
  } catch (err) {
    logger.error('Interaction handler error:', err.message);
    await interaction
      .editReply('Sorry, something went wrong. Please try again later.')
      .catch((editErr) => logger.error('Fallback edit failed:', editErr.message));
  }
}

module.exports = { handleInteraction, handleAutocomplete };