/**
 * courseClient.js
 *
 * Lightweight course knowledge layer for the Course Agent MVP.
 * Replace this static seed data with WebReg/catalog/RMP retrieval later.
 */

const logger = require('../utils/logger');

const REQUIREMENTS = {
  program: 'Rutgers New Brunswick Computer Science BA/BS seed requirements',
  declarationCore: [
    '01:640:151 Calculus I for Physical Science Majors',
    '01:640:152 Calculus II for Physical Science Majors',
    '01:198:111 Introduction to Computer Science',
    '01:198:112 Data Structures',
    '01:198:205 Introduction to Discrete Structures I'
  ],
  math: [
    '01:640:151 Calculus I',
    '01:640:152 Calculus II',
    '01:640:250 Linear Algebra'
  ],
  electives: [
    '5 total designated CS electives',
    'At least 3 electives must be 01:198:xxx New Brunswick CS courses',
    'At least 2 New Brunswick CS electives must be 300+ level',
    'Electives must be taken within 10 years of graduation'
  ],
  bsScience: [
    'Physics sequence option: 01:750:203, 204, 205, 206 or approved alternatives',
    'Chemistry sequence option: 01:160:159, 160, 171 or approved alternatives',
    'BS students pick physics or chemistry sequence, not both'
  ],
  residencyAndGrades: [
    'At least 7 total required/elective 01:198:xxx courses must be taken at Rutgers New Brunswick',
    'No more than 1 grade of D can count toward the major',
    'A D cannot satisfy a prerequisite'
  ]
};

const COURSE_SEED = [
  {
    code: '01:198:111',
    name: 'Introduction to Computer Science',
    type: 'core',
    level: 100,
    tags: ['intro', 'java', 'programming', 'cs major declaration'],
    notes: 'Required CS core course. Usually taken before Data Structures.'
  },
  {
    code: '01:198:112',
    name: 'Data Structures',
    type: 'core',
    level: 100,
    tags: ['data structures', 'algorithms', 'java', 'cs major declaration'],
    prereqs: ['01:198:111'],
    notes: 'Required CS core course and a prerequisite for many upper-level CS electives.'
  },
  {
    code: '01:198:205',
    name: 'Introduction to Discrete Structures I',
    type: 'core',
    level: 200,
    tags: ['discrete math', 'proofs', 'logic', 'counting', 'cs major declaration'],
    notes: 'Required CS core course. Important for algorithms, theory, and AI/ML foundations.'
  },
  {
    code: '01:640:151',
    name: 'Calculus I for Physical Science Majors',
    type: 'math',
    level: 100,
    tags: ['calculus', 'math', 'cs major declaration'],
    notes: 'Required for CS BA/BS declaration path.'
  },
  {
    code: '01:640:152',
    name: 'Calculus II for Physical Science Majors',
    type: 'math',
    level: 100,
    tags: ['calculus', 'math', 'cs major declaration'],
    prereqs: ['01:640:151'],
    notes: 'Required math course for CS BA/BS.'
  },
  {
    code: '01:640:250',
    name: 'Linear Algebra',
    type: 'math',
    level: 200,
    tags: ['linear algebra', 'math', 'machine learning', 'data science', 'ai'],
    prereqs: ['01:640:152'],
    notes: 'Required math course. Highly relevant for AI, ML, graphics, optimization, and data science.'
  },
  {
    code: '01:198:206',
    name: 'Introduction to Discrete Structures II',
    type: 'cs elective/foundation',
    level: 200,
    tags: ['discrete math', 'theory', 'probability', 'algorithms'],
    prereqs: ['01:198:205'],
    notes: 'Useful for theory-heavy CS paths and algorithms preparation.'
  },
  {
    code: '01:198:211',
    name: 'Computer Architecture',
    type: 'cs core/foundation',
    level: 200,
    tags: ['systems', 'architecture', 'c', 'hardware'],
    prereqs: ['01:198:112'],
    notes: 'Useful for systems, low-level programming, embedded work, and OS preparation.'
  },
  {
    code: '01:198:213',
    name: 'Software Methodology',
    type: 'cs elective/foundation',
    level: 200,
    tags: ['software engineering', 'java', 'oop', 'full stack'],
    prereqs: ['01:198:112'],
    notes: 'Useful for full-stack/product engineering because it builds larger software design habits.'
  },
  {
    code: '01:198:214',
    name: 'Systems Programming',
    type: 'cs elective/foundation',
    level: 200,
    tags: ['systems', 'c', 'unix', 'memory', 'processes'],
    prereqs: ['01:198:211'],
    notes: 'Useful for systems, infrastructure, performance, and operating systems preparation.'
  },
  {
    code: '01:198:336',
    name: 'Principles of Information and Data Management',
    type: 'cs elective',
    level: 300,
    tags: ['databases', 'sql', 'data engineering', 'backend', 'full stack'],
    prereqs: ['01:198:112'],
    notes: 'High-ROI course for backend, full-stack, data engineering, and product work.'
  },
  {
    code: '01:198:344',
    name: 'Design and Analysis of Computer Algorithms',
    type: 'cs elective',
    level: 300,
    tags: ['algorithms', 'interview prep', 'theory'],
    prereqs: ['01:198:112', '01:198:205'],
    notes: 'Important for technical interviews and algorithmic thinking. Usually workload-heavy.'
  },
  {
    code: '01:198:352',
    name: 'Internet Technology',
    type: 'cs elective',
    level: 300,
    tags: ['web', 'networking', 'full stack', 'internet'],
    prereqs: ['01:198:112'],
    notes: 'Relevant for web engineering and full-stack systems.'
  },
  {
    code: '01:198:440',
    name: 'Introduction to Artificial Intelligence',
    type: 'cs elective',
    level: 400,
    tags: ['ai', 'search', 'planning', 'agents', 'machine learning'],
    prereqs: ['01:198:112', '01:198:205'],
    notes: 'Good fit for AI-agent, ML, and decision-support interests.'
  },
  {
    code: '01:198:439',
    name: 'Introduction to Data Science',
    type: 'cs elective',
    level: 400,
    tags: ['data science', 'machine learning', 'statistics', 'python'],
    notes: 'Relevant for data science and ML-oriented planning.'
  },
  {
    code: '01:198:416',
    name: 'Operating Systems Design',
    type: 'cs elective',
    level: 400,
    tags: ['operating systems', 'systems', 'concurrency', 'threads', 'memory'],
    prereqs: ['01:198:214'],
    notes: 'Strong signal for systems, infra, and backend roles. Usually workload-heavy.'
  }
];

