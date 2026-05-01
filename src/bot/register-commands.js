/**
 * src/bot/register-commands.js
 *
 * One-time slash command registration script.
 *
 * Running the bot is not enough to create slash commands in Discord. This script
 * tells Discord what commands the application supports. Run it with:
 *
 *   npm run register
 *
 * After successful registration, Discord will show `/ask` in servers where the
 * bot/application is installed.
 */

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const logger = require('../utils/logger');

/**
 * Command definition sent to Discord.
 *
 * `type: 3` means STRING option in Discord's API. This avoids importing the
 * SlashCommandBuilder class and keeps the file easy to read for an MVP.
 */
const commands = [
  {
    name: 'ask',
    description: 'Ask the Rutgers Course Agent for course planning help',
    options: [
      {
        name: 'question',
        type: 3,
        description: 'Example: "I took 111 and 112. What CS courses should I take next?"',
        required: true
      }
    ]
  }
];

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const appId = process.env.DISCORD_APP_ID;

  // These checks prevent confusing Discord API errors later.
  if (!token) {
    logger.error('DISCORD_TOKEN is not set');
    process.exit(1);
  }

  if (!appId) {
    logger.error('DISCORD_APP_ID is not set');
    process.exit(1);
  }

  // REST client is used only for Discord API calls outside the live gateway.
  const rest = new REST({ version: '10' }).setToken(token);

  try {
    logger.info('Registering slash commands...');

    /**
     * applicationCommands(appId) registers global commands.
     *
     * Global commands can take time to propagate. For faster local testing, the
     * team could later switch to guild-specific registration with
     * Routes.applicationGuildCommands(appId, guildId).
     */
    const data = await rest.put(Routes.applicationCommands(appId), {
      body: commands
    });

    logger.info(`Successfully registered ${data.length} command(s)`);
    process.exit(0);
  } catch (err) {
    logger.error('Failed to register commands:', err.message);
    process.exit(1);
  }
}

registerCommands();
