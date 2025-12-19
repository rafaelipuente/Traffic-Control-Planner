/**
 * RAG Ingestion Script
 * Extracts text from PDFs in "tcp handbooks/" and "tcp examples/",
 * chunks the text, generates embeddings, and writes to "rag_index/".
 *
 * Usage: npm run rag:ingest
 */

// Load environment variables from .env.local
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";

// Types
interface ChunkRecord {
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

// Configuration
const PROJECT_ROOT = process.cwd();
const HANDBOOKS_DIR = path.join(PROJECT_ROOT, "tcp handbooks");
const EXAMPLES_DIR = path.join(PROJECT_ROOT, "tcp examples");
const RAG_INDEX_DIR = path.join(PROJECT_ROOT, "rag_index");
const CHUNKS_FILE = path.join(RAG_INDEX_DIR, "chunks.jsonl");
const EMBEDDINGS_FILE = path.join(RAG_INDEX_DIR, "embeddings.jsonl");

const EMBEDDING_MODEL = "text-embedding-3-small";
const CHUNK_SIZE = 500; // approximate tokens (chars / 4)
const CHUNK_OVERLAP = 100;

// Ensure OpenAI API key is available
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY environment variable is required");
  console.error("   Set it in .env.local or export it in your shell");
  process.exit(1);
}

/**
 * Extract text from a PDF file using pdf-parse
 */
async function extractPdfText(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const dataBuffer = await fs.promises.readFile(filePath);
  const parsed = await pdfParse(dataBuffer);
  return parsed.text || "";
}

/**
 * Split text into overlapping chunks
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  const charChunkSize = chunkSize * 4; // rough token to char conversion
  const charOverlap = overlap * 4;

  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + charChunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) {
      // skip very small chunks
      chunks.push(chunk);
    }
    start += charChunkSize - charOverlap;
    if (start >= text.length) break;
  }

  return chunks;
}

/**
 * Try to extract page number from chunk text (best effort)
 */
function extractPageNumber(text: string): number | null {
  // Look for patterns like "Page 5", "page 5", "- 5 -", etc.
  const pageMatch = text.match(/(?:page|Page|PAGE)\s*(\d+)/i);
  if (pageMatch) {
    return parseInt(pageMatch[1], 10);
  }
  return null;
}

/**
 * Try to extract section/figure reference from chunk text (best effort)
 */
function extractSectionOrFigure(text: string): string | null {
  // Look for section patterns
  const sectionMatch = text.match(
    /(?:Section|SECTION|Figure|FIGURE|Table|TABLE|Chapter|CHAPTER)\s*[\d.]+[A-Za-z]?/i
  );
  if (sectionMatch) {
    return sectionMatch[0];
  }
  return null;
}

/**
 * Generate embeddings using OpenAI API
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const batchSize = 100; // OpenAI allows up to 2048 inputs, but let's be conservative
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    console.log(
      `  Generating embeddings for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}...`
    );

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    // Sort by index to maintain order
    const sortedEmbeddings = data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);

    allEmbeddings.push(...sortedEmbeddings);

    // Rate limiting: small delay between batches
    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return allEmbeddings;
}

/**
 * Process a single PDF file
 */
async function processPdf(
  filePath: string,
  folderType: "handbook" | "example"
): Promise<ChunkRecord[]> {
  const docName = path.basename(filePath, ".pdf");
  const relativePath = path.relative(PROJECT_ROOT, filePath);

  console.log(`  Processing: ${relativePath}`);

  try {
    const text = await extractPdfText(filePath);
    if (!text || text.length < 100) {
      console.warn(`  ⚠️  Skipping ${docName}: insufficient text extracted`);
      return [];
    }

    const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(`    Extracted ${chunks.length} chunks`);

    return chunks.map((chunkText, index) => ({
      id: `${folderType}-${docName}-chunk-${index}`,
      folderType,
      docName,
      docPath: relativePath,
      pageNumber: extractPageNumber(chunkText),
      sectionOrFigure: extractSectionOrFigure(chunkText),
      text: chunkText,
    }));
  } catch (error) {
    console.warn(
      `  ⚠️  Failed to process ${docName}: ${error instanceof Error ? error.message : error}`
    );
    return [];
  }
}

/**
 * Get all PDF files in a directory
 */
async function getPdfFiles(dir: string): Promise<string[]> {
  try {
    const files = await fs.promises.readdir(dir);
    return files
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((f) => path.join(dir, f));
  } catch {
    console.warn(`  ⚠️  Could not read directory: ${dir}`);
    return [];
  }
}

/**
 * Write records to a JSONL file
 */
async function writeJsonl<T>(filePath: string, records: T[]): Promise<void> {
  const content = records.map((r) => JSON.stringify(r)).join("\n");
  await fs.promises.writeFile(filePath, content, "utf-8");
}

/**
 * Main ingestion function
 */
async function main() {
  console.log("🚀 Starting RAG ingestion...\n");

  // Ensure output directory exists
  await fs.promises.mkdir(RAG_INDEX_DIR, { recursive: true });

  // Process handbooks
  console.log("📚 Processing handbooks...");
  const handbookFiles = await getPdfFiles(HANDBOOKS_DIR);
  const handbookChunks: ChunkRecord[] = [];

  for (const file of handbookFiles) {
    const chunks = await processPdf(file, "handbook");
    handbookChunks.push(...chunks);
  }

  console.log(`  Total handbook chunks: ${handbookChunks.length}\n`);

  // Process examples
  console.log("📄 Processing examples...");
  const exampleFiles = await getPdfFiles(EXAMPLES_DIR);
  const exampleChunks: ChunkRecord[] = [];

  for (const file of exampleFiles) {
    const chunks = await processPdf(file, "example");
    exampleChunks.push(...chunks);
  }

  console.log(`  Total example chunks: ${exampleChunks.length}\n`);

  // Combine all chunks
  const allChunks = [...handbookChunks, ...exampleChunks];

  if (allChunks.length === 0) {
    console.error("❌ No chunks extracted. Check that PDF files exist and are readable.");
    process.exit(1);
  }

  console.log(`📊 Total chunks to embed: ${allChunks.length}\n`);

  // Generate embeddings
  console.log("🧠 Generating embeddings...");
  const texts = allChunks.map((c) => c.text);
  const embeddings = await generateEmbeddings(texts);

  // Create embedding records
  const embeddingRecords: EmbeddingRecord[] = allChunks.map((chunk, i) => ({
    id: chunk.id,
    embedding: embeddings[i],
  }));

  // Write to files
  console.log("\n💾 Writing index files...");
  await writeJsonl(CHUNKS_FILE, allChunks);
  console.log(`  Wrote ${allChunks.length} chunks to ${path.relative(PROJECT_ROOT, CHUNKS_FILE)}`);

  await writeJsonl(EMBEDDINGS_FILE, embeddingRecords);
  console.log(
    `  Wrote ${embeddingRecords.length} embeddings to ${path.relative(PROJECT_ROOT, EMBEDDINGS_FILE)}`
  );

  console.log("\n✅ RAG ingestion complete!");
  console.log(`   Index location: ${path.relative(PROJECT_ROOT, RAG_INDEX_DIR)}/`);
}

// Run
main().catch((error) => {
  console.error("❌ Ingestion failed:", error);
  process.exit(1);
});

