# Redesign Branch Code Walkthrough

This branch is a full Course Agent MVP redesign with extra comments added for team handoff.

## Big picture

The bot handles one Discord slash command:

```text
/ask question:<course planning question>
```

The request flow is:

```text
Discord user
  -> /ask command
  -> src/bot/index.js
  -> src/bot/interactionHandler.js
  -> src/utils/rateLimiter.js
  -> src/utils/memoryService.js
  -> src/agents/courseClient.js
  -> src/agents/aiClient.js
  -> OpenAI
  -> split response into Discord-safe chunks
  -> send answer back to Discord
```

## File responsibilities

### `src/bot/index.js`

Starts the Discord client.

Responsibilities:
- loads `.env`
- creates the Discord client
- listens for `interactionCreate`
- sends every interaction to `handleInteraction()`
- logs in with `DISCORD_TOKEN`

This file should stay small.

### `src/bot/register-commands.js`

Registers slash commands with Discord.

Responsibilities:
- defines `/ask`
- validates `DISCORD_TOKEN` and `DISCORD_APP_ID`
- sends command definitions to Discord using the REST API

Run it with:

```bash
npm run register
```

### `src/bot/interactionHandler.js`

Owns the `/ask` lifecycle.

Responsibilities:
- ignores non-command interactions
- ignores commands other than `/ask`
- deduplicates repeated Discord interaction IDs
- rate-limits users
- defers replies so Discord does not time out
- gets short-term memory
- builds retrieved course context
- calls the LLM adapter
- saves memory
- splits long Discord messages
- sends the response

This file should contain Discord routing and orchestration logic, not course data.

### `src/agents/courseClient.js`

Static course knowledge layer for the MVP.

Responsibilities:
- stores seed Rutgers CS requirement data
- stores a seed course list
- stores career-path hints
- searches courses with keyword scoring
- builds a course context block for the LLM

Future replacement:
- Rutgers catalog API/scraper
- WebReg live seat data
- Degree Navigator export
- RateMyProfessor or difficulty data if approved
- vector search/RAG

### `src/agents/aiClient.js`

OpenAI adapter.

Responsibilities:
- initializes OpenAI client
- sanitizes chat history
- injects retrieved course context
- calls OpenAI chat completions
- handles API errors cleanly

This file is the provider boundary. If the team switches away from OpenAI, edit this file first.

### `src/utils/memoryService.js`

Memory abstraction.

Responsibilities:
- loads recent chat history
- saves user/assistant turns
- uses Supabase if configured
- falls back to in-memory storage if Supabase is missing
- includes long-term memory search utilities for later RAG flows

### `src/utils/conversationStore.js`

In-memory fallback memory.

Responsibilities:
- stores the latest messages per user in a Map
- trims old messages
- disappears on process restart

### `src/utils/messageUtils.js`

Discord-safe message splitting.

Responsibilities:
- keeps messages below 1900 characters
- prefers splitting at newlines or spaces

### `src/utils/rateLimiter.js`

Simple per-user cooldown.

Responsibilities:
- checks whether a user is still in cooldown
- records accepted requests
- calculates remaining seconds

## Current MVP limitations

This redesign branch does not provide:

- live WebReg seat checking
- live professor lookup
- real Degree Navigator integration
- RateMyProfessor integration
- official graduation audit
- full transcript parsing

The bot should clearly tell users to verify official requirements with Rutgers advising or official Rutgers systems.

## Why the code is structured this way

The split is intentional:

```text
bot/       Discord-specific code
agents/    Course retrieval and LLM logic
utils/     Shared helpers
```

That keeps the codebase maintainable. The course data layer can change later without rewriting the Discord handler. The LLM provider can change later without rewriting command routing.
