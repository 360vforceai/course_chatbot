// src/scripts/seedDatabase.js
// Run with: node src/scripts/seedDatabase.js
// Make sure your .env is filled in before running.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── SOC API Config ────────────────────────────────────────────────────────────
// change these each semester as needed
const SOC_YEAR = '2026';
const SOC_TERM = '1'; // 1=Spring, 7=Summer, 9=Fall, 0=Winter
const SOC_CAMPUS = 'NB';
const CS_SUBJECT = '198'; // rutgers CS department code
const SOC_BATCH_SIZE = 10; // courses to embed per batch, keep low to avoid rate limits

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

// small delay to avoid hitting openai rate limits between batches
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── SOC API: fetch and format live CS courses ─────────────────────────────────

// formats a raw SOC API course object into the embedding text format
// that courseClient.js expects for vector search
function formatCourseText(course) {
  const code = `CS ${course.courseNumber}`;
  const title = course.expandedTitle || course.title || 'No title';
  const prereqs = course.preReqNotes
    ? `prereqs: ${course.preReqNotes.replace(/<[^>]+>/g, '').trim()}`
    : 'prereqs: none';
  const credits = course.creditsObject?.description || `${course.credits} credits`;
  const description = course.courseDescription
    ? `description: ${course.courseDescription.replace(/<[^>]+>/g, '').trim()}`
    : 'description: not available';
  return `${code} | ${title} | ${prereqs} | ${credits} | ${description}`;
}

// fetches all CS courses from the Rutgers SOC API and inserts them into course_catalog
async function seedCourseCatalogFromAPI() {
  const url = `https://sis.rutgers.edu/soc/api/courses.json?year=${SOC_YEAR}&term=${SOC_TERM}&campus=${SOC_CAMPUS}`;
  console.log(`Fetching courses from SOC API...`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`SOC API request failed: ${res.status}`);
    return;
  }

  const allCourses = await res.json();
  console.log(`Total courses returned by API: ${allCourses.length}`);

  // filter to only CS courses (subject 198), skip everything else like arabic, middle east etc
  const csCourses = allCourses.filter((c) => c.subject === CS_SUBJECT);
  console.log(`CS courses found (subject 198): ${csCourses.length}`);

  if (csCourses.length === 0) {
    console.error('No CS courses found, check subject filter or API response');
    return;
  }

  let inserted = 0;
  let failed = 0;

  // process in batches to avoid openai rate limits
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

    // wait 1 second between batches to avoid rate limits
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

// ── Main seed function ────────────────────────────────────────────────────────

async function seed() {
  console.log('Starting database seed...\n');

  // course catalog: fetched live from the SOC API instead of hardcoded
  console.log(`Seeding course_catalog from Rutgers SOC API (Spring ${SOC_YEAR})...`);
  await seedCourseCatalogFromAPI();

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