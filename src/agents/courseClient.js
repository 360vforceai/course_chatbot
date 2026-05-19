const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

// Similarity threshold: results below this score are discarded
const RAG_THRESHOLD = 0.4;
// Max results returned per table search
const RAG_COUNT = 6;

let supabase = null;

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL or SUPABASE_KEY is not set');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

// ── Shared embedding helper ───────────────────────────────────────────────────

async function getEmbedding(text) {
  const { getClient } = require('./aiClient');
  const openai = getClient();
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return res.data[0].embedding;
}

// ── Course Catalog ────────────────────────────────────────────────────────────
// Table: course_catalog
// Embedding format: "CS 344 | Design and Analysis of Computer Algorithms |
//   prereqs: CS 112, CS 206, MATH 250 | 4 credits | description: ..."

async function searchCourseCatalog(keywords) {
  try {
    const embedding = await getEmbedding(keywords);
    const { data, error } = await getSupabase().rpc('match_course_catalog', {
      query_embedding: embedding,
      match_threshold: RAG_THRESHOLD,
      match_count: RAG_COUNT
    });
    if (error) throw error;
    logger.info('searchCourseCatalog', { keywords, found: (data || []).length });
    return data || [];
  } catch (err) {
    logger.error('searchCourseCatalog failed:', err.message);
    return [];
  }
}

function formatCourseCatalogContext(results) {
  if (!results || results.length === 0) return null;
  return results.map((r) => r.content).join('\n\n');
}

// ── Degree Requirements ───────────────────────────────────────────────────────
// Table: degree_requirements
// Embedding format: "CS Major Core Requirement: CS 111, CS 112, CS 205, CS 206,
//   CS 211 | Track: Systems | Electives: ..."

async function searchDegreeRequirements(keywords) {
  try {
    const embedding = await getEmbedding(keywords);
    const { data, error } = await getSupabase().rpc('match_degree_requirements', {
      query_embedding: embedding,
      match_threshold: RAG_THRESHOLD,
      match_count: RAG_COUNT
    });
    if (error) throw error;
    logger.info('searchDegreeRequirements', { keywords, found: (data || []).length });
    return data || [];
  } catch (err) {
    logger.error('searchDegreeRequirements failed:', err.message);
    return [];
  }
}

function formatDegreeRequirementsContext(results) {
  if (!results || results.length === 0) return null;
  return results.map((r) => r.content).join('\n\n');
}

// ── WebReg ────────────────────────────────────────────────────────────────────
// Table: webreg
// Embedding format: "CS 416:01 | Operating Systems Design | Prof. Tjang |
//   Mon/Wed 10:20-11:40 | Index: 12345 | Open seats: 4 | Credits: 3"

async function searchWebReg(keywords) {
  try {
    const embedding = await getEmbedding(keywords);
    const { data, error } = await getSupabase().rpc('match_webreg', {
      query_embedding: embedding,
      match_threshold: RAG_THRESHOLD,
      match_count: RAG_COUNT
    });
    if (error) throw error;
    logger.info('searchWebReg', { keywords, found: (data || []).length });
    return data || [];
  } catch (err) {
    logger.error('searchWebReg failed:', err.message);
    return [];
  }
}

function formatWebRegContext(results) {
  if (!results || results.length === 0) return null;
  return results.map((r) => r.content).join('\n\n');
}

// ── Roadmaps ──────────────────────────────────────────────────────────────────
// Table: roadmaps
// Embedding format: "CS Track: Artificial Intelligence | Semester 1: CS 111,
//   MATH 151 | Semester 2: CS 112, MATH 152 | ..."

async function searchRoadmaps(keywords) {
  try {
    const embedding = await getEmbedding(keywords);
    const { data, error } = await getSupabase().rpc('match_roadmaps', {
      query_embedding: embedding,
      match_threshold: RAG_THRESHOLD,
      match_count: RAG_COUNT
    });
    if (error) throw error;
    logger.info('searchRoadmaps', { keywords, found: (data || []).length });
    return data || [];
  } catch (err) {
    logger.error('searchRoadmaps failed:', err.message);
    return [];
  }
}

function formatRoadmapContext(results) {
  if (!results || results.length === 0) return null;
  return results.map((r) => r.content).join('\n\n');
}

module.exports = {
  searchCourseCatalog,
  formatCourseCatalogContext,
  searchDegreeRequirements,
  formatDegreeRequirementsContext,
  searchWebReg,
  formatWebRegContext,
  searchRoadmaps,
  formatRoadmapContext
};