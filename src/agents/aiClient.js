/**
 * src/agents/aiClient.js
 *
 * This file is the Course Agent's LLM adapter.
 *
 * Think of this module as the one place where the rest of the bot is allowed to
 * talk to OpenAI. Discord-specific code should not live here. Course search code
 * should not live here either. This module has one job:
 *
 *   cleaned chat history + retrieved course context -> OpenAI -> assistant text
 *
 * Keeping the OpenAI logic isolated makes the bot easier to maintain later. If
 * the team switches from OpenAI to another provider, most of the codebase should
 * not need to change. Only this file should need major edits.
 */

// The OpenAI package can export differently depending on CommonJS/ESM interop.
// This import pattern supports both shapes.
const OpenAIImport = require('openai');
const logger = require('../utils/logger');

// If the package exposes `default`, use that. Otherwise use the object itself.
const OpenAI = OpenAIImport.default || OpenAIImport;

// Allow the model to be changed through .env without editing code.
// gpt-4o-mini is a reasonable cheap/default model for an MVP Discord bot.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Default system prompt for the Course Agent.
 *
 * The system prompt is the high-level behavior contract for the model. It tells
 * the model what it is, what it is allowed to answer, and what it must avoid.
 *
 * Important design choice:
 * The prompt repeatedly tells the model not to invent official Rutgers details.
 * This matters because the current MVP uses static seed data, not live WebReg,
 * Degree Navigator, or RateMyProfessor data.
 */
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

// Allow the whole prompt to be overridden in .env for quick prompt testing.
// If SYSTEM_PROMPT is not set, use the safe default above.
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

// This starts as null so we only construct the OpenAI client when we actually
// need it. That avoids failing at import time if tests or scripts import this
// file without OPENAI_API_KEY configured.
let client = null;

/**
 * Lazily create and reuse the OpenAI client.
 *
 * Why lazy initialization?
 * - The bot can load modules before every env var is present.
 * - Some tests may import this file without making API calls.
 * - Reusing one client avoids recreating client objects every request.
 */
function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;

    // Fail clearly if the key is missing. This is better than letting the OpenAI
    // SDK fail later with a less obvious error.
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    logger.info('OpenAI client initialized');
    client = new OpenAI({ apiKey });
  }

  return client;
}

/**
 * Sanitize chat history before sending it to OpenAI.
 *
 * The memory layer returns old messages in the shape:
 *   { role: 'user' | 'assistant', content: '...' }
 *
 * This function protects the API call by dropping anything malformed:
 * - missing objects
 * - invalid roles
 * - blank content
 *
 * This matters because bad messages can make the OpenAI request fail.
 */
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

/**
 * Generate the assistant response.
 *
 * Parameters:
 * - messages: short-term conversation history plus the latest user message
 * - courseContext: retrieved course-planning context from courseClient.js
 *
 * Return shape:
 *   { content: string, messages: array }
 *
 * The `messages` return value is useful for debugging because it shows the exact
 * message sequence sent to the LLM, including the injected course context.
 */
async function getResponse(messages, { courseContext = null } = {}) {
  const sanitizedHistory = sanitizeHistoryMessages(messages);
  const systemMessage = { role: 'system', content: SYSTEM_PROMPT };

  let apiMessages;

  if (courseContext) {
    /**
     * The course context is inserted as a second system message immediately
     * before the latest user message.
     *
     * Why place it there?
     * - The model sees the normal behavior prompt first.
     * - It sees older conversation history next.
     * - It sees fresh retrieved context right before answering.
     *
     * This makes the retrieved course data harder for the model to ignore.
     */
    const contextMessage = {
      role: 'system',
      content: `Use the following retrieved course-planning context as ground truth. If it is insufficient, say exactly what is missing.\n\n${courseContext}`
    };

    // Keep all previous messages except the latest one.
    const historyWithoutLast = sanitizedHistory.slice(0, -1);

    // The latest user message is the actual question being answered now.
    const latestUserMessage = sanitizedHistory[sanitizedHistory.length - 1];

    apiMessages = [
      systemMessage,
      ...historyWithoutLast,
      contextMessage,
      latestUserMessage
    ].filter(Boolean);
  } else {
    // If no course context exists, answer from the system prompt and history.
    apiMessages = [systemMessage, ...sanitizedHistory];
  }

  try {
    const openai = getClient();

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: apiMessages,
      // Keep responses short enough for Discord and cheap enough for MVP usage.
      max_tokens: 1200,
      // Low temperature reduces random/speculative course-advising behavior.
      temperature: 0.2
    });

    const content = response.choices[0]?.message?.content?.trim();

    if (!content) {
      logger.warn('OpenAI returned empty content');
      return {
        content: 'I could not generate a response. Please try again.',
        messages: apiMessages
      };
    }

    // Add the assistant answer to the returned debug message list.
    apiMessages.push({ role: 'assistant', content });

    return { content, messages: apiMessages };
  } catch (err) {
    /**
     * Errors should be logged with useful details for the developer, but the
     * Discord user should only see a safe, simple message.
     */
    logger.error('OpenAI API error', {
      status: err.status,
      message: err.message,
      type: err.type || err.error?.type
    });

    if (err.status === 401) {
      return {
        content: 'API configuration error. Please contact the bot administrator.',
        messages: apiMessages
      };
    }

    if (err.status === 429) {
      return {
        content: 'Rate limit exceeded. Please try again in a moment.',
        messages: apiMessages
      };
    }

    return {
      content: 'Sorry, I encountered an error. Please try again later.',
      messages: apiMessages
    };
  }
}

module.exports = {
  getClient,
  getResponse
};
