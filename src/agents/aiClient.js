const OpenAI = require('openai');
const logger = require('../utils/logger');

const DEFAULT_SYSTEM_PROMPT = `You are an AI Course Advisor for a Discord server serving Rutgers University Computer Science students.

You help students with two main things:

## 1. Course Planning & Advising
Help students find the right courses, build semester plans, and navigate degree requirements.

**Course Search**: Answer questions about specific courses (codes, descriptions, prereqs, availability, professors).
**Roadmap Generation**: Given a student's completed courses, major, and goals, generate a personalized semester-by-semester plan.
**Degree Requirements**: Explain what's required for the CS degree, tracks (AI, systems, theory, etc.), and how to fulfill them.

When course/degree context is provided, always cite specific course codes and names — never give vague advice.

## 2. Registration Assistance
Help students navigate WebReg and course registration.

**Availability**: Answer whether a course has open seats (when data is provided).
**Scheduling**: Help avoid time conflicts and balance workload (hard/easy mix per semester).
**Sniping**: Explain how course sniping works — monitoring WebReg for seat openings — if asked.

## General Rules:
- Be warm, practical, and specific — use course codes (e.g. CS 344, CS 416)
- When course data is provided as context, reference it directly; never guess prereqs or availability
- When generating roadmaps, account for prereq chains, difficulty balance, and career track
- If a student shares their transcript or completed courses, tailor all advice to their specific situation
- Never make up professor names, course availability, or requirements — only use provided context
- Encourage students to verify critical info on WebReg and the official Rutgers CS site`;

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
const MODEL = 'gpt-4o-mini';

const TOOLS = [];

// FIX: only suggest /tree when the response is specifically about choosing or
// comparing degree programs — not just any mention of a major name in passing.
const TREE_TRIGGER_PHRASES = [
  'major in',
  'majoring in',
  'declare a major',
  'switch to',
  'degree in',
  'bs in',
  'ba in',
  'program in',
  'pursue a',
  'consider a',
  'recommend the',
  'best major',
  'which major',
  'your major',
  'the major',
];

const KNOWN_MAJORS = [
  'Accounting', 'BAIT', 'Biology', 'Biomedical Engineering', 'Business Core',
  'Civil Engineering', 'Computer Engineering', 'CS', 'Computer Science',
  'Data Science', 'Economics', 'Electrical Engineering', 'Finance',
  'Information Technology', 'Leadership and Management', 'Marketing',
  'Math', 'Mechanical Engineering', 'Nursing', 'Political Science',
  'Psychology', 'Supply Chain Management'
];

function appendTreeSuggestion(content) {
  const lower = content.toLowerCase();
  const hasTrigger = TREE_TRIGGER_PHRASES.some((phrase) => lower.includes(phrase));
  if (!hasTrigger) return content;
  const matched = KNOWN_MAJORS.find((m) => lower.includes(m.toLowerCase()));
  if (!matched) return content;
  return content + `\n\n💡 Want to see the full degree tree? Use \`/tree\` and select **${matched}**.`;
}

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    logger.info('OpenAI client init', { keyPrefix: apiKey.slice(0, 12) + '...' });
    client = new OpenAI({ apiKey });
  }
  return client;
}

function executeToolCall(name, args) {
  return `Unknown tool: ${name}`;
}

function sanitizeHistoryMessages(messages) {
  const safeMessages = [];
  let pendingToolCallIds = null;
  let droppedToolMessages = 0;

  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || typeof msg !== 'object') continue;

    if (msg.role === 'user') {
      safeMessages.push(msg);
      pendingToolCallIds = null;
      continue;
    }

    if (msg.role === 'assistant') {
      safeMessages.push(msg);
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        pendingToolCallIds = new Set(
          msg.tool_calls
            .map((tc) => tc?.id)
            .filter((id) => typeof id === 'string' && id.length > 0)
        );
      } else {
        pendingToolCallIds = null;
      }
      continue;
    }

    if (msg.role === 'tool') {
      const toolCallId = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '';
      const isValid = pendingToolCallIds && toolCallId && pendingToolCallIds.has(toolCallId);
      if (isValid) {
        safeMessages.push(msg);
      } else {
        droppedToolMessages++;
      }
      continue;
    }
  }

  if (droppedToolMessages > 0) {
    logger.warn(`Dropped ${droppedToolMessages} orphaned tool message(s) from conversation history`);
  }

  return safeMessages;
}

