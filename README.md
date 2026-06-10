# Rutgers Academic Course Advisor — Discord Bot

A production-ready Discord bot serving Rutgers University students with AI-powered academic advising, live course data, and degree planning tools.

## Features

- **`/ask`** — Ask anything about courses, prereqs, professors, or degree requirements
- **`/roadmap`** — View your semester-by-semester degree roadmap with images, with optional AI Q&A about the image
- **`/search`** — Look up a specific course by name or code
- **`/snipe`** — Check live WebReg seat availability for any course
- **`/rmp`** — Look up RateMyProfessor ratings for professors teaching a course this semester
- **`/tree`** — View the full degree course tree for any Rutgers major
- **`/career`** — Find careers that match a Rutgers major
- **`/session`** — Start a focused advising session and get an AI-generated summary when you end it
- **`/help`** — Show all available commands

## Tech Stack

- **Runtime:** Node.js 20+
- **Discord:** discord.js v14
- **AI:** OpenAI GPT-4o-mini (chat, routing, embeddings, vision)
- **Database:** Supabase (PostgreSQL + pgvector)
- **Data Sources:** Rutgers SOC API (live WebReg), RateMyProfessor (live scrape + seeded DB)

## Prerequisites

- Node.js 20+
- A Discord bot token and application ID
- An OpenAI API key
- A Supabase project with the following tables:
  - `app_chat_history` — short-term conversation memory
  - `app_user_memories` — long-term vector memory
  - `course_catalog` — course data with embeddings
  - `degree_requirements` — degree requirement data with embeddings
  - `roadmaps` — semester roadmap images per major
  - `major_images` — degree tree images per major
  - `occupations` — career-to-major mapping
  - `professor_reviews` — seeded RMP data (optional, falls back to live)

## Setup

**1. Clone the repo and install dependencies:**
```bash
git clone https://github.com/360vforceai/course_chatbot.git
cd course_chatbot
npm install
```

**2. Create your `.env` file:**
```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_APP_ID=your_application_id_here
OPENAI_API_KEY=your_openai_api_key_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
WEBREG_YEAR=2026
WEBREG_TERM=9
LOG_LEVEL=info
```

`WEBREG_TERM` values: `1` = Spring, `7` = Summer, `9` = Fall

**3. Register slash commands with Discord (run once, or after adding new commands):**
```bash
npm run register
```

**4. Start the bot:**
```bash
npm start
```

## Project Structure

```
src/
  bot/           # Discord client, command registration, interaction handling
    index.js                # Discord client setup and event listeners
    registerCommands.js     # Slash command registration via Discord REST API
    interactionHandler.js   # All command handlers and autocomplete dispatcher
  agents/
    aiClient.js             # OpenAI client, router agent, response generator
    courseClient.js         # Supabase queries, WebReg API, RMP scraper
  utils/
    logger.js               # Structured logger with log levels
    memoryService.js        # Short-term and long-term memory (Supabase)
    messageUtils.js         # Discord message chunking (2000 char limit)
    rateLimiter.js          # Per-user 5-second cooldown
    sessionStore.js         # In-memory session tracking for /session
  scripts/
    importProfessors.js     # Imports rutgers_professors_with_courses.csv into the table in database
```

## Architecture

The bot uses a **router agent** pattern — every `/ask` question is first routed through a lightweight GPT-4o-mini call that decides which Supabase tables to query and generates optimized search keywords. Results are retrieved via vector similarity search (pgvector) and injected as context before the main response is generated.

**Request flow for `/ask`:**
```
User question
→ Router agent (decides tables + keywords)
→ Parallel RAG search (course_catalog, degree_requirements, webreg)
→ Context injection
→ GPT-4o-mini response
→ Save to short-term + long-term memory
→ Discord reply
```

**`/snipe` and `/rmp`** bypass RAG entirely and hit the Rutgers SOC API and RateMyProfessor directly for live data.

**`/roadmap`** fetches an image from Supabase Storage and optionally passes it to GPT-4o-mini vision for Q&A.

## Semester Rollover

To update the bot for a new semester, change these two values in `.env`:
```env
WEBREG_YEAR=2026
WEBREG_TERM=9
```
No code changes needed.

## Rate Limiting

Each user has a 5-second cooldown between commands to prevent API spam. The bot replies ephemerally if a user is rate limited.

## Slash Command Registration

Commands are registered globally via `npm run register`. Global commands can take up to an hour to propagate across all Discord servers. For instant updates during development, switch to guild-scoped registration by replacing `Routes.applicationCommands(appId)` with `Routes.applicationGuildCommands(appId, guildId)` in `registerCommands.js` and adding `DISCORD_GUILD_ID` to your `.env`.