const CAREER_GUIDES = [
  {
    goal: 'full-stack engineering',
    recommended: ['01:198:213', '01:198:336', '01:198:352', '01:198:344'],
    reasoning: 'Software Methodology, databases, web/internet tech, and algorithms map cleanly to product engineering.'
  },
  {
    goal: 'data engineering',
    recommended: ['01:198:336', '01:640:250', '01:198:439', '01:198:344'],
    reasoning: 'Databases, linear algebra, data science, and algorithms support ETL, analytics, and scalable data systems.'
  },
  {
    goal: 'ai or machine learning',
    recommended: ['01:640:250', '01:198:440', '01:198:439', '01:198:344'],
    reasoning: 'Linear algebra, AI, data science, and algorithms are the cleanest seed path for AI/ML.'
  },
  {
    goal: 'systems or infrastructure',
    recommended: ['01:198:211', '01:198:214', '01:198:416', '01:198:344'],
    reasoning: 'Architecture, systems programming, OS, and algorithms build the base for lower-level engineering.'
  }
];

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9:]+/g, ' ').trim();
}

function tokenize(text) {
  return normalize(text).split(/\s+/).filter((token) => token.length > 1);
}

function scoreCourse(course, queryTokens, normalizedQuery) {
  const haystack = normalize([
    course.code,
    course.name,
    course.type,
    course.notes,
    course.tags?.join(' '),
    course.prereqs?.join(' ')
  ].join(' '));

  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1;
    if (course.code.toLowerCase().includes(token)) score += 3;
  }

  if (normalizedQuery.includes(course.code.toLowerCase())) score += 8;
  if (normalizedQuery.includes(normalize(course.name))) score += 6;
  return score;
}

function searchCourses(query, limit = 8) {
  const normalizedQuery = normalize(query);
  const tokens = tokenize(query);

  if (!tokens.length) return [];

  const ranked = COURSE_SEED
    .map((course) => ({ course, score: scoreCourse(course, tokens, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.course.code.localeCompare(b.course.code))
    .slice(0, limit)
    .map((item) => item.course);

  logger.debug('Course search completed', { query, found: ranked.length });
  return ranked;
}

function findCareerGuides(query) {
  const normalizedQuery = normalize(query);
  return CAREER_GUIDES.filter((guide) => {
    const guideText = normalize(`${guide.goal} ${guide.recommended.join(' ')} ${guide.reasoning}`);
    return guideText.split(' ').some((token) => normalizedQuery.includes(token));
  });
}

function formatCourse(course) {
  const prereqs = course.prereqs?.length ? `Prereqs: ${course.prereqs.join(', ')}` : null;
  const tags = course.tags?.length ? `Tags: ${course.tags.join(', ')}` : null;
  return [
    `**${course.code} ${course.name}**`,
    `Type: ${course.type}`,
    prereqs,
    tags,
    course.notes
  ].filter(Boolean).join('\n  ');
}

function buildCourseContext(query) {
  const matches = searchCourses(query);
  const careerGuides = findCareerGuides(query);

  const sections = [];

  sections.push(`## Seed CS Requirements\nProgram: ${REQUIREMENTS.program}\n\nDeclaration core:\n- ${REQUIREMENTS.declarationCore.join('\n- ')}\n\nMath:\n- ${REQUIREMENTS.math.join('\n- ')}\n\nElective rules:\n- ${REQUIREMENTS.electives.join('\n- ')}\n\nResidency and grade rules:\n- ${REQUIREMENTS.residencyAndGrades.join('\n- ')}`);

  if (matches.length > 0) {
    sections.push(`## Relevant Seed Courses\n${matches.map(formatCourse).join('\n\n')}`);
  }

  if (careerGuides.length > 0) {
    const lines = careerGuides.map((guide) => {
      return `**${guide.goal}**\nRecommended seed path: ${guide.recommended.join(', ')}\nReasoning: ${guide.reasoning}`;
    });
    sections.push(`## Career-Oriented Seed Guidance\n${lines.join('\n\n')}`);
  }

  sections.push('## Data freshness note\nThis MVP seed layer does not check live WebReg open seats, live professor assignments, or RateMyProfessor. For those, answer with a clear caveat and suggest checking the official source until the integrations are added.');

  return sections.join('\n\n---\n\n');
}

module.exports = {
  REQUIREMENTS,
  COURSE_SEED,
  CAREER_GUIDES,
  searchCourses,
  buildCourseContext
};
