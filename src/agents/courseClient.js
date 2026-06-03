const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const RAG_THRESHOLD = 0.4;
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

// Shared embedding helper 

async function getEmbedding(text) {
  const { getClient } = require('./aiClient');
  const openai = getClient();
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return res.data[0].embedding;
}

// Course Catalog 

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

//  Degree Requirements 

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

//  WebReg 

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

//  Roadmaps 

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

//  Major Images (tree command) 

async function getMajorImage(input) {
  try {
    const { data, error } = await getSupabase()
      .from('major_images')
      .select('image_url, label')
      .eq('label', input.trim())
      .limit(1)
      .single();
    if (error || !data) return null;
    return data;
  } catch (err) {
    logger.error('getMajorImage failed:', err.message);
    return null;
  }
}

async function getMajorAutocomplete(query) {
  try {
    const db = getSupabase();
    let supabaseQuery = db
      .from('major_images')
      .select('label')
      .order('label', { ascending: true })
      .limit(25);
    if (query && query.trim().length > 0) {
      supabaseQuery = supabaseQuery.ilike('label', `%${query.trim()}%`);
    }
    const { data, error } = await supabaseQuery;
    if (error) throw error;
    return (data || []).map((row) => ({ name: row.label, value: row.label }));
  } catch (err) {
    logger.error('getMajorAutocomplete failed:', err.message);
    return [];
  }
}

//  occupations (career command) 

async function findOccupation(goal) {
  try {
    const normalizedGoal = goal?.trim();
    if (!normalizedGoal) return null;
    logger.info('Searching occupations', { goal: normalizedGoal });

    let { data } = await getSupabase()
      .from('occupations')
      .select('*')
      .ilike('occupation', normalizedGoal)
      .limit(1);
    if (data?.length) return data[0];

    ({ data } = await getSupabase()
      .from('occupations')
      .select('*')
      .ilike('occupation', `%${normalizedGoal}%`)
      .limit(1));
    if (data?.length) return data[0];

    return null;
  } catch (err) {
    logger.error('findOccupation failed:', err.message);
    return null;
  }
}

// live webreg

const CURRENT_YEAR = '2026';
const CURRENT_TERM = '9'; // 1=Spring, 7=Summer, 9=Fall

let _subjectCache = null;

async function getSubjectMap() {
  if (_subjectCache) return _subjectCache;
  try {
    const url = `https://classes.rutgers.edu//soc/api/subjects.json?year=${CURRENT_YEAR}&term=${CURRENT_TERM}&campus=NB`;
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
    if (/^\d{5}$/.test(trimmed)) return { type: 'index_unsupported' };

    let subjectCode, courseNum;
    const colonMatch = trimmed.match(/^(?:\d+:)?(\d{3}):(\d{3})$/);
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

    if (!subjectCode) return { type: 'unknown_subject', input: trimmed };

    const url = `https://classes.rutgers.edu//soc/api/courses.json?year=${CURRENT_YEAR}&term=${CURRENT_TERM}&campus=NB&subject=${subjectCode}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SOC API returned ${res.status}`);
    const courses = await res.json();

    const course = courses.find(c => c.courseNumber === courseNum && c.subject === subjectCode);
    if (!course) return { type: 'not_found', subjectCode, courseNum };

    const sections = (course.sections || []).map(s => ({
      index: s.index,
      section: s.number,
      instructor: (s.instructors || []).map(i => i.name).join(', ') || 'TBA',
      open: s.openStatus,
      status: s.openStatusText || (s.openStatus ? 'OPEN' : 'CLOSED'),
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

// rmp

const RUTGERS_SCHOOL_ID = 'U2Nob29sLTgyNQ=='; // base64("School-825")
const RMP_URL = 'https://www.ratemyprofessors.com/graphql';
const RMP_AUTH = 'Basic dGVzdDp0ZXN0';

const RMP_QUERY = `
query SearchTeachers($text: String!, $schoolID: ID) {
  newSearch {
    teachers(query: { text: $text, schoolID: $schoolID }) {
      edges {
        node {
          id
          firstName
          lastName
          avgRating
          avgDifficulty
          numRatings
          wouldTakeAgainPercent
          department
          teacherRatingTags { tagName tagCount }
          ratings(first: 5) {
            edges {
              node {
                comment
                class
                qualityRating
                difficultyRatingRounded
                grade
              }
            }
          }
        }
      }
    }
  }
}`;

/**
 * Queries RateMyProfessor for a single professor name at Rutgers.
 * Returns the best matching CS/engineering result or null if not found.
 */
async function queryRmp(professorName) {
  try {
    const res = await fetch(RMP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': RMP_AUTH,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': `https://www.ratemyprofessors.com/search/professors/825?q=${encodeURIComponent(professorName)}`,
        'Origin': 'https://www.ratemyprofessors.com',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({
        query: RMP_QUERY,
        variables: { text: professorName, schoolID: RUTGERS_SCHOOL_ID }
      })
    });

    if (!res.ok) throw new Error(`RMP returned ${res.status}`);

    const data = await res.json();
    const edges = data?.data?.newSearch?.teachers?.edges || [];
    if (edges.length === 0) return null;

    const profs = edges.map(e => e.node).filter(p => p.numRatings > 0);
    const csProf = profs.find(p =>
      p.department?.toLowerCase().includes('computer') ||
      p.department?.toLowerCase().includes('engineering') ||
      p.department?.toLowerCase().includes('cs')
    );

    return csProf || profs.sort((a, b) => b.numRatings - a.numRatings)[0] || null;
  } catch (err) {
    logger.error(`queryRmp failed for "${professorName}":`, err.message);
    return null;
  }
}

/**
 * Given a course code, fetches WebReg sections, extracts instructors,
 * and queries RMP for each one.
 */
async function fetchRmpForCourse(courseInput) {
  const webregResult = await fetchLiveWebReg(courseInput);
  if (webregResult.type !== 'found') return { webregResult, rmpResults: [] };

  const instructorNames = [
    ...new Set(
      webregResult.sections
        .map(s => s.instructor)
        .filter(name => name && name !== 'TBA' && name.trim().length > 0)
    )
  ];

  if (instructorNames.length === 0) return { webregResult, rmpResults: [] };

  // WebReg names are usually "LAST, FIRST" — extract last name for RMP search
  const rmpResults = await Promise.all(
    instructorNames.map(async (fullName) => {
      const lastName = fullName.includes(',')
        ? fullName.split(',')[0].trim()
        : fullName.split(' ')[0].trim();
      const rmpData = await queryRmp(lastName);
      return { instructor: fullName, lastName, rmpData };
    })
  );

  return { webregResult, rmpResults };
}

// exports

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
  fetchRmpForCourse,
};