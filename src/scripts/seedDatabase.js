// src/scripts/seedDatabase.js
// Run with: node src/scripts/seedDatabase.js
// Make sure your .env is filled in before running.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── SOC API Config ────────────────────────────────────────────────────────────
const SOC_YEAR = '2026';
const SOC_TERM = '9';        // 1=Spring, 7=Summer, 9=Fall — must match courseClient.js CURRENT_TERM
const SOC_CAMPUS = 'NB';
const CS_SUBJECT = '198';
const SOC_BATCH_SIZE = 10;

// ── Hardcoded CS course descriptions ─────────────────────────────────────────
// The Rutgers SOC API does not return course descriptions.
// These are pulled from the official Rutgers CS course catalog:
// https://www.cs.rutgers.edu/academics/undergraduate/course-synopses
//
// To add a missing course: look it up at the URL above and add an entry here.
// Key is the 3-digit course number as a string.

const CS_DESCRIPTIONS = {
  '101': 'Introduction to computing, algorithmic thinking, and problem solving. Covers basic programming concepts using Python. No prior programming experience required.',
  '105': 'Great Ideas in Computing covers major concepts and milestones in the history and future of computing, including algorithms, data, AI, and societal impacts.',
  '107': 'Introduction to computer science for non-majors. Covers programming basics, data structures, and computational thinking.',
  '111': 'Introduction to computer science. Covers object-oriented programming, recursion, and algorithm design using Java. Required to declare the CS major.',
  '112': 'Data structures including arrays, linked lists, stacks, queues, trees, and graphs. Sorting and searching algorithms. Prerequisite for most upper-division CS courses.',
  '170': 'Computing for Math and Sciences. Covers computational tools and programming concepts relevant to scientific computing.',
  '198': 'Independent study in computer science under faculty supervision.',
  '205': 'Discrete structures for computer science. Logic, sets, functions, relations, induction, and combinatorics. Required to declare the CS major.',
  '206': 'Discrete structures II. Graph theory, trees, combinatorics, probability, and their applications to algorithms and computer science.',
  '207': 'Introduction to Internet Technology. Covers web fundamentals, networking basics, and internet protocols.',
  '210': 'Data management for data science. Covers relational databases, SQL, and data wrangling techniques.',
  '211': 'Computer architecture. Digital logic, processor design, memory hierarchy, assembly language, and systems programming in C.',
  '213': 'Software methodology. Object-oriented design, design patterns, Android development, and software engineering principles.',
  '214': 'Systems programming in C. Memory management, processes, threads, synchronization, and introduction to operating systems concepts.',
  '291': 'Principles of programming languages. Language paradigms, syntax, semantics, type systems, and implementation.',
  '314': 'Principles of programming languages. Formal grammars, parsing, type systems, functional and logic programming.',
  '323': 'Numerical analysis. Floating point arithmetic, root finding, interpolation, numerical integration, and solutions to linear systems.',
  '334': 'Introduction to imaging and multimedia. Image processing, computer graphics, video, and audio fundamentals.',
  '336': 'Principles of information and data management. Relational databases, SQL, query optimization, transactions, and NoSQL.',
  '344': 'Design and analysis of computer algorithms. Divide-and-conquer, dynamic programming, greedy algorithms, graph algorithms, and NP-completeness.',
  '352': 'Internet technology. Network protocols, TCP/IP, sockets programming, HTTP, and distributed systems fundamentals.',
  '354': 'Internet Technology advanced topics including security, performance, and modern web architectures.',
  '356': 'Numerical analysis II. Differential equations, eigenvalue problems, and advanced numerical methods.',
  '415': 'Compiler design. Lexical analysis, parsing, semantic analysis, code generation, and optimization.',
  '416': 'Operating systems design. Processes, threads, scheduling, memory management, file systems, and synchronization.',
  '417': 'Distributed systems. Distributed computing models, consistency, fault tolerance, and cloud computing.',
  '419': 'Computer security. Cryptography, network security, software vulnerabilities, access control, and security engineering.',
  '424': 'Wireless and mobile systems. Wireless protocols, mobile networking, and IoT systems.',
  '425': 'Brain-inspired computing. Neural networks, neuromorphic architectures, and biologically-inspired algorithms.',
  '431': 'Computer graphics. 3D rendering, transformations, shading, ray tracing, and GPU programming.',
  '432': 'Introduction to computer vision. Image processing, feature detection, object recognition, and deep learning for vision.',
  '435': 'Introduction to computational robotics. Robot kinematics, motion planning, sensing, and control.',
  '437': 'Database systems implementation. Storage, indexing, query processing, transactions, and distributed databases.',
  '438': 'Coding theory. Error-correcting codes, information theory, and their applications to communication and storage.',
  '439': 'Introduction to data science. Data wrangling, exploratory analysis, machine learning, and visualization.',
  '440': 'Introduction to artificial intelligence. Search, knowledge representation, planning, reasoning, and machine learning.',
  '443': 'Introduction to computer music. Digital audio, synthesis, sound processing, and music information retrieval.',
  '444': 'Computational biology. Algorithms for sequence alignment, phylogenetics, genome assembly, and bioinformatics.',
  '445': 'Computer science education. Curriculum design, pedagogy, and research in CS education.',
  '452': 'Formal languages and automata. Finite automata, regular expressions, context-free grammars, Turing machines, and computability.',
  '456': 'Compilers II. Advanced topics in compiler construction, optimization, and code generation.',
  '460': 'Computational complexity. Complexity classes, reductions, randomized computation, and approximation algorithms.',
  '461': 'Machine learning principles. Supervised and unsupervised learning, regression, classification, neural networks, and model evaluation.',
  '462': 'Deep learning. Convolutional neural networks, recurrent networks, transformers, and applications to vision and NLP.',
  '463': 'Randomized algorithms. Probabilistic methods, randomized data structures, and applications to algorithm design.',
  '466': 'Natural language processing. Text processing, language models, parsing, and deep learning for NLP.',
  '474': 'Computer networks. Network architecture, protocols, routing, transport layer, and network security.',
  '476': 'Advanced topics in computer security. Penetration testing, reverse engineering, and advanced cryptographic protocols.',
  '490': 'Topics in computer science. Covers advanced or emerging areas of CS not covered in regular courses.',
  '491': 'Honors project in computer science. Independent research under faculty supervision.',
  '492': 'Capstone project in computer science.',
  '496': 'Topics in algorithmic game theory. Strategic decision-making, Nash equilibria, and mechanism design.',
  '503': 'Graduate: Algorithms. Advanced algorithm design and analysis.',
  '504': 'Graduate: Theory of computation.',
  '510': 'Graduate: Computer architecture.',
  '514': 'Graduate: Systems programming.',
  '516': 'Graduate: Operating systems.',
  '519': 'Graduate: Computer security.',
  '536': 'Graduate: Database systems.',
  '540': 'Graduate: Artificial intelligence.',
  '552': 'Graduate: Formal languages and automata.',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function embed(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return res.data[0].embedding;
}

async function insertWithEmbedding(table, content, metadata) {
  const embedding = await embed(content);
  const { error } = await supabase.from(table).insert({ content, metadata, embedding });
  if (error) console.error(`  ✗ Failed (${table}):`, error.message);
  else console.log(`  ✓ Inserted into ${table}:`, metadata.label || metadata.code || metadata.track || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Strip HTML tags and entities from prereq notes
function cleanHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── SOC API: fetch and format live CS courses ─────────────────────────────────

function formatCourseText(course) {
  const code = `CS ${course.courseNumber}`;
  const title = course.expandedTitle || course.title || 'No title';
  const prereqs = course.preReqNotes
    ? `prereqs: ${cleanHtml(course.preReqNotes)}`
    : 'prereqs: none listed';
  const credits = course.creditsObject?.description || `${course.credits || '?'} credits`;

  // Look up description from hardcoded map; fall back to generic message
  const descText = CS_DESCRIPTIONS[course.courseNumber]
    || `${title}. See the Rutgers CS course catalog for full description.`;
  const description = `description: ${descText}`;

  return `${code} | ${title} | ${prereqs} | ${credits} | ${description}`;
}

async function seedCourseCatalogFromAPI() {
  const url = `https://classes.rutgers.edu//soc/api/courses.json?year=${SOC_YEAR}&term=${SOC_TERM}&campus=${SOC_CAMPUS}&subject=${CS_SUBJECT}`;
  console.log(`Fetching CS courses from SOC API (${SOC_YEAR} term ${SOC_TERM})...`);
  console.log(`URL: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`SOC API request failed: ${res.status}`);
    return;
  }

  const allCourses = await res.json();
  const csCourses = allCourses.filter((c) => !c.subject || c.subject === CS_SUBJECT);
  console.log(`CS courses found: ${csCourses.length}`);

  if (csCourses.length === 0) {
    console.error('No CS courses found. Check the API URL.');
    return;
  }

  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < csCourses.length; i += SOC_BATCH_SIZE) {
    const batch = csCourses.slice(i, i + SOC_BATCH_SIZE);
    console.log(`  Processing batch ${Math.floor(i / SOC_BATCH_SIZE) + 1} / ${Math.ceil(csCourses.length / SOC_BATCH_SIZE)}...`);

    const rows = [];

    for (const course of batch) {
      try {
        const content = formatCourseText(course);
        const embedding = await embed(content);
        rows.push({
          content,
          embedding,
          metadata: {
            code: `CS${course.courseNumber}`,
            credits: course.credits,
            courseString: course.courseString,
            title: course.expandedTitle || course.title,
            track: 'soc_import'
          }
        });
      } catch (err) {
        console.error(`  ✗ Failed to embed CS ${course.courseNumber}:`, err.message);
        failed++;
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('course_catalog').insert(rows);
      if (error) {
        console.error('  ✗ Supabase insert error:', error.message);
        failed += rows.length;
      } else {
        inserted += rows.length;
        console.log(`  ✓ Inserted ${rows.length} courses (total: ${inserted})`);
      }
    }

    if (i + SOC_BATCH_SIZE < csCourses.length) {
      await sleep(1000);
    }
  }

  console.log(`  Course catalog done. Inserted: ${inserted}, Failed: ${failed}`);
}

// ── Degree Requirements ───────────────────────────────────────────────────────

const degreeRequirements = [
  {
    content: 'CS Major Declaration Requirements: Students must earn a C or better in all 5 of the following to declare the CS major: MATH 151 (Calculus I), MATH 152 (Calculus II), CS 111 (Intro to CS), CS 112 (Data Structures), CS 205 (Discrete Structures I).',
    metadata: { type: 'declaration', label: 'Major Declaration Requirements' }
  },
  {
    content: 'CS Major Core Courses Required to Graduate: CS 206 (Discrete Structures II), CS 211 (Computer Architecture), CS 344 (Design and Analysis of Algorithms). These must be completed for both BA and BS degrees.',
    metadata: { type: 'core', label: 'Core Graduation Requirements' }
  },
  {
    content: 'CS BA Elective Requirements: 5 electives total from the designated CS elective list. At least 3 must be 01:198:xxx (Rutgers NB CS dept). At least 2 of the NB CS electives must be 300-level or above. All electives must be taken within 10 years of graduation.',
    metadata: { type: 'elective', label: 'BA Elective Requirements' }
  },
  {
    content: 'CS BS Elective Requirements: 7 electives total from the designated CS elective list. At least 3 must be 01:198:xxx (Rutgers NB CS dept). At least 2 of the NB CS electives must be 300-level or above. All electives must be taken within 10 years of graduation.',
    metadata: { type: 'elective', label: 'BS Elective Requirements' }
  },
  {
    content: 'CS BS Science Requirement: Students must complete either Physics OR Chemistry, not both. Physics options: General Physics I & II (750:203/204), Analytical Physics I & II (750:123/124/227/229), Honors Physics I & II (750:271/272/275/276), Extended General Physics (750:201/202), Physics for Sciences (750:193/194). Chemistry options: General Chemistry for Engineers (160:159/160 + lab 171), General Chemistry standard track (160:161/162 + lab 171), Honors General Chemistry (160:163/164 + lab 171).',
    metadata: { type: 'science', label: 'BS Science Requirement' }
  },
  {
    content: 'CS Residency and Grade Rules (BA and BS): At least 7 total courses (required + elective) must be 01:198:xxx taken at Rutgers New Brunswick. No more than 1 grade of D accepted toward the major. A grade of D cannot satisfy a prerequisite — the course must be retaken.',
    metadata: { type: 'residency', label: 'Residency and Grade Rules' }
  },
  {
    content: 'CS Mathematics Requirements: All CS students must complete MATH 151 (Calculus I), MATH 152 (Calculus II), and MATH 250 (Linear Algebra). Calculus I and II are required for major declaration. Linear Algebra is required before many upper-division CS courses.',
    metadata: { type: 'math', label: 'Mathematics Requirements' }
  }
];

// ── Roadmaps ──────────────────────────────────────────────────────────────────

const roadmaps = [
  {
    content: 'CS BA 4-Year Sample Schedule. Year 1 Fall (15 credits): MATH 151 Calculus I (4), CS 111 Intro to CS (4), SAS signature or general elective (3), general elective (3), Byrne seminar (1). Year 1 Spring (15 credits): MATH 152 Calculus II (4), CS 112 Data Structures (4), general elective (3), general elective (3), Byrne seminar (1). Total after Year 1: 30 credits.',
    metadata: { track: 'BA', label: 'BA Year 1', year: 1 }
  },
  {
    content: 'CS BA 4-Year Sample Schedule. Year 2 Fall (15 credits): CS 205 Discrete Structures I (4), CS 211 Computer Architecture (4), MATH 250 Linear Algebra (3), general elective (4). Year 2 Spring (15 credits): CS 206 Discrete Structures II (4), CS elective I (4), general elective (4), general elective (3). Total after Year 2: 60 credits.',
    metadata: { track: 'BA', label: 'BA Year 2', year: 2 }
  },
  {
    content: 'CS BA 4-Year Sample Schedule. Year 3 Fall (15 credits): CS 344 Design and Analysis of Algorithms (4), CS elective II (4), general elective (4), general elective (3). Year 3 Spring (15 credits): CS elective III (4), CS elective IV (4), general elective (4), general elective (3). Total after Year 3: 90 credits.',
    metadata: { track: 'BA', label: 'BA Year 3', year: 3 }
  },
  {
    content: 'CS BA 4-Year Sample Schedule. Year 4 Fall (15 credits): CS elective V (4), general elective (4), general elective (4), general elective (3). Year 4 Spring (15 credits): general elective (4), general elective (4), general elective (4), general elective (3). Total after Year 4: 120 credits.',
    metadata: { track: 'BA', label: 'BA Year 4', year: 4 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 1 Fall (15 credits): MATH 151 Calculus I (4), CS 111 Intro to CS (4), SAS signature or general elective (3), general elective (3), Byrne seminar (1). Year 1 Spring (15 credits): MATH 152 Calculus II (4), CS 112 Data Structures (4), general elective (3), general elective (3), Byrne seminar (1). Total after Year 1: 30 credits.',
    metadata: { track: 'BS', label: 'BS Year 1', year: 1 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 2 Fall (15 credits): CS 205 Discrete Structures I (4), CS 211 Computer Architecture (4), MATH 250 Linear Algebra (3), general elective (4). Year 2 Spring (15 credits): CS 206 Discrete Structures II (4), CS elective I (4), general elective (4), general elective (3). Total after Year 2: 60 credits.',
    metadata: { track: 'BS', label: 'BS Year 2', year: 2 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 3 Fall (15 credits): CS 344 Design and Analysis of Algorithms (4), CS elective II (4), general elective (4), general elective (3). Year 3 Spring (15 credits): CS elective III (4), CS elective IV (4), general elective (4), general elective (3). Total after Year 3: 90 credits.',
    metadata: { track: 'BS', label: 'BS Year 3', year: 3 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 4 Fall (15 credits): CS elective V (4), CS elective VI (4), general elective (4), general elective (3). Year 4 Spring (15 credits): CS elective VII (4), general elective (4), general elective (4), general elective (3). Total after Year 4: 120 credits.',
    metadata: { track: 'BS', label: 'BS Year 4', year: 4 }
  },
  {
    content: 'CS Prereq Chain — Core Path: Start with CS 111 (no prereqs). Then CS 112 (needs CS 111) and MATH 151 concurrently. Then CS 205 (needs CS 111) and MATH 152 (needs MATH 151). Then CS 206 (needs CS 205), CS 211 (needs CS 112), MATH 250 (needs MATH 152). Then CS 344 (needs CS 112, CS 206, MATH 250) — this is the capstone required course.',
    metadata: { track: 'all', label: 'Core Prereq Chain' }
  },
  {
    content: 'CS AI Track recommended electives: CS 440 (Intro to AI, prereqs: CS 205), CS 439 (Intro to Data Science, prereqs: CS 205), CS 461 (ML Principles, prereqs: CS 344, MATH 250), CS 462 (Deep Learning, prereqs: CS 461), CS 425 (Brain-Inspired Computing, prereqs: CS 206, MATH 250), CS 334 (Imaging and Multimedia, prereqs: CS 112, MATH 250).',
    metadata: { track: 'AI', label: 'AI Track Electives' }
  },
  {
    content: 'CS Systems Track recommended electives: CS 214 (Systems Programming, prereqs: CS 211), CS 352 (Internet Technology, prereqs: CS 211, CS 206), CS 416 (Operating Systems, prereqs: CS 214, CS 352), CS 417 (Distributed Systems, prereqs: CS 352), CS 419 (Computer Security, prereqs: CS 211, CS 352), CS 415 (Compilers, prereqs: CS 344, CS 314).',
    metadata: { track: 'systems', label: 'Systems Track Electives' }
  },
  {
    content: 'CS Theory Track recommended electives: CS 344 (Algorithms, required), CS 452 (Formal Languages and Automata, prereqs: CS 206, CS 344), CS 463 (Randomized Algorithms, prereqs: CS 344, CS 206), CS 314 (Programming Languages, prereqs: CS 112, CS 205), CS 323 (Numerical Analysis, prereqs: MATH 250, CS 112).',
    metadata: { track: 'theory', label: 'Theory Track Electives' }
  },
  {
    content: 'CS Data Science Track recommended electives: CS 210 (Data Management for Data Science, prereqs: CS 111), CS 336 (Principles of Information and Data Management, prereqs: CS 112, CS 205), CS 437 (Database Systems Implementation, prereqs: CS 336), CS 439 (Intro to Data Science, prereqs: CS 205), CS 461 (ML Principles, prereqs: CS 344, MATH 250).',
    metadata: { track: 'data science', label: 'Data Science Track Electives' }
  }
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Starting database seed...\n');

  console.log(`Seeding course_catalog from Rutgers SOC API (${SOC_YEAR} term ${SOC_TERM})...`);
  await seedCourseCatalogFromAPI();

  console.log(`\nSeeding degree_requirements (${degreeRequirements.length} entries)...`);
  for (const row of degreeRequirements) {
    await insertWithEmbedding('degree_requirements', row.content, row.metadata);
  }

  console.log(`\nSeeding roadmaps (${roadmaps.length} entries)...`);
  for (const row of roadmaps) {
    await insertWithEmbedding('course_roadmaps', row.content, row.metadata);
  }

  console.log('\nDone! webreg table is left empty — live data comes from the SOC API via /snipe and /rmp.');
}

seed().catch(console.error);