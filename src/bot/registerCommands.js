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
  description: 'View your degree roadmap image and get personalized advising',
  options: [
    {
      name: 'major',
      type: 3,
      description: 'Your major (e.g. Computer Science BA, Biology, Data Science CS)',
      required: true,
      autocomplete: true
    },
    {
      // shown for semester-based majors; ignored by picker majors via handler logic
      name: 'semester',
      type: 3,
      description: 'Which semester are you currently in? (1–8) — semester-based majors only',
      required: false,
      choices: [
        { name: '1st Semester', value: '1' },
        { name: '2nd Semester', value: '2' },
        { name: '3rd Semester', value: '3' },
        { name: '4th Semester', value: '4' },
        { name: '5th Semester', value: '5' },
        { name: '6th Semester', value: '6' },
        { name: '7th Semester', value: '7' },
        { name: '8th Semester', value: '8' }
      ]
    },
    {
      // semester-based only: show current or next semester image
      name: 'future',
      type: 3,
      description: 'Show next semester instead of current? — semester-based majors only',
      required: false,
      choices: [
        { name: 'No — show my current semester', value: 'no' },
        { name: 'Yes — show the next semester',  value: 'yes' }
      ]
    },
    {
      // picker majors: which named section image to show
      name: 'section',
      type: 3,
      description: 'Which section to view — for Data Science, Economics, Business, Accounting',
      required: false,
      autocomplete: true
    },
    {
      name: 'question',
      type: 3,
      description: 'Optional: ask the advisor a question about this roadmap image',
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
    name: 'major',
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
    name: 'session',
    description: 'Start or end an advising session',
    options: [
      {
        name: 'action',
        type: 3,
        description: 'Start or end your session',
        required: true,
        choices: [
          { name: 'Start session', value: 'start' },
          { name: 'End session + get summary', value: 'end' }
        ]
      },
      {
        name: 'topic',
        type: 3,
        description: 'What are you focusing on? (e.g. planning junior year)',
        required: false
      }
    ]
  },
  {
  name: 'career',
  description: 'Find careers that match a Rutgers major',
  options: [
    {
      name: 'major',
      type: 3,
      description: 'Your major (e.g. Computer Science, Mathematics, Biology)',
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