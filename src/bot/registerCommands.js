require('dotenv').config();
const { REST, Routes } = require('discord.js');
const logger = require('../utils/logger');

const commands = [
  {
    name: 'ask',
    description: 'Ask the Rutgers CS advisor any course-related question',
    options: [
      {
        name: 'question',
        type: 3,
        description: 'Your question about courses, prereqs, professors, etc.',
        required: true
      }
    ]
  },
  {
    name: 'roadmap',
    description: 'Generate a personalized semester-by-semester course plan',
    options: [
      {
        name: 'completed',
        type: 3,
        description: 'Courses you have already completed (e.g. CS 111, CS 112)',
        required: true
      },
      {
        name: 'goal',
        type: 3,
        description: 'Your career goal or track (e.g. AI, systems, software engineering)',
        required: true
      },
      {
        name: 'semesters',
        type: 3,
        description: 'How many semesters remaining (e.g. 4)',
        required: false
      }
    ]
  },
  {
    name: 'search',
    description: 'Look up a specific course',
    options: [
      {
        name: 'course',
        type: 3,
        description: 'Course name or code (e.g. CS 344 or "algorithms")',
        required: true
      }
    ]
  },
  {
    name: 'snipe',
    description: 'Check seat availability for a course on WebReg',
    options: [
      {
        name: 'course',
        type: 3,
        description: 'Course code to check (e.g. CS 416)',
        required: true
      }
    ]
  },
  {
    name: 'rmp',
    description: 'Look up RateMyProfessor ratings for professors teaching a course this semester',
    options: [
      {
        name: 'course',
        type: 3,
        description: 'Course code (e.g. CS 416, MATH 251, 198:416)',
        required: true
      }
    ]
  },
  {
    name: 'tree',
    description: 'View the degree tree for a major',
    options: [
      {
        name: 'major',
        type: 3,
        description: 'Type your major (e.g. Computer Science, Biology, Data Science)',
        required: true,
        autocomplete: true
      }
    ]
  },
  {
    name: 'career',
    description: 'Find majors that match a career goal',
    options: [
      {
        name: 'goal',
        type: 3,
        description: 'Career you want (e.g. software engineer, lawyer, actuary)',
        required: true
      }
    ]
  },
  {
    name: 'help',
    description: 'Show all available commands',
    options: []
  }
];

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const appId = process.env.DISCORD_APP_ID;

  if (!token) {
    logger.error('DISCORD_TOKEN is not set');
    process.exit(1);
  }
  if (!appId) {
    logger.error('DISCORD_APP_ID is not set');
    process.exit(1);
  }

  console.log('Token exists:', !!token);
  console.log('Token length:', token?.length);
  console.log('App ID:', appId);

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    logger.info('Registering slash commands...');
    const data = await rest.put(Routes.applicationCommands(appId), {
      body: commands
    });
    logger.info('Successfully registered', data.length, 'command(s)');
    process.exit(0);
  } catch (err) {
    logger.error('Failed to register commands:', err.message);
    process.exit(1);
  }
}

registerCommands();