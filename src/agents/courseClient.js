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

/// ── Roadmap lookup ────────────────────────────────────────────────────────────

// Returns the mode ('semester' | 'picker') for a given major string,
// so the handler knows which options to honour.
async function getRoadmapMode(major, track = null) {
  try {
    let q = getSupabase()
      .from('roadmaps')
      .select('mode')
      .eq('major', major);

    if (track) {
      q = q.eq('track', track);
    } else {
      q = q.is('track', null);
    }

    const { data, error } = await q.limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0].mode;
  } catch (err) {
    logger.error('getRoadmapMode failed:', err.message);
    return null;
  }
}

// Semester-based: fetch the row for a specific semester number.
async function getRoadmapBySemester(major, semester, track = null) {
  try {
    let q = getSupabase()
      .from('roadmaps')
      .select('image_url, label')
      .eq('major', major)
      .eq('semester', semester);

    if (track) {
      q = q.eq('track', track);
    } else {
      q = q.is('track', null);
    }

    const { data, error } = await q.limit(1).single();
    if (error || !data) return null;
    return data;
  } catch (err) {
    logger.error('getRoadmapBySemester failed:', err.message);
    return null;
  }
}

// Picker-based: fetch a specific named section row.
async function getRoadmapBySection(major, sectionLabel) {
  try {
    const { data, error } = await getSupabase()
      .from('roadmaps')
      .select('image_url, label')
      .eq('major', major)
      .eq('section_label', sectionLabel)
      .limit(1)
      .single();
    if (error || !data) return null;
    return data;
  } catch (err) {
    logger.error('getRoadmapBySection failed:', err.message);
    return null;
  }
}

// Autocomplete: all distinct major values (for the major option on /roadmap).
async function getRoadmapMajorAutocomplete(query) {
  try {
    const db = getSupabase();
    // Pull distinct majors — combine major + track into a display string
    let q = db
      .from('roadmaps')
      .select('major, track')
      .order('major', { ascending: true })
      .limit(100); // fetch more than 25 so we can dedupe before slicing

    if (query && query.trim().length > 0) {
      q = q.ilike('major', `%${query.trim()}%`);
    }

    const { data, error } = await q;
    if (error) throw error;

    // Build display labels, dedupe by label
    const seen = new Set();
    const results = [];
    for (const row of data || []) {
      const label = row.track ? `${row.major} — ${row.track}` : row.major;
      const value = row.track ? `${row.major}||${row.track}` : row.major; // pipe-delimited so handler can split
      if (!seen.has(label)) {
        seen.add(label);
        results.push({ name: label, value });
      }
    }

    return results.slice(0, 25);
  } catch (err) {
    logger.error('getRoadmapMajorAutocomplete failed:', err.message);
    return [];
  }
}

// Autocomplete: section_label values for a given major (for the section option).
async function getRoadmapSectionAutocomplete(majorValue, query) {
  try {
    // majorValue may be "Data Science||CS" — split it
    const [major, track] = majorValue.includes('||')
      ? majorValue.split('||')
      : [majorValue, null];

    let q = getSupabase()
      .from('roadmaps')
      .select('section_label')
      .eq('major', major)
      .not('section_label', 'is', null)
      .order('section_label', { ascending: true })
      .limit(25);

    if (track) q = q.eq('track', track);
    if (query && query.trim().length > 0) q = q.ilike('section_label', `%${query.trim()}%`);

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map((r) => ({
      name: r.section_label,
      value: r.section_label
    }));
  } catch (err) {
    logger.error('getRoadmapSectionAutocomplete failed:', err.message);
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

    logger.info('Searching occupations', { goal: normalizedGoal });

    // exact match first
    let { data } = await getSupabase()
      .from('occupations')
      .select('*')
      .ilike('occupation', normalizedGoal)
      .limit(1);

    if (data?.length) return data[0];

    // partial match second
    ({ data } = await getSupabase()
      .from('occupations')
      .select('*')
      .ilike('occupation', `%${normalizedGoal}%`)
      .limit(1));

    if (data?.length) return data[0];

    // semantic match — embed the goal and find the closest occupation
    const embedding = await getEmbedding(normalizedGoal);
    const { data: semanticData, error } = await getSupabase().rpc('match_occupations', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: 1
    });

    if (error) throw error;
    if (semanticData?.length) {
      logger.info('Occupation matched via semantic search', {
        goal: normalizedGoal,
        matched: semanticData[0].occupation
      });
      return semanticData[0];
    }

    return null;
  } 
    catch (err) {
    logger.error('findOccupation failed:', err.message);
    return null;
  }
}

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

    if (/^\d{5}$/.test(trimmed)) {
      return { type: 'index_unsupported' };
    }

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

    if (!subjectCode) {
      return { type: 'unknown_subject', input: trimmed };
    }

    const url = `https://classes.rutgers.edu//soc/api/courses.json?year=${CURRENT_YEAR}&term=${CURRENT_TERM}&campus=NB&subject=${subjectCode}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SOC API returned ${res.status}`);
    const courses = await res.json();

    const course = courses.find(c => c.courseNumber === courseNum && c.subject === subjectCode);

    if (!course) {
      return { type: 'not_found', subjectCode, courseNum };
    }

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


// ── RateMyProfessor ───────────────────────────────────────────────────────────

const RUTGERS_SCHOOL_ID = '825';

