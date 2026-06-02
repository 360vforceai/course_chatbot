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

// -- Trees 
// Table: major_images

async function getMajorImage(input) {
  try {
    const { data, error } = await getSupabase()
      .from('major_images')
      .select('image_url, label')
      .eq('label', input.trim())   // match the exact label from autocomplete
      .limit(1)
      .single();

    if (error || !data) return null;
    return data;
  } catch (err) {
    logger.error('getMajorImage failed:', err.message);
    return null;
  }
}

// ── Tree Autocomplete ─────────────────────────────────────────────────────────
// Queries major_images for labels matching the user's partial input.
// Returns up to 25 { name, value } pairs for Discord autocomplete.

async function getMajorAutocomplete(query) {
  try {
    const db = getSupabase();
    let supabaseQuery = db
      .from('major_images')
      .select('label')
      .order('label', { ascending: true })
      .limit(25);

    // Only filter when the user has typed something
    if (query && query.trim().length > 0) {
      supabaseQuery = supabaseQuery.ilike('label', `%${query.trim()}%`);
    }

    const { data, error } = await supabaseQuery;
    if (error) throw error;

    // Discord autocomplete expects [{ name, value }]
    return (data || []).map((row) => ({
      name: row.label,   // displayed to user
      value: row.label   // sent back as the option value on submit
    }));
  } catch (err) {
    logger.error('getMajorAutocomplete failed:', err.message);
    return [];
  }
}

async function findOccupation(goal) {
  try {

    const normalizedGoal = goal?.trim();
    
    if (!normalizedGoal) return null;

    logger.info('Searching occupations', {
    goal: normalizedGoal
    });

    // Exact match first
    let { data } = await getSupabase()
      .from('occupations')
      .select('*')
      .ilike('occupation', normalizedGoal)
      .limit(1);

    if (data?.length) return data[0];

    // Partial match second
    ({ data } = await getSupabase()
      .from('occupations')
      .select('*')
      .ilike('occupation',`%${normalizedGoal}%`)
      .limit(1));

    if (data?.length) return data[0];

    return null;
  }

  catch (err) {
    
  logger.error('findOccupation failed:', err.message);
  return null;

  }
}

const CURRENT_YEAR = '2026';

const CURRENT_TERM = '1'; // 1=Spring, 7=Summer, 9=Fall

let _subjectCache = null;

async function getSubjectMap() {
  if (_subjectCache) return _subjectCache;

  try {
    const url = `https://classes.rutgers.edu/soc/api/subjects.json?year=${CURRENT_YEAR}&term=${CURRENT_TERM}&campus=NB`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Subjects API returned ${res.status}`);
    const subjects = await res.json();

    const map = {};
    for (const s of subjects) {
      const code = s.code;
      const name = s.description;

      map[name.toLowerCase()] = code;

      const firstWord = name.split(' ')[0].toLowerCase();
      if (!map[firstWord]) map[firstWord] = code;

      const abbrev = name.split(' ').map(w => w[0]).join('').toLowerCase();
      if (abbrev.length >= 2 && !map[abbrev]) map[abbrev] = code;

      map[code] = code;
    }

    _subjectCache = map;
    logger.info('Subject map loaded', { count: subjects.length });
    return map;
  } catch (err) {
    logger.error('getSubjectMap failed:', err.message);
    return {
      'cs': '198', 'computer science': '198', 'compsci': '198',
      'math': '640', 'mathematics': '640',
      'physics': '750', 'phys': '750',
      'chem': '160', 'chemistry': '160',
      'bio': '120', 'biology': '120',
      'ece': '332',
      'stat': '960', 'statistics': '960',
    };
  }
}

async function fetchLiveWebReg(input) {
  try {
    const trimmed = input.trim();

    if (/^\d{5}$/.test(trimmed)) {
      return { type: 'index_unsupported' };
    }

    let subjectCode, courseNum;
    const colonMatch = trimmed.match(/^(\d{3}):(\d{3})$/);
    const spaceMatch = trimmed.match(/^([a-zA-Z\s]+)\s+(\d{3})$/i);
    const noSpaceMatch = trimmed.match(/^([a-zA-Z]+)(\d{3})$/i);

    if (colonMatch) {
      [, subjectCode, courseNum] = colonMatch;
    } else if (spaceMatch) {
      const subjectRaw = spaceMatch[1].trim().toLowerCase();
      courseNum = spaceMatch[2];
      const subjectMap = await getSubjectMap();
      subjectCode = subjectMap[subjectRaw] || null;
    } else if (noSpaceMatch) {
      const subjectRaw = noSpaceMatch[1].toLowerCase();
      courseNum = noSpaceMatch[2];
      const subjectMap = await getSubjectMap();
      subjectCode = subjectMap[subjectRaw] || null;
    } else {
      return { type: 'parse_error', input: trimmed };
    }

    if (!subjectCode) {
      return { type: 'unknown_subject', input: trimmed };
    }

    const url = `https://classes.rutgers.edu/soc/api/courses.json?year=${CURRENT_YEAR}&term=${CURRENT_TERM}&campus=NB&subject=${subjectCode}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SOC API returned ${res.status}`);
    const courses = await res.json();

    const course = courses.find(c => c.courseNumber === courseNum);
    if (!course) {
      return { type: 'not_found', subjectCode, courseNum };
    }

    const sections = (course.sections || []).map(s => ({
      index: s.index,
      section: s.number,
      instructor: (s.instructors || []).map(i => i.name).join(', ') || 'TBA',
      openSeats: s.openStatus ? s.openSeats : 0,
      totalSeats: s.capacity,
      open: s.openStatus,
      meetingTimes: (s.meetingTimes || []).map(m =>
        `${m.meetingDay || ''} ${m.startTime || ''}–${m.endTime || ''} @ ${m.buildingCode || ''} ${m.roomNumber || ''}`
          .replace(/\s+/g, ' ').trim()
      ).join(', ') || 'TBA',
      credits: s.credits || course.credits || '?',
    }));

    return {
      type: 'found',
      title: course.title,
      courseCode: `${subjectCode}:${courseNum}`,
      credits: course.credits || '?',
      sections,
    };

  } catch (err) {
    logger.error('fetchLiveWebReg failed:', err.message);
    return { type: 'error', message: err.message };
  }
}



module.exports = {
  searchCourseCatalog,
  formatCourseCatalogContext,
  searchDegreeRequirements,
  formatDegreeRequirementsContext,
  searchWebReg,
  formatWebRegContext,
  searchRoadmaps,
  formatRoadmapContext,
  getMajorImage,
  findOccupation,
  getMajorAutocomplete,
  fetchLiveWebReg,
};