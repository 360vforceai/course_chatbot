/**
 * src/bot/index.js
 *
 * Discord bot entrypoint.
 *
 * This file starts the Discord client, listens for interaction events, and hands
 * those events to interactionHandler.js. It should stay small. Most command
 * logic belongs in separate handler files.
 */

// Load environment variables from .env before reading process.env anywhere else.
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../utils/logger');
const { handleInteraction } = require('./interactionHandler');

/**
 * Create the Discord client.
 *
 * GatewayIntentBits.Guilds is enough for slash commands. We are not reading raw
 * message content, so we do not need MessageContent intent.
 */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Fired once when the bot has connected and is ready to receive events.
client.once('clientReady', (readyClient) => {
  logger.info('Discord bot ready', { user: readyClient.user.tag });
});

// Every slash command interaction, button click, dropdown selection, etc. comes
// through interactionCreate. The handler filters for `/ask` internally.
client.on('interactionCreate', async (interaction) => {
  await handleInteraction(interaction);
});

// Fail early with a clear message if the token is missing.
const token = process.env.DISCORD_TOKEN;
if (!token) {
  logger.error('DISCORD_TOKEN is not set');
  process.exit(1);
}

// Log in to Discord. If login fails, exit so deployment logs clearly show the
// bot never started successfully.
client.login(token).catch((err) => {
  logger.error('Login failed:', err.message);
  process.exit(1);
});