const ROUTER_SYSTEM_PROMPT = `You are a query router for a Rutgers CS course advising Discord bot.

Given a conversation history and the user's latest question, output a JSON object with exactly two fields:

1. "tables": array of data sources to query (can be empty for pure chit-chat).
   Valid values: "course_catalog", "degree_requirements", "webreg", "roadmaps"
   - course_catalog: specific course info — code, title, description, prereqs, credits
   - degree_requirements: CS degree requirements, tracks (AI/systems/theory), core vs elective rules
   - webreg: real-time course availability, open seats, section times, index numbers
   - roadmaps: official Rutgers CS degree roadmap — suggested semester-by-semester sequences

2. "keywords": a single short phrase (3-8 words) optimized for semantic vector search.
   Match the actual text format stored in each table:

   ## course_catalog embedding format:
   "CS 344 | Design and Analysis of Computer Algorithms | prereqs: CS 112, CS 206, MATH 250 | 4 credits | description: ..."
   → Good keywords: course code + title fragment, or topic + level ("algorithm design upper division", "CS 344 algorithms")

   ## degree_requirements embedding format:
   "CS Major Core Requirement: CS 111, CS 112, CS 205, CS 206, CS 211 | Track: Systems | Electives: ..."
   → Good keywords: requirement type + track ("CS core requirements", "systems track electives", "graduation checklist")

   ## webreg embedding format:
   "CS 416:01 | Operating Systems Design | Prof. Tjang | Mon/Wed 10:20-11:40 | Index: 12345 | Open seats: 4 | Credits: 3"
   → Good keywords: course code + section, or professor name ("CS 416 open seats", "operating systems section times")

   ## roadmaps embedding format:
   "CS Track: Artificial Intelligence | Semester 1: CS 111, MATH 151 | Semester 2: CS 112, MATH 152 | ..."
   → Good keywords: track name + semester sequence ("AI track semester plan", "CS roadmap systems 4 years")

   ## General keyword rules:
   - Convert course names to codes when known (e.g. "algorithms class" → "CS 344 algorithms")
   - If student mentions completed courses, focus on what comes NEXT in the prereq chain
   - Strip filler words; focus on course codes, topic names, requirement labels
   - For roadmap requests, route to both "roadmaps" and "degree_requirements"
   - For seat availability questions, route to "webreg"

   ## Keyword examples:
   "what should I take after CS 112?" → tables: ["course_catalog"], keywords: "CS 205 CS 206 after data structures"
   "how do I graduate in 4 years?" → tables: ["degree_requirements", "roadmaps"], keywords: "CS degree 4 year graduation plan"
   "is CS 344 hard?" → tables: ["course_catalog"], keywords: "CS 344 algorithms difficulty"
   "who teaches OS?" → tables: ["course_catalog", "webreg"], keywords: "CS 416 operating systems professor"
   "I want to go into AI, what electives?" → tables: ["degree_requirements", "roadmaps", "course_catalog"], keywords: "AI track electives machine learning"
   "are there open seats in CS 314?" → tables: ["webreg"], keywords: "CS 314 open seats availability"
   "show me the AI track roadmap" → tables: ["roadmaps", "degree_requirements"], keywords: "AI track semester roadmap plan"
   "hey what's up" → tables: [], keywords: ""

Output ONLY valid JSON, no explanation, no markdown fences.`;

