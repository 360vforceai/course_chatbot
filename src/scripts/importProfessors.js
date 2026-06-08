// src/scripts/importProfessors.js
// Imports rutgers_professors_with_courses.csv into the professor_reviews table.
// Run with: node src/scripts/importProfessors.js
//
// Put the CSV file in the same directory as this script, or update CSV_PATH below.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Config ────────────────────────────────────────────────────────────────────

// Path to the CSV — put it next to this script or change this path
const CSV_PATH = path.join(__dirname, 'rutgers_professors_with_courses.csv');

// Only import professors from these departments — keeps the table focused
// Set to null to import ALL ~3000 professors (much slower, uses more embeddings)
const DEPARTMENT_FILTER = null;

// Batch size for Supabase inserts
const BATCH_SIZE = 10;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── CSV parser ────────────────────────────────────────────────────────────────
// Handles quoted fields with commas and escaped quotes inside values

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h.trim()] = (values[i] || '').trim();
    });
    return obj;
  });
}

// ── Format content for embedding ─────────────────────────────────────────────

function formatContent(row) {
  const name = row['Name'] || 'Unknown';
  const dept = row['Department'] || 'Unknown';
  const rating = parseFloat(row['Rating']) || 0;
  const difficulty = parseFloat(row['Difficulty']) || 0;
  const wouldTakeAgain = parseFloat(row['Would Take Again %']) || -1;
  const numRatings = parseInt(row['Total Ratings']) || 0;
  const courses = row['Courses Taught'] || '';
  const review1 = row['Review 1'] || '';
  const review2 = row['Review 2'] || '';
  const review3 = row['Review 3'] || '';

  // Parse course codes — filter out noise (only keep codes that look like real course identifiers)
  const courseCodes = courses
    .split('|')
    .filter(c => c.length >= 3 && c.length <= 20)
    .slice(0, 20) // cap at 20 to keep content size reasonable
    .join(', ');

  const wouldTakeAgainStr = wouldTakeAgain >= 0
    ? `${Math.round(wouldTakeAgain)}%`
    : 'N/A';

  const lines = [
    `Professor ${name} | Dept: ${dept}`,
    `Rating: ${rating.toFixed(1)}/5 | Difficulty: ${difficulty.toFixed(1)}/5 | Would Take Again: ${wouldTakeAgainStr} | ${numRatings} ratings`,
    courseCodes ? `Courses taught: ${courseCodes}` : '',
    review1 ? `Student review 1: ${review1.slice(0, 250)}` : '',
    review2 ? `Student review 2: ${review2.slice(0, 250)}` : '',
    review3 ? `Student review 3: ${review3.slice(0, 250)}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function embed(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000) // safety cap
  });
  return res.data[0].embedding;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function importProfessors() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at: ${CSV_PATH}`);
    console.error('Put rutgers_professors_with_courses.csv in src/scripts/ and try again.');
    process.exit(1);
  }

  console.log(`Reading CSV from: ${CSV_PATH}`);
  const rows = parseCSV(CSV_PATH);
  console.log(`Total rows in CSV: ${rows.length}`);

  // Filter by department
  const filtered = DEPARTMENT_FILTER
    ? rows.filter(r => DEPARTMENT_FILTER.some(d => (r['Department'] || '').toLowerCase().includes(d.toLowerCase())))
    : rows;

  console.log(`Rows after department filter: ${filtered.length}`);
  console.log(`Departments: ${[...new Set(filtered.map(r => r['Department']))].join(', ')}\n`);

  // Check for duplicates already in DB
  console.log('Checking for existing entries...');
  const { data: existing } = await supabase
    .from('professor_reviews')
    .select('metadata->>last_name');
  const existingNames = new Set((existing || []).map(r => r['?column?']?.toLowerCase()));
  console.log(`Already in DB: ${existingNames.size} professors\n`);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    const rows_to_insert = [];

    for (const row of batch) {
      const name = row['Name'] || '';
      const nameParts = name.trim().split(' ');
      const lastName = nameParts[nameParts.length - 1];

      // Skip if already in DB
      if (existingNames.has(lastName.toLowerCase())) {
        skipped++;
        continue;
      }

      const rating = parseFloat(row['Rating']);
      const difficulty = parseFloat(row['Difficulty']);
      const numRatings = parseInt(row['Total Ratings']);

      // Skip professors with no ratings
      if (!numRatings || numRatings === 0) {
        skipped++;
        continue;
      }

      try {
        const content = formatContent(row);
        const embedding = await embed(content);

        rows_to_insert.push({
          content,
          embedding,
          metadata: {
            first_name: nameParts.slice(0, -1).join(' '),
            last_name: lastName,
            avg_rating: isNaN(rating) ? null : rating,
            avg_difficulty: isNaN(difficulty) ? null : difficulty,
            num_ratings: isNaN(numRatings) ? 0 : numRatings,
            department: row['Department'] || '',
            courses_taught: row['Courses Taught'] || ''
          }
        });
      } catch (err) {
        console.error(`  ✗ Embed failed for ${name}:`, err.message);
        failed++;
      }
    }

    if (rows_to_insert.length > 0) {
      const { error } = await supabase.from('professor_reviews').insert(rows_to_insert);
      if (error) {
        console.error(`  ✗ Supabase insert error:`, error.message);
        failed += rows_to_insert.length;
      } else {
        inserted += rows_to_insert.length;
        process.stdout.write(`\r  Inserted: ${inserted} | Skipped: ${skipped} | Failed: ${failed} | Progress: ${Math.min(i + BATCH_SIZE, filtered.length)}/${filtered.length}`);
      }
    }

    // Small delay to avoid OpenAI rate limits
    if (i + BATCH_SIZE < filtered.length) {
      await sleep(500);
    }
  }

  console.log(`\n\nDone!`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (already existed or no ratings): ${skipped}`);
  console.log(`  Failed: ${failed}`);
}

importProfessors().catch(console.error);