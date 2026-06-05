require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getEmbedding(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return res.data[0].embedding;
}

async function seedOccupationEmbeddings() {
  const { data: occupations, error } = await supabase.from('occupations').select('*');
  if (error) { console.error('Failed to fetch occupations:', error.message); return; }

  console.log(`Seeding embeddings for ${occupations.length} occupations...`);

  for (const occ of occupations) {
    if (occ.embedding) {
      console.log(`Skipping (already seeded): ${occ.occupation}`);
      continue;
    }

    try {
      const embedding = await getEmbedding(occ.occupation);
      const { error: updateError } = await supabase
        .from('occupations')
        .update({ embedding })
        .eq('id', occ.id);

      if (updateError) throw updateError;
      console.log(`✓ Seeded: ${occ.occupation}`);
    } catch (err) {
      console.error(`✗ Failed: ${occ.occupation} —`, err.message);
    }
  }

  console.log('Done!');
}

seedOccupationEmbeddings();