async function getRouterDecision(shortTermHistory, question) {
  const fallback = {
    tables: ['course_catalog', 'degree_requirements', 'course_roadmaps'],
    keywords: question
  };

  try {
    const openai = getClient();

    const historyText =
      shortTermHistory.length > 0
        ? shortTermHistory
            .slice(-6)
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n')
        : '(no prior conversation)';

    const userContent = `Conversation history:\n${historyText}\n\nLatest question: ${question}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ],
      max_tokens: 80,
      temperature: 0,
      response_format: { type: 'json_object' }
    });

    const raw = response.choices[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw);

    const validTables = ['course_catalog', 'degree_requirements', 'webreg', 'course_roadmaps'];
    const tables = Array.isArray(parsed.tables)
      ? parsed.tables.filter((t) => validTables.includes(t))
      : fallback.tables;

    const keywords =
      typeof parsed.keywords === 'string' && parsed.keywords.trim()
        ? parsed.keywords.trim()
        : question;

    logger.info('Router decision', { tables, keywords });
    return { tables, keywords };
  } catch (err) {
    logger.warn('getRouterDecision failed, using fallback:', err.message);
    return fallback;
  }
}

async function getResponse(
  messages,
  {
    ragContext = null,
    courseCatalogContext = null,
    degreeRequirementsContext = null,
    webregContext = null,
    roadmapContext = null,
    professorContext = null,
    keywords = null
  } = {}
) {
  logger.info('getResponse called', {
    msgCount: messages.length,
    hasCourses: !!courseCatalogContext,
    hasRequirements: !!degreeRequirementsContext,
    hasWebreg: !!webregContext,
    hasRoadmap: !!roadmapContext,
    hasProfessor: !!professorContext,
    hasRag: !!ragContext
  });

  const systemMessage = { role: 'system', content: SYSTEM_PROMPT };
  const sanitizedHistory = sanitizeHistoryMessages(messages);

  const contextParts = [];
  const keywordsLine = keywords ? `Search keywords used: "${keywords}"\n\n` : '';

  if (courseCatalogContext) {
    contextParts.push(`## Course Catalog — Rutgers CS
${keywordsLine}The following is real course data from the Rutgers CS catalog. Use it to answer questions about specific courses, prereqs, credits, and descriptions. Reference course codes and titles directly.

${courseCatalogContext}

→ If the student is searching for a course: give the code, title, prereqs, and a brief description.
→ If building a roadmap: use prereq chains to sequence courses correctly.`);
  }

  if (degreeRequirementsContext) {
    contextParts.push(`## Degree Requirements — Rutgers CS
${keywordsLine}The following is official Rutgers CS degree requirement data. Use it to answer questions about what's required to graduate, track options, and core vs elective rules.

${degreeRequirementsContext}

→ Always specify whether a course is core, track-required, or elective.
→ When generating a plan, verify each semester satisfies graduation requirements progressively.`);
  }

  if (webregContext) {
    contextParts.push(`## WebReg — Live Course Availability
${keywordsLine}The following is current course section data from WebReg. Use it to answer questions about open seats, section times, index numbers, and professors teaching this semester.

${webregContext}

→ Give the index number, open seat count, and meeting times when answering availability questions.
→ If seats show as 0, tell the student to check back or consider sniping the course.`);
  }

  if (roadmapContext) {
    contextParts.push(`## Course Roadmaps — Rutgers CS
${keywordsLine}The following is official Rutgers CS roadmap data showing suggested semester-by-semester sequences. Use it when generating or reviewing multi-semester plans.

${roadmapContext}

→ Use the roadmap as the baseline sequence, then adjust for the student's completed courses and goals.
→ Always respect prereq chains shown in the roadmap.`);
  }

  if (professorContext) {
    contextParts.push(`## RateMyProfessor Data
${keywordsLine}The following is real RateMyProfessor data for Rutgers professors. Use it to answer questions about professor ratings, teaching style, and difficulty.

${professorContext}

→ Always mention both the rating AND difficulty score — a 4.5 rated but 4.8 difficulty professor is very different from a 4.5 rated 2.1 difficulty professor.
→ If would-take-again % is available, include it.
→ Quote specific student tags (e.g. "Clear lectures", "Tough exams") for context.`);
  }

  if (ragContext) {
    contextParts.push(`## Community Memory
${keywordsLine}The following are relevant things other students have previously shared in this Discord server.

${ragContext}`);
  }

  let apiMessages;
  if (contextParts.length > 0) {
    const contextMessage = {
      role: 'system',
      content: contextParts.join('\n\n---\n\n')
    };
    const historyWithoutLast = sanitizedHistory.slice(0, -1);
    const lastMessage = sanitizedHistory[sanitizedHistory.length - 1];
    apiMessages = [systemMessage, ...historyWithoutLast, contextMessage, lastMessage];
  } else {
    apiMessages = [systemMessage, ...sanitizedHistory];
  }

  try {
    const openai = getClient();

    let response;
    let iterations = 0;
    const maxIterations = 5;

    do {
      const reqParams = {
        model: MODEL,
        messages: apiMessages,
        max_tokens: 1024
      };
      if (TOOLS.length > 0) {
        reqParams.tools = TOOLS;
        reqParams.tool_choice = 'auto';
      }

      response = await openai.chat.completions.create(reqParams);

      const choice = response.choices[0];
      const msg = choice?.message;

      if (!msg) {
        logger.warn('OpenAI returned no message', response);
        return {
          content: 'I could not generate a response. Please try again.',
          messages: apiMessages
        };
      }

      if (choice.finish_reason === 'tool_calls' && msg.tool_calls?.length) {
        apiMessages.push(msg);
        for (const tc of msg.tool_calls) {
          const fn = tc.function;
          let args = {};
          try {
            args = JSON.parse(fn.arguments || '{}');
          } catch (e) {
            logger.warn('Invalid tool arguments', fn.arguments);
          }
          const result = await executeToolCall(fn.name, args);
          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result)
          });
        }

        iterations++;
        if (iterations >= maxIterations) {
          return {
            content: 'Sorry, I had trouble completing that request. Please try again.',
            messages: apiMessages
          };
        }
        continue;
      }

      const content = msg.content?.trim() || '';
      if (content) {
        apiMessages.push(msg);
        return { content: appendTreeSuggestion(content), messages: apiMessages };
      }

      logger.warn('OpenAI returned empty content', response);
      return {
        content: 'I could not generate a response. Please try again.',
        messages: apiMessages
      };
    } while (true);
  } catch (err) {
    logger.error('OpenAI API error', {
      status: err.status,
      message: err.message,
      type: err.type || err.error?.type
    });
    if (err.status === 429) {
      return {
        content: 'Rate limit exceeded. Please try again in a moment.',
        messages: apiMessages
      };
    }
    if (err.status === 401) {
      return {
        content: 'API configuration error. Please contact the bot administrator.',
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
  getResponse,
  getRouterDecision,
  getClient,
  appendTreeSuggestion
};