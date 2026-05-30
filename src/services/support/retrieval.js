const { createClient } = require('@supabase/supabase-js');
const { OpenAIEmbeddings } = require('@langchain/openai');
const config = require('../../config');

let supabase = null;
let embeddings = null;

function getSupabase() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || config.demoMode) return null;
  if (!supabase) {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  return supabase;
}

function getEmbeddings() {
  if (!config.openaiApiKey || config.demoMode) return null;
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      apiKey: config.openaiApiKey,
      model: config.ragEmbeddingModel,
    });
  }
  return embeddings;
}

function trimContext(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function formatContextForPrompt(chunks) {
  return chunks
    .map((chunk, index) => {
      const source = chunk.source_path || chunk.metadata?.source_path || 'unknown';
      const content = trimContext(chunk.content || '', 700);
      return `Snippet ${index + 1}\nSource: ${source}\n${content}`;
    })
    .join('\n\n');
}

function normalizeChunks(rows) {
  return (rows || []).map((row) => ({
    id: row.id,
    source_path: row.source_path,
    content: row.content || '',
    score: typeof row.similarity === 'number' ? row.similarity : null,
    metadata: row.metadata || {},
  }));
}

function logRetrievedChunks(query, chunks) {
  const payload = chunks.map((chunk) => ({
    id: chunk.id,
    source: chunk.source_path || chunk.metadata?.source_path || 'unknown',
    score: chunk.score,
    preview: (chunk.content || '').slice(0, 120).replace(/\s+/g, ' '),
  }));
  console.log('[support-rag] query:', query);
  console.log('[support-rag] chunks:', JSON.stringify(payload, null, 2));
}

async function retrieveSupportContext(query) {
  const client = getSupabase();
  const embedder = getEmbeddings();
  if (!client || !embedder) {
    return { chunks: [], contextText: '', available: false };
  }

  const vector = await embedder.embedQuery(query);
  const { data, error } = await client.rpc(config.ragMatchRpc, {
    query_embedding: vector,
    match_count: config.ragTopK,
    match_threshold: config.ragMatchThreshold,
  });

  if (error) {
    throw new Error(`RAG retrieval failed: ${error.message}`);
  }

  const chunks = normalizeChunks(data);
  logRetrievedChunks(query, chunks);

  const contextText = trimContext(
    formatContextForPrompt(chunks),
    config.ragContextMaxChars,
  );

  return {
    chunks,
    contextText,
    available: true,
  };
}

module.exports = { retrieveSupportContext };
