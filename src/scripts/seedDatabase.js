// src/scripts/seedDatabase.js
// Run with: node src/scripts/seedDatabase.js
// Make sure your .env is filled in before running.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

//course catalog
const courseCatalog = [
  {
    content: 'CS 111 | Introduction to Computer Science | prereqs: none | 4 credits | description: Introduction to programming concepts. Required to declare the CS major with a grade of C or better.',
    metadata: { code: 'CS111', credits: 4, track: 'core' }
  },
  {
    content: 'CS 112 | Data Structures | prereqs: CS 111 | 4 credits | description: Arrays, linked lists, trees, graphs, sorting and searching algorithms. Required to declare the CS major with a grade of C or better.',
    metadata: { code: 'CS112', credits: 4, track: 'core' }
  },
  {
    content: 'CS 205 | Introduction to Discrete Structures I | prereqs: CS 111 | 4 credits | description: Logic, sets, functions, relations, and combinatorics. Required to declare the CS major with a grade of C or better.',
    metadata: { code: 'CS205', credits: 4, track: 'core' }
  },
  {
    content: 'CS 206 | Discrete Structures II | prereqs: CS 205 | 4 credits | description: Graph theory, trees, probability, and formal languages. Required to graduate.',
    metadata: { code: 'CS206', credits: 4, track: 'core' }
  },
  {
    content: 'CS 211 | Computer Architecture | prereqs: CS 112 | 4 credits | description: Digital logic, processor design, memory hierarchy, and assembly language. Required to graduate.',
    metadata: { code: 'CS211', credits: 4, track: 'core' }
  },
  {
    content: 'CS 344 | Design and Analysis of Algorithms | prereqs: CS 112, CS 206, MATH 250 | 4 credits | description: Algorithm design techniques: divide-and-conquer, dynamic programming, greedy algorithms, graph algorithms, NP-completeness. Required to graduate.',
    metadata: { code: 'CS344', credits: 4, track: 'core' }
  },
  {
    content: 'CS 210 | Data Management for Data Science | prereqs: CS 111 | 4 credits | description: Databases and data management concepts for data science applications.',
    metadata: { code: 'CS210', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 213 | Software Methodology | prereqs: CS 112 | 4 credits | description: Software design principles, design patterns, testing, and version control.',
    metadata: { code: 'CS213', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 214 | Systems Programming | prereqs: CS 211 | 4 credits | description: C programming, memory management, processes, and systems-level programming.',
    metadata: { code: 'CS214', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 314 | Principles of Programming Languages | prereqs: CS 112, CS 205 | 4 credits | description: Programming language design, type systems, functional programming, and language semantics.',
    metadata: { code: 'CS314', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 323 | Numerical Analysis and Computing | prereqs: MATH 250, CS 112 | 4 credits | description: Numerical methods for solving mathematical problems computationally.',
    metadata: { code: 'CS323', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 324 | Numerical Methods | prereqs: CS 323 | 4 credits | description: Advanced numerical methods including interpolation, integration, and differential equations.',
    metadata: { code: 'CS324', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 334 | Intro to Imaging and Multimedia | prereqs: CS 112, MATH 250 | 4 credits | description: Image processing, multimedia systems, and computer graphics fundamentals.',
    metadata: { code: 'CS334', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 336 | Principles of Information and Data Management | prereqs: CS 112, CS 205 | 4 credits | description: Relational databases, SQL, query optimization, and data modeling.',
    metadata: { code: 'CS336', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 352 | Internet Technology | prereqs: CS 211, CS 206 | 4 credits | description: Networking protocols, TCP/IP, HTTP, distributed systems, and web technologies.',
    metadata: { code: 'CS352', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 415 | Compilers | prereqs: CS 344, CS 314 | 4 credits | description: Lexical analysis, parsing, semantic analysis, code generation, and optimization.',
    metadata: { code: 'CS415', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 416 | Operating Systems Design | prereqs: CS 214, CS 352 | 4 credits | description: Process management, memory management, file systems, concurrency, and OS design.',
    metadata: { code: 'CS416', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 417 | Distributed Systems | prereqs: CS 352 | 4 credits | description: Distributed computing, consistency, fault tolerance, and cloud systems.',
    metadata: { code: 'CS417', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 419 | Computer Security | prereqs: CS 211, CS 352 | 4 credits | description: Cryptography, network security, software security, and security principles.',
    metadata: { code: 'CS419', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 424 | Modeling and Simulation of Continuous Systems | prereqs: CS 323 | 4 credits | description: Simulation methods for continuous systems and differential equations.',
    metadata: { code: 'CS424', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 425 | Brain-Inspired Computing | prereqs: CS 206, MATH 250 | 4 credits | description: Neural computing models inspired by biological brain architectures.',
    metadata: { code: 'CS425', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 428 | Intro to Computer Graphics | prereqs: CS 205, MATH 250 | 4 credits | description: 3D graphics pipeline, rasterization, shading, and rendering techniques.',
    metadata: { code: 'CS428', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 431 | Software Engineering | prereqs: CS 213 | 4 credits | description: Software development processes, requirements, architecture, and project management.',
    metadata: { code: 'CS431', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 437 | Database Systems Implementation | prereqs: CS 336 | 4 credits | description: Internals of database systems: storage, indexing, query processing, and transactions.',
    metadata: { code: 'CS437', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 439 | Intro to Data Science | prereqs: CS 205 | 4 credits | description: Data analysis, machine learning basics, and data visualization.',
    metadata: { code: 'CS439', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 440 | Introduction to Artificial Intelligence | prereqs: CS 205 | 4 credits | description: Search, knowledge representation, reasoning, planning, and machine learning fundamentals.',
    metadata: { code: 'CS440', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 452 | Formal Languages and Automata | prereqs: CS 206, CS 344 | 4 credits | description: Finite automata, regular languages, context-free grammars, Turing machines, and computability.',
    metadata: { code: 'CS452', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 460 | Introduction to Computational Robotics | prereqs: CS 112, MATH 250 | 4 credits | description: Motion planning, kinematics, and algorithms for robotic systems.',
    metadata: { code: 'CS460', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 461 | ML Principles | prereqs: CS 344, MATH 250 | 4 credits | description: Foundations of machine learning: supervised, unsupervised learning, and statistical methods.',
    metadata: { code: 'CS461', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 462 | Introduction to Deep Learning | prereqs: CS 461 | 4 credits | description: Neural networks, backpropagation, CNNs, RNNs, and deep learning applications.',
    metadata: { code: 'CS462', credits: 4, track: 'elective' }
  },
  {
    content: 'CS 463 | Design and Analysis of Randomized Algorithms | prereqs: CS 344, CS 206 | 4 credits | description: Randomized algorithm design, probabilistic analysis, and applications.',
    metadata: { code: 'CS463', credits: 4, track: 'elective' }
  },
  {
    content: 'MATH 151 | Calculus I for Physical Science Majors | prereqs: MATH 112 or precalculus | 4 credits | description: Limits, derivatives, and integrals. Required to declare the CS major with a grade of C or better.',
    metadata: { code: 'MATH151', credits: 4, track: 'math' }
  },
  {
    content: 'MATH 152 | Calculus II for Physical Science Majors | prereqs: MATH 151 | 4 credits | description: Integration techniques, series, and multivariable calculus intro. Required to declare the CS major with a grade of C or better.',
    metadata: { code: 'MATH152', credits: 4, track: 'math' }
  },
  {
    content: 'MATH 250 | Linear Algebra | prereqs: MATH 152 | 3 credits | description: Vectors, matrices, linear transformations, eigenvalues, and eigenvectors.',
    metadata: { code: 'MATH250', credits: 3, track: 'math' }
  }
];

//degree reqs

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
    content: 'CS BA 4-Year Sample Schedule. Year 2 Fall (15 credits): CS 205 Discrete Structures I (4), CS 211 Computer Architecture (4), MATH 250 Linear Algebra (3), general elective (4*). Year 2 Spring (15 credits): CS 206 Discrete Structures II (4), CS elective I (4), general elective (4*), general elective (3). Total after Year 2: 60 credits.',
    metadata: { track: 'BA', label: 'BA Year 2', year: 2 }
  },
  {
    content: 'CS BA 4-Year Sample Schedule. Year 3 Fall (15 credits): CS 344 Design and Analysis of Algorithms (4), CS elective II (4*), general elective (4*), general elective (3). Year 3 Spring (15 credits): CS elective III (4), CS elective IV (4), general elective (4*), general elective (3). Total after Year 3: 90 credits.',
    metadata: { track: 'BA', label: 'BA Year 3', year: 3 }
  },
  {
    content: 'CS BA 4-Year Sample Schedule. Year 4 Fall (15 credits): CS elective V (4), general elective (4), general elective (4*), general elective (3). Year 4 Spring (15 credits): general elective (4*), general elective (4*), general elective (4*), general elective (3). Total after Year 4: 120 credits.',
    metadata: { track: 'BA', label: 'BA Year 4', year: 4 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 1 Fall (15 credits): MATH 151 Calculus I (4), CS 111 Intro to CS (4), SAS signature or general elective (3), general elective (3), Byrne seminar (1). Year 1 Spring (15 credits): MATH 152 Calculus II (4), CS 112 Data Structures (4), general elective (3), general elective (3), Byrne seminar (1). Total after Year 1: 30 credits.',
    metadata: { track: 'BS', label: 'BS Year 1', year: 1 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 2 Fall (15 credits): CS 205 Discrete Structures I (4), CS 211 Computer Architecture (4), MATH 250 Linear Algebra (3), general elective (4*). Year 2 Spring (15 credits): CS 206 Discrete Structures II (4), CS elective I (4), general elective (4*), general elective (3). Total after Year 2: 60 credits.',
    metadata: { track: 'BS', label: 'BS Year 2', year: 2 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 3 Fall (15 credits): CS 344 Design and Analysis of Algorithms (4), CS elective II (4*), general elective (4*), general elective (3). Year 3 Spring (15 credits): CS elective III (4), CS elective IV (4), general elective (4*), general elective (3). Total after Year 3: 90 credits.',
    metadata: { track: 'BS', label: 'BS Year 3', year: 3 }
  },
  {
    content: 'CS BS 4-Year Sample Schedule. Year 4 Fall (15 credits): CS elective V (4), CS elective VI (4), general elective (4*), general elective (3). Year 4 Spring (15 credits): CS elective VII (4), general elective (4), general elective (4*), general elective (3). Total after Year 4: 120 credits.',
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

//main seed function

async function seed() {
  console.log('Starting database seed...\n');

  console.log(`Seeding course_catalog (${courseCatalog.length} courses)...`);
  for (const row of courseCatalog) {
    await insertWithEmbedding('course_catalog', row.content, row.metadata);
  }

  console.log(`\nSeeding degree_requirements (${degreeRequirements.length} entries)...`);
  for (const row of degreeRequirements) {
    await insertWithEmbedding('degree_requirements', row.content, row.metadata);
  }

  console.log(`\nSeeding roadmaps (${roadmaps.length} entries)...`);
  for (const row of roadmaps) {
    await insertWithEmbedding('roadmaps', row.content, row.metadata);
  }

  console.log('\nDone! webreg table is left empty — populate it each semester with live section data.');
}

seed().catch(console.error);