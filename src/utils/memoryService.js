/**
 * src/utils/memoryService.js
 *
 * Memory layer for the Discord bot.
 *
 * This module hides where memory comes from. The interaction handler does not
 * need to care whether memory is stored in Supabase or in a local Map.
 *
 * Current behavior:
 * - If SUPABASE_URL and SUPABASE_KEY exist, use Supabase.
 * - If not, fall back to in-memory conversationStore.
 *
 * Tables expected when Supabase is enabled:
 * - app_chat_history: short-term message history
 * - app_user_memories: long-term memories with embeddings
 * - match_memories RPC: vector similarity search function
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');
const conversationStore = require('./conversationStore');

// Maximum recent chat messages pulled from app_chat_history.
const SHORT_TERM_LIMIT = 20;

// Vector search settings for long-term memory retrieval.
const RAG_THRESHOLD = 0.4;
const RAG_COUNT = 8;

// Avoid storing useless tiny questions as long-term memories.
const MIN_MEMORY_LENGTH = 5;

// Reuse one Supabase client after creation.
let supabase = null;

// Prevent logging the same fallback warning on every request.
let warnedAboutFallback = false;

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

/**
 * Lazily initialize Supabase.
 *
 * This avoids crashing during local development if the file is imported before
 * Supabase env vars are set.
 */
function getSupabase() {
  if (!hasSupabaseConfig()) {
    throw new Error('SUPABASE_URL or SUPABASE_KEY is not configured');
  }

  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }

  return supabase;
}

function logFallbackOnce() {
  if (!warnedAboutFallback) {
    logger.warn('Supabase memory is not configured. Falling back to in-memory conversation history.');
    warnedAboutFallback = true;
  }
}

/**
 * Get recent conversation history for one Discord user.
 *
 * Return shape:
 *   [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }]
 *
 * The interaction handler appends the latest user message after this history.
 */
async function getShortTermHistory(userId) {
  if (!hasSupabaseConfig()) {
    logFallbackOnce();
    return conversationStore.getHistory(userId);
  }

  try {
    /**
     * We fetch newest first for efficient limit, then reverse so the model sees
     * messages in chronological order.
     */
    const { data, error } = await getSupabase()
      .from('app_chat_history')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(SHORT_TERM_LIMIT);

    if (error) throw error;

    return (data || []).reverse();
  } catch (err) {
    logger.error('getShortTermHistory failed:', err.message);

    // Fail soft. The bot should still answer even if memory is broken.
    return conversationStore.getHistory(userId);
  }
}

/**
 * Search long-term memories by semantic similarity.
 *
 * This function is available for future RAG flows. The simplified redesign
 * handler does not currently call it, but keeping it here makes the branch ready
 * for richer memory retrieval later.
 */
async function searchLongTermMemories(keywords) {
  if (!hasSupabaseConfig()) {
    return { memories: [], embedding: null };
  }

  try {
    // Import here to avoid circular dependency problems at module-load time.
    const { getClient } = require('../agents/aiClient');
    const openai = getClient();

    const embedResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: keywords
    });

    const searchEmbedding = embedResponse.data[0].embedding;

    const { data: memories, error } = await getSupabase().rpc('match_memories', {
      query_embedding: searchEmbedding,
      match_threshold: RAG_THRESHOLD,
      match_count: RAG_COUNT
    });

    if (error) throw error;

    return { memories: memories || [], embedding: searchEmbedding };
  } catch (err) {
    logger.error('searchLongTermMemories failed:', err.message);
    return { memories: [], embedding: null };
  }
}

/**
 * Save the latest user question and assistant answer.
 *
 * This function is intentionally "fire and forget" from interactionHandler.js.
 * It catches its own errors so a database failure does not break the user reply.
 */
async function saveMemoryAsync(userId, username, question, answer, questionEmbedding) {
  // Always update the in-memory fallback. This keeps local continuity even when
  // Supabase is off or errors out.
  conversationStore.appendTurn(userId, question, answer);

  if (!hasSupabaseConfig()) {
    logFallbackOnce();
    return;
  }

  try {
    const { error: historyError } = await getSupabase()
      .from('app_chat_history')
      .insert([
        { user_id: userId, role: 'user', content: question },
        { user_id: userId, role: 'assistant', content: answer }
      ]);

    if (historyError) {
      logger.error('Short-term memory save failed:', historyError.message);
    }

    /**
     * Store long-term memory only if we already have an embedding.
     *
     * In this redesign branch, interactionHandler.js passes null, so this block
     * usually does not run. It is here for future richer memory flows.
     */
    if (question.length > MIN_MEMORY_LENGTH && questionEmbedding) {
      const { error: memoryError } = await getSupabase()
        .from('app_user_memories')
        .insert({
          user_id: userId,
          content: question,
          embedding: questionEmbedding,
          metadata: { source: 'discord', username }
        });

      if (memoryError) {
        logger.error('Long-term memory save failed:', memoryError.message);
      }
    }
  } catch (err) {
    logger.error('saveMemoryAsync failed:', err.message);
  }
}

module.exports = {
  getShortTermHistory,
  searchLongTermMemories,
  saveMemoryAsync
};
