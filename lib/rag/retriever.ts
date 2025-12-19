/**
 * RAG Retriever Module
 * Loads the pre-built index and performs cosine similarity search.
 */

import fs from "node:fs";
import path from "node:path";

// Types
export interface ChunkRecord {
  id: string;
  folderType: "handbook" | "example";
  docName: string;
  docPath: string;
  pageNumber: number | null;
  sectionOrFigure: string | null;
  text: string;
}

interface EmbeddingRecord {
  id: string;
  embedding: number[];
}

export interface SearchResult {
  chunk: ChunkRecord;
  score: number;
}

// Configuration
const PROJECT_ROOT = process.cwd();
const RAG_INDEX_DIR = path.join(PROJECT_ROOT, "rag_index");
const CHUNKS_FILE = path.join(RAG_INDEX_DIR, "chunks.jsonl");
const EMBEDDINGS_FILE = path.join(RAG_INDEX_DIR, "embeddings.jsonl");

const EMBEDDING_MODEL = "text-embedding-3-small";

// Cache
let chunksCache: ChunkRecord[] | null = null;
let embeddingsCache: Map<string, number[]> | null = null;
let indexLoadError: string | null = null;

/**
 * Load JSONL file and parse records
 */
function loadJsonl<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

/**
 * Load the RAG index into memory
 */
export function loadIndex(): { chunks: ChunkRecord[]; embeddings: Map<string, number[]> } | null {
  // Return cached if available
  if (chunksCache && embeddingsCache) {
    return { chunks: chunksCache, embeddings: embeddingsCache };
  }

  // Check if index exists
  if (!fs.existsSync(CHUNKS_FILE) || !fs.existsSync(EMBEDDINGS_FILE)) {
    indexLoadError = "RAG index not found. Run 'npm run rag:ingest' first.";
    console.warn(`[retriever] ${indexLoadError}`);
    return null;
  }

  try {
    console.log("[retriever] Loading RAG index...");

    // Load chunks
    chunksCache = loadJsonl<ChunkRecord>(CHUNKS_FILE);
    console.log(`[retriever] Loaded ${chunksCache.length} chunks`);

    // Load embeddings into a map for fast lookup
    const embeddingRecords = loadJsonl<EmbeddingRecord>(EMBEDDINGS_FILE);
    embeddingsCache = new Map();
    for (const rec of embeddingRecords) {
      embeddingsCache.set(rec.id, rec.embedding);
    }
    console.log(`[retriever] Loaded ${embeddingsCache.size} embeddings`);

    return { chunks: chunksCache, embeddings: embeddingsCache };
  } catch (error) {
    indexLoadError = `Failed to load RAG index: ${error instanceof Error ? error.message : error}`;
    console.error(`[retriever] ${indexLoadError}`);
    return null;
  }
}

/**
 * Check if index is available
 */
export function isIndexAvailable(): boolean {
  return loadIndex() !== null;
}

/**
 * Get index load error message
 */
export function getIndexError(): string | null {
  return indexLoadError;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Generate embedding for a query using OpenAI API
 */
async function getQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as {
    data: { embedding: number[] }[];
  };

  return data.data[0].embedding;
}

/**
 * Search for similar chunks
 */
async function search(
  query: string,
  k: number,
  folderType?: "handbook" | "example"
): Promise<SearchResult[]> {
  const index = loadIndex();
  if (!index) {
    return [];
  }

  // Get query embedding
  const queryEmbedding = await getQueryEmbedding(query);

  // Filter chunks by folder type if specified
  const candidateChunks = folderType
    ? index.chunks.filter((c) => c.folderType === folderType)
    : index.chunks;

  // Calculate similarities
  const scored: SearchResult[] = [];
  for (const chunk of candidateChunks) {
    const chunkEmbedding = index.embeddings.get(chunk.id);
    if (!chunkEmbedding) continue;

    const score = cosineSimilarity(queryEmbedding, chunkEmbedding);
    scored.push({ chunk, score });
  }

  // Sort by score descending and return top k
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Search handbooks only
 */
export async function searchHandbooks(query: string, k: number = 5): Promise<SearchResult[]> {
  return search(query, k, "handbook");
}

/**
 * Search examples only
 */
export async function searchExamples(query: string, k: number = 5): Promise<SearchResult[]> {
  return search(query, k, "example");
}

/**
 * Search all documents
 */
export async function searchAll(query: string, k: number = 10): Promise<SearchResult[]> {
  return search(query, k);
}

/**
 * Get index statistics
 */
export function getIndexStats(): {
  totalChunks: number;
  handbookChunks: number;
  exampleChunks: number;
  uniqueDocs: number;
} | null {
  const index = loadIndex();
  if (!index) return null;

  const handbookChunks = index.chunks.filter((c) => c.folderType === "handbook").length;
  const exampleChunks = index.chunks.filter((c) => c.folderType === "example").length;
  const uniqueDocs = new Set(index.chunks.map((c) => c.docName)).size;

  return {
    totalChunks: index.chunks.length,
    handbookChunks,
    exampleChunks,
    uniqueDocs,
  };
}

