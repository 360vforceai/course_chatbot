# Rutgers Course Agent Discord Bot

A Discord.js Course Agent MVP for Rutgers course-planning questions.

This version turns the starter repo into a working `/ask` bot with:

- A real Discord interaction handler
- OpenAI response generation
- A lightweight static course knowledge layer for CS MVP planning
- Discord-safe response chunking
- Rate limiting
- Duplicate interaction protection
- Supabase memory when configured, with in-memory fallback when not configured
- Mermaid architecture diagram in `docs/course-agent-architecture.mmd`

## Setup

```bash
npm install
cp .env.example .env
```

Fill in:

```bash
DISCORD_TOKEN=...
DISCORD_APP_ID=...
OPENAI_API_KEY=...
```

Optional Supabase memory:

```bash
SUPABASE_URL=...
SUPABASE_KEY=...
```

If Supabase is omitted, the bot still runs with in-memory history until restart.

## Register slash command

```bash
npm run register
```

## Start bot

```bash
npm start
```

## Syntax check

```bash
npm run check
```

## Main files

```text
src/bot/index.js                  Discord client entrypoint
src/bot/interactionHandler.js     Handles /ask lifecycle
src/bot/register-commands.js      Registers slash commands
src/agents/aiClient.js            OpenAI client + Course Agent prompt
src/agents/courseClient.js        Static Rutgers CS seed knowledge layer
src/utils/memoryService.js        Supabase memory with in-memory fallback
src/utils/messageUtils.js         Discord message chunking
src/utils/rateLimiter.js          Per-user cooldown
```

## MVP limitation

The seed course layer does not check live WebReg open seats, live professor assignments, or RateMyProfessor yet. It gives course-planning guidance based on the static seed requirements and course list in `courseClient.js`.