/**
 * Decode a RMP professor ID to a plain numeric string for profile URLs.
 * RMP GraphQL IDs are base64-encoded like "VGVhY2hlci0yNDAzNDc3" → "Teacher-2403477"
 */
function decodeRmpId(id) {
  if (!id) return null;
  try {
    const decoded = Buffer.from(id, 'base64').toString('utf8');
    const match = decoded.match(/Teacher-(\d+)/);
    if (match) return match[1];
  } catch (_) {}
  const directMatch = String(id).match(/Teacher-(\d+)/);
  if (directMatch) return directMatch[1];
  if (/^\d+$/.test(String(id))) return String(id);
  return null;
}

/**
 * Search RMP for a professor by last name at Rutgers using HTML scraping.
 * No API token needed — parses the embedded JSON from the search results page.
 */
async function queryRmp(lastName) {
  if (!lastName || lastName.trim().length < 2) return null;
  const searchName = lastName.trim();

  try {
    const url = `https://www.ratemyprofessors.com/search/professors/${RUTGERS_SCHOOL_ID}?q=${encodeURIComponent(searchName)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!res.ok) throw new Error(`RMP returned ${res.status}`);
    const html = await res.text();

    // Parse professor data from embedded JSON in the page
    const matches = [...html.matchAll(/"__typename":"Teacher","id":"([^"]+)","firstName":"([^"]+)","lastName":"([^"]+)","department":(?:"([^"]*?)"|null),"avgRating":([\d.]+),"avgDifficulty":([\d.]+),"numRatings":(\d+),"wouldTakeAgainPercent":([\d.-]+)/g)];

    if (matches.length === 0) return null;

    const profs = matches.map(m => ({
      id: m[1],
      firstName: m[2],
      lastName: m[3],
      department: m[4] || null,
      avgRating: parseFloat(m[5]),
      avgDifficulty: parseFloat(m[6]),
      numRatings: parseInt(m[7]),
      wouldTakeAgainPercent: parseFloat(m[8]),
      teacherRatingTags: [],
      ratings: { edges: [] }
    })).filter(p =>
      p.numRatings > 0 &&
      p.lastName.toLowerCase() === searchName.toLowerCase()
    );

    if (profs.length === 0) return null;

    // Prefer CS/engineering department, fall back to most-rated exact match
    const csProf = profs.find(p => {
      const dept = (p.department || '').toLowerCase();
      return dept.includes('computer') || dept.includes('cs') ||
             dept.includes('engineering') || dept.includes('information') ||
             dept.includes('math') || dept.includes('statistic');
    });

    return csProf || profs.sort((a, b) => b.numRatings - a.numRatings)[0] || null;

  } catch (err) {
    logger.error(`queryRmp failed for "${searchName}":`, err.message);
    return null;
  }
}

/**
 * Primary lookup: check professor_reviews Supabase table first (seeded data),
 * then fall back to live RMP query if not found.
 * 
 * This gives us:
 * - Fast, reliable results for known CS professors (from seed)
 * - Live fallback for new or unseeded professors
 * - Correct professor matching (seeded data is pre-verified)
 */
async function lookupProfessor(lastName) {
  // Step 1: try seeded professor_reviews table
  try {
    const { data, error } = await getSupabase()
      .from('professor_reviews')
      .select('content, metadata')
      .ilike('metadata->>last_name', lastName)
      .limit(1)
      .single();

    if (!error && data) {
      logger.info('Professor found in seeded data', { lastName });
      return { source: 'seeded', content: data.content, metadata: data.metadata };
    }
  } catch (_) {}

  // Step 2: fall back to live RMP query
  logger.info('Professor not in seed, querying RMP live', { lastName });
  const rmpData = await queryRmp(lastName);
  if (rmpData) {
    return { source: 'live', rmpData };
  }

  return null;
}

/**
 * Given a course code, fetches WebReg sections, extracts instructors,
 * and looks up each one via seeded data or live RMP.
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

  const rmpResults = await Promise.all(
    instructorNames.map(async (fullName) => {
      // Parse last name: "TJANG, ANDREW" → "TJANG", "CENTENO" → "CENTENO"
      const lastName = fullName.includes(',')
        ? fullName.split(',')[0].trim()
        : fullName.split(' ')[0].trim();

      const result = await lookupProfessor(lastName);
      return { instructor: fullName, lastName, result };
    })
  );

  return { webregResult, rmpResults };
}

async function findCareersByMajor(major) {
  try {
    const normalizedMajor = major?.trim();
    if (!normalizedMajor) return [];

    const { data, error } = await getSupabase()
      .from('occupations')
      .select('occupation, recommended_majors')
      .ilike('recommended_majors', `%${normalizedMajor}%`)
      .limit(20);

    if (error) throw error;
    return data || [];
  } catch (err) {
    logger.error('findCareersByMajor failed:', err.message);
    return [];
  }
}


// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  searchCourseCatalog,
  formatCourseCatalogContext,
  searchDegreeRequirements,
  formatDegreeRequirementsContext,
  searchWebReg,
  formatWebRegContext,
  getMajorImage,
  findOccupation,
  getMajorAutocomplete,
  fetchLiveWebReg,
  fetchRmpForCourse,
  decodeRmpId,
  getRoadmapMode,
  getRoadmapBySemester,
  getRoadmapBySection,
  getRoadmapMajorAutocomplete,
   findCareersByMajor,
  getRoadmapSectionAutocomplete
};