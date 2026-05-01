const OpenAIImport = require('openai');
const logger = require('../utils/logger');

const OpenAI = OpenAIImport.default || OpenAIImport;

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const DEFAULT_SYSTEM_PROMPT = `You are the Rutgers Course Agent, a Discord assistant that helps Rutgers students reason through course planning.

Scope:
- Help with Rutgers New Brunswick course planning, especially Computer Science MVP questions.
- Use provided course context as ground truth when it is available.
- Help users identify remaining requirements, prerequisite issues, semester sequencing, and course choices based on goals.
- Be clear when data is only seed/static data and when live WebReg, professor, seat, or RateMyProfessor integrations are not available yet.

Response rules:
- Be concise, direct, and structured for Discord.
- Do not invent official requirements, live seat availability, professor names, or difficulty ratings.
- If the user asks for a semester plan, ask for completed courses and graduation timeline if missing, then give a reasonable provisional plan.
- If the user gives completed courses, separate completed, likely remaining, and recommended next steps.
- Include a short disclaimer that students should verify final graduation requirements with official Rutgers advising or Degree Navigator.`;

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    logger.info('OpenAI client initialized');
    client = new OpenAI({ apiKey });
  }
  return client;
}

function sanitizeHistoryMessages(messages) {
  const safeMessages = [];

  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || typeof msg !== 'object') continue;
    if (!['user', 'assistant', 'system'].includes(msg.role)) continue;
    if (typeof msg.content !== 'string' || !msg.content.trim()) continue;
    safeMessages.push({ role: msg.role, content: msg.content.trim() });
  }

  return safeMessages;
}

async function getResponse(messages, { courseContext = null } = {}) {
  const sanitizedHistory = sanitizeHistoryMessages(messages);
  const systemMessage = { role: 'system', content: SYSTEM_PROMPT };

  let apiMessages;
  if (courseContext) {
    const contextMessage = {
      role: 'system',
      content: `Use the following retrieved course-planning context as ground truth. If it is insufficient, say exactly what is missing.\n\n${courseContext}`
    };
    const historyWithoutLast = sanitizedHistory.slice(0, -1);
    const latestUserMessage = sanitizedHistory[sanitizedHistory.length - 1];
    apiMessages = [systemMessage, ...historyWithoutLast, contextMessage, latestUserMessage].filter(Boolean);
  } else {
    apiMessages = [systemMessage, ...sanitizedHistory];
  }

  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: apiMessages,
      max_tokens: 1200,
      temperature: 0.2
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      logger.warn('OpenAI returned empty content');
      return { content: 'I could not generate a response. Please try again.', messages: apiMessages };
    }

    apiMessages.push({ role: 'assistant', content });
    return { content, messages: apiMessages };
  } catch (err) {
    logger.error('OpenAI API error', {
      status: err.status,
      message: err.message,
      type: err.type || err.error?.type
    });

    if (err.status === 401) {
      return { content: 'API configuration error. Please contact the bot administrator.', messages: apiMessages };
    }
    if (err.status === 429) {
      return { content: 'Rate limit exceeded. Please try again in a moment.', messages: apiMessages };
    }
    return { content: 'Sorry, I encountered an error. Please try again later.', messages: apiMessages };
  }
}

module.exports = {
  getClient,
  getResponse
};
