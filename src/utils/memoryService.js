const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');
const conversationStore = require('./conversationStore');

const SHORT_TERM_LIMIT = 20;
const RAG_THRESHOLD = 0.4;
const RAG_COUNT = 8;
const MIN_MEMORY_LENGTH = 5;

let supabase = null;
let warnedAboutFallback = false;

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

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

async function getShortTermHistory(userId) {
  if (!hasSupabaseConfig()) {
    logFallbackOnce();
    return conversationStore.getHistory(userId);
  }

  try {
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
    return conversationStore.getHistory(userId);
  }
}

async function searchLongTermMemories(keywords) {
  if (!hasSupabaseConfig()) {
    return { memories: [], embedding: null };
  }

  try {
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

async function saveMemoryAsync(userId, username, question, answer, questionEmbedding) {
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
