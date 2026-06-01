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
    name:'roadmap',  
    description:'Generate a personalized semester-by-semester course plan',
    options:[
      {
        name: 'completed',
        type: 3,
        description: 'Courses you have already completed (e.g. CS 111, CS 112)',
        required: true
      },
      {
        name:'goal',
        type:3,
        description:'Your career goal or track (e.g. AI, systems, software engineering)',
        required:true
      },
      {
        name: 'semesters',
        type: 3,
        description: 'How many semesters remaining (e.g. 4)',
        required:false

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
        description: 'Course name or code(e.g. CS 344 or "algorithms")',
        required: true
      }
    ]
  },
  {
    name: 'snipe',
    description: 'Check seat availability for a course on Webreg',
    options: [
      {
        name: 'course',
        type: 3,
        description: 'Course code to check (e.g. CS 416)',
        required:true
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
        description: 'Select your major',
        required: true,
        choices: [
          { name: 'Accounting', value: 'Accounting' },
          { name: 'BAIT', value: 'BAIT' },
          { name: 'Biology', value: 'Biology' },
          { name: 'Biomedical Engineering', value: 'Biomedical Engineering' },
          { name: 'Civil Engineering', value: 'Civil Engineering' },
          { name: 'Computer Engineering', value: 'Computer Engineering' },
          { name: 'Computer Science', value: 'CS' },
          { name: 'Economics', value: 'Economics' },
          { name: 'Electrical Engineering', value: 'Electrical Engineering' },
          { name: 'Finance', value: 'Finance' },
          { name: 'Information Technology', value: 'Information Technology' },
          { name: 'Leadership and Management', value: 'Leadership and Management' },
          { name: 'Marketing', value: 'Marketing' },
          { name: 'Math', value: 'Math' },
          { name: 'Mechanical Engineering', value: 'Mechanical Engineering' },
          { name: 'Nursing', value: 'Nursing' },
          { name: 'Political Science', value: 'Political Science' },
          { name: 'Psychology', value: 'Psychology' },
          { name: 'Supply Chain Management', value: 'Supply Chain Management' }
        ]
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
