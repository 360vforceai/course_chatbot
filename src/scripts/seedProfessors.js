// src/scripts/seedProfessors.js
// Manually seeds professor_reviews table with Rutgers CS professor data from RMP.
// Add more professors to the PROFESSORS array as needed.
// Run with: node src/scripts/seedProfessors.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Professor data ─────────────────────────────────────────────────────────────
// To add a professor:
//   1. Go to https://www.ratemyprofessors.com/search/professors/825?q=LASTNAME
//   2. Find the correct professor and fill in the fields below
//   3. Run the script again (it skips duplicates by last name)
//
// Fields:
//   firstName, lastName   — exact name as shown on RMP
//   avgRating             — out of 5.0
//   avgDifficulty         — out of 5.0
//   wouldTakeAgainPercent — 0-100, or -1 if not shown
//   numRatings            — total number of ratings
//   department            — as listed on RMP
//   tags                  — top student tags from their RMP page
//   sampleComment         — one representative student comment

const PROFESSORS = [
  {
    firstName: 'Andrew',
    lastName: 'Tjang',
    avgRating: 4.8,
    avgDifficulty: 4.1,
    wouldTakeAgainPercent: 95,
    numRatings: 45,
    department: 'Computer Science',
    tags: ['Caring', 'Respected', 'Gives good feedback', 'Accessible outside class'],
    sampleComment: 'One of the best CS professors at Rutgers. Very clear lectures and genuinely cares about students understanding the material.'
  },
  {
    firstName: 'Ana Paula',
    lastName: 'Centeno',
    avgRating: 4.0,
    avgDifficulty: 3.0,
    wouldTakeAgainPercent: 79,
    numRatings: 150,
    department: 'Computer Science',
    tags: ['Caring', 'Clear grading criteria', 'Accessible outside class', 'Would take again'],
    sampleComment: 'Unless you are completely new to programming, these classes aren\'t difficult. Very approachable professor.'
  },
  {
    firstName: 'Ivan',
    lastName: 'Marsic',
    avgRating: 3.2,
    avgDifficulty: 3.8,
    wouldTakeAgainPercent: 55,
    numRatings: 89,
    department: 'Electrical and Computer Engineering',
    tags: ['Lots of homework', 'Test heavy', 'Lecture heavy', 'Accessible outside class'],
    sampleComment: 'Lectures can be hard to follow but office hours are helpful. Exams are straight from the lecture material.'
  },
  {
    firstName: 'Mubbasir',
    lastName: 'Kapadia',
    avgRating: 3.5,
    avgDifficulty: 3.2,
    wouldTakeAgainPercent: 65,
    numRatings: 42,
    department: 'Computer Science',
    tags: ['Accessible outside class', 'Caring', 'Lots of homework'],
    sampleComment: 'Interesting course content. Projects are heavy but you learn a lot.'
  },
  {
    firstName: 'David',
    lastName: 'Menendez',
    avgRating: 3.8,
    avgDifficulty: 3.5,
    wouldTakeAgainPercent: 72,
    numRatings: 63,
    department: 'Computer Science',
    tags: ['Clear grading criteria', 'Accessible outside class', 'Test heavy'],
    sampleComment: 'Fair grader, exams are challenging but the material is taught well.'
  },
  {
    firstName: 'Viswanathan',
    lastName: 'Swaminathan',
    avgRating: 3.6,
    avgDifficulty: 3.4,
    wouldTakeAgainPercent: 68,
    numRatings: 38,
    department: 'Computer Science',
    tags: ['Helpful', 'Accessible outside class', 'Lots of homework'],
    sampleComment: 'Good professor, goes through material at a fast pace but is always willing to help during office hours.'
  },
  {
    firstName: 'Abhishek',
    lastName: 'Bhatt',
    avgRating: 3.9,
    avgDifficulty: 3.1,
    wouldTakeAgainPercent: 75,
    numRatings: 28,
    department: 'Computer Science',
    tags: ['Caring', 'Clear grading criteria', 'Accessible outside class'],
    sampleComment: 'Very approachable and explains concepts clearly. Would recommend.'
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function embed(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return res.data[0].embedding;
}

function formatContent(prof) {
  const rating = prof.avgRating.toFixed(1);
  const difficulty = prof.avgDifficulty.toFixed(1);
  const wouldTakeAgain = prof.wouldTakeAgainPercent >= 0
    ? `${prof.wouldTakeAgainPercent}%`
    : 'N/A';

  return [
    `Professor ${prof.firstName} ${prof.lastName} | Dept: ${prof.department}`,
    `Rating: ${rating}/5 | Difficulty: ${difficulty}/5 | Would Take Again: ${wouldTakeAgain} | ${prof.numRatings} ratings`,
    prof.tags.length > 0 ? `Tags: ${prof.tags.join(', ')}` : '',
    prof.sampleComment ? `Student comments: "${prof.sampleComment}"` : ''
  ].filter(Boolean).join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`Seeding ${PROFESSORS.length} professors into professor_reviews...\n`);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const prof of PROFESSORS) {
    try {
      // Check if already exists by last name to avoid duplicates
      const { data: existing } = await supabase
        .from('professor_reviews')
        .select('id')
        .ilike('metadata->>last_name', prof.lastName)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`  → Skipped (already exists): ${prof.firstName} ${prof.lastName}`);
        skipped++;
        continue;
      }

      const content = formatContent(prof);
      const embedding = await embed(content);

      const { error } = await supabase.from('professor_reviews').insert({
        content,
        embedding,
        metadata: {
          first_name: prof.firstName,
          last_name: prof.lastName,
          avg_rating: prof.avgRating,
          avg_difficulty: prof.avgDifficulty,
          num_ratings: prof.numRatings,
          department: prof.department
        }
      });

      if (error) {
        console.error(`  ✗ Failed: ${prof.firstName} ${prof.lastName} —`, error.message);
        failed++;
      } else {
        console.log(`  ✓ Inserted: ${prof.firstName} ${prof.lastName} (${prof.avgRating}/5, ${prof.numRatings} ratings)`);
        inserted++;
      }

      await sleep(300);
    } catch (err) {
      console.error(`  ✗ Error for ${prof.firstName} ${prof.lastName}:`, err.message);
      failed++;
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log('\nTo add more professors, edit the PROFESSORS array in this file and run again.');
  console.log('Look up ratings at: https://www.ratemyprofessors.com/search/professors/825');
}

seed().catch(console.error);