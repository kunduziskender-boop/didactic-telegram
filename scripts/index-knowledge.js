require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');

function readInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function hashChunkId(sourcePath, chunkIndex, content) {
  const digest = crypto
    .createHash('sha256')
    .update(`${sourcePath}:${chunkIndex}:${content}`)
    .digest('hex');
  return `${sourcePath}::${chunkIndex}::${digest.slice(0, 16)}`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function collectMarkdownFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

function validateEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function main() {
  validateEnv();

  const docsDir = path.resolve(process.env.RAG_DOCS_DIR || './knowledge/support');
  const tableName = process.env.RAG_TABLE || 'kb_chunks';
  const embeddingModel = process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-small';
  const chunkSize = readInt(process.env.RAG_CHUNK_SIZE, 800);
  const chunkOverlap = readInt(process.env.RAG_CHUNK_OVERLAP, 120);
  const embedBatchSize = readInt(process.env.RAG_EMBED_BATCH_SIZE, 50);
  const upsertBatchSize = readInt(process.env.RAG_UPSERT_BATCH_SIZE, 50);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: embeddingModel,
  });

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const markdownFiles = await collectMarkdownFiles(docsDir);
  if (markdownFiles.length === 0) {
    console.log(`No markdown files found in ${docsDir}`);
    console.log('Uploaded fragments: 0');
    return;
  }

  const rowsWithoutEmbeddings = [];

  for (const filePath of markdownFiles) {
    const raw = await fs.readFile(filePath, 'utf8');
    const content = raw.trim();
    if (!content) continue;

    const sourcePath = toPosix(path.relative(process.cwd(), filePath));
    const chunks = await splitter.createDocuments([content], [{ source_path: sourcePath }]);

    chunks.forEach((doc, chunkIndex) => {
      const chunkContent = doc.pageContent.trim();
      if (!chunkContent) return;

      rowsWithoutEmbeddings.push({
        id: hashChunkId(sourcePath, chunkIndex, chunkContent),
        source_path: sourcePath,
        chunk_index: chunkIndex,
        content: chunkContent,
        metadata: {
          source_path: sourcePath,
          chunk_index: chunkIndex,
        },
      });
    });
  }

  if (rowsWithoutEmbeddings.length === 0) {
    console.log('Documents were found, but no non-empty fragments were produced.');
    console.log('Uploaded fragments: 0');
    return;
  }

  const uniqueSourcePaths = [...new Set(rowsWithoutEmbeddings.map((row) => row.source_path))];
  for (const sourceBatch of chunkArray(uniqueSourcePaths, 200)) {
    const { error } = await supabase
      .from(tableName)
      .delete()
      .in('source_path', sourceBatch);
    if (error) {
      throw new Error(`Failed to clear old fragments: ${error.message}`);
    }
  }

  let uploadedCount = 0;
  const preparedAt = new Date().toISOString();

  for (const rowBatch of chunkArray(rowsWithoutEmbeddings, embedBatchSize)) {
    const vectors = await embeddings.embedDocuments(rowBatch.map((row) => row.content));
    const payload = rowBatch.map((row, i) => ({
      ...row,
      embedding: vectors[i],
      embedding_model: embeddingModel,
      updated_at: preparedAt,
    }));

    for (const upsertBatch of chunkArray(payload, upsertBatchSize)) {
      const { error } = await supabase
        .from(tableName)
        .upsert(upsertBatch, { onConflict: 'id' });
      if (error) {
        throw new Error(`Failed to upsert fragments: ${error.message}`);
      }
      uploadedCount += upsertBatch.length;
    }
  }

  console.log(`Uploaded fragments: ${uploadedCount}`);
}

main().catch((error) => {
  console.error('Indexing failed:', error.message);
  process.exitCode = 1;
});
