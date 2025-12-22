import fs from "node:fs";
import path from "node:path";

export type SourceKind = "handbook" | "example";

export interface SourceChunk {
  id: string;
  kind: SourceKind;
  docName: string;
  pageNumber?: number;
  sectionOrTableId?: string;
  figureId?: string;
  text: string;
}

let cachedChunks: SourceChunk[] | null = null;

const PROJECT_ROOT = process.cwd();

const HANDBOOKS_DIR = path.join(PROJECT_ROOT, "tcp handbooks");
const EXAMPLES_DIR = path.join(PROJECT_ROOT, "tcp examples");

async function loadPdfText(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const dataBuffer = await fs.promises.readFile(filePath);
  const parsed = await pdfParse(dataBuffer);
  return parsed.text || "";
}

async function loadHandbookChunks(): Promise<SourceChunk[]> {
  if (!fs.existsSync(HANDBOOKS_DIR)) return [];
  const entries = await fs.promises.readdir(HANDBOOKS_DIR);
  const pdfFiles = entries.filter((f) => f.toLowerCase().endsWith(".pdf"));

  const chunks: SourceChunk[] = [];

  for (const file of pdfFiles) {
    const fullPath = path.join(HANDBOOKS_DIR, file);
    const docName = path.parse(file).name;
    try {
      const text = await loadPdfText(fullPath);
      
      if (!text || text.trim().length < 100) {
        console.warn(`[retrieval] PDF ${file}: No text extracted (possibly scanned/image PDF)`);
        // Create a metadata-only chunk
        chunks.push({
          id: `HB-${docName}-meta`,
          kind: "handbook",
          docName,
          text: `Reference document: ${file}. This PDF could not be text-extracted. Consult the original document for guidance.`,
        });
        continue;
      }
      
      // Try multiple page splitting strategies
      let pages: string[] = [];
      
      // Strategy 1: Form feed character
      if (text.includes('\f')) {
        pages = text.split(/\f/g);
      }
      // Strategy 2: Common page break patterns
      else if (/\n\s*-?\s*\d+\s*-?\s*\n/.test(text)) {
        // Split on page number patterns like "- 5 -" or just "5" on its own line
        pages = text.split(/\n\s*(?:-\s*)?\d+(?:\s*-)?\s*\n/g);
      }
      // Strategy 3: Split by approximate chunk size if no page breaks
      else {
        const CHUNK_SIZE = 3000; // characters per chunk
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
          pages.push(text.slice(i, i + CHUNK_SIZE));
        }
      }
      
      // If we only got 1 "page", try chunking by paragraph density
      if (pages.length <= 1 && text.length > 4000) {
        console.log(`[retrieval] PDF ${file}: Single page detected, chunking by size`);
        pages = [];
        const CHUNK_SIZE = 3000;
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
          pages.push(text.slice(i, i + CHUNK_SIZE));
        }
      }
      
      console.log(`[retrieval] PDF ${file}: ${pages.length} chunks extracted, ${text.length} chars total`);
      
      pages.forEach((pageText, index) => {
        const trimmed = pageText.trim();
        if (!trimmed || trimmed.length < 50) return;
        chunks.push({
          id: `HB-${docName}-p${index + 1}`,
          kind: "handbook",
          docName,
          pageNumber: index + 1,
          text: trimmed.slice(0, 4000),
        });
      });
    } catch (err) {
      console.error(`[retrieval] Failed to parse handbook PDF ${file}:`, err instanceof Error ? err.message : err);
      // Create a fallback chunk so the document is at least acknowledged
      chunks.push({
        id: `HB-${docName}-error`,
        kind: "handbook",
        docName,
        text: `Reference document: ${file}. This PDF could not be parsed. Consult the original document for guidance.`,
      });
    }
  }

  return chunks;
}

async function loadExampleChunks(): Promise<SourceChunk[]> {
  if (!fs.existsSync(EXAMPLES_DIR)) return [];
  const entries = await fs.promises.readdir(EXAMPLES_DIR);

  const chunks: SourceChunk[] = [];

  for (const file of entries) {
    const fullPath = path.join(EXAMPLES_DIR, file);
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile()) continue;

    const ext = path.extname(file).toLowerCase();
    const docName = path.parse(file).name;

    if (ext === ".pdf") {
      // Basic PDF text extraction for examples; many will still be image heavy.
      try {
        const text = await loadPdfText(fullPath);
        const trimmed = text.trim();
        if (trimmed) {
          chunks.push({
            id: `EX-${docName}-p1`,
            kind: "example",
            docName,
            pageNumber: 1,
            text: trimmed.slice(0, 4000),
          });
          continue;
        }
      } catch {
        // fall through to metadata-only chunk
      }
    }

    chunks.push({
      id: `EX-${docName}`,
      kind: "example",
      docName,
      text: `Example TCP plan from file ${file}.`,
    });
  }

  return chunks;
}

async function ensureLoaded(): Promise<SourceChunk[]> {
  if (cachedChunks) return cachedChunks;

  const [handbooks, examples] = await Promise.all([
    loadHandbookChunks(),
    loadExampleChunks(),
  ]);

  cachedChunks = [...handbooks, ...examples];
  
  console.log("[retrieval] Chunks loaded:", {
    handbookChunks: handbooks.length,
    exampleChunks: examples.length,
    totalChunks: cachedChunks.length,
    handbookDocs: [...new Set(handbooks.map(c => c.docName))],
    handbookPages: handbooks.slice(0, 10).map(c => `${c.docName} p.${c.pageNumber}`),
  });
  
  return cachedChunks;
}

export interface RetrievalQueryContext {
  roadType: string;
  postedSpeedMph: number;
  workType: string;
  workLengthFt: number;
  isNight: boolean;
  notes?: string;
}

function buildKeywords(ctx: RetrievalQueryContext): string[] {
  const words: string[] = [];
  words.push(ctx.roadType.replace(/_/g, " "));
  words.push(ctx.workType.replace(/_/g, " "));
  words.push(`${ctx.postedSpeedMph} mph`);

  const speedBand =
    ctx.postedSpeedMph <= 30
      ? "low speed"
      : ctx.postedSpeedMph <= 45
      ? "medium speed"
      : "high speed";
  words.push(speedBand);

  if (ctx.isNight) words.push("night work", "nighttime");
  else words.push("daytime");

  if (ctx.notes) words.push(ctx.notes);

  return words.map((w) => w.toLowerCase());
}

function scoreChunk(chunk: SourceChunk, keywords: string[]): number {
  const textLower = chunk.text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (kw && textLower.includes(kw)) {
      score += 1;
    }
  }
  return score;
}

export interface RetrievedChunk extends SourceChunk {
  score: number;
}

/**
 * Score a chunk against an array of query terms (more sophisticated than simple keyword match)
 */
function scoreChunkWithTerms(chunk: SourceChunk, terms: string[]): number {
  const textLower = chunk.text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (term && textLower.includes(term.toLowerCase())) {
      // Give higher weight to longer/more specific terms
      score += term.length > 10 ? 2 : 1;
    }
  }
  return score;
}

/**
 * Category-targeted retrieval queries for coverage gate categories.
 * These terms are designed to match real handbook terminology.
 */
export const CATEGORY_QUERIES = {
  spacing: [
    "advance warning area",
    "warning area",
    "sign spacing",
    "spacing",
    "A B C",
    "A, B, and C",
    "distance A",
    "distance B", 
    "distance C",
    "Table 6C-2",
    "Table 2-4",
    "Table 6C",
    "warning signs",
    "advance warning",
  ],
  taper: [
    "taper length",
    "taper",
    "merging taper",
    "shifting taper",
    "shoulder taper",
    "transition area",
    "L=",
    "L =",
    "taper types",
    "lane closure taper",
    "taper formula",
  ],
  buffer: [
    "buffer space",
    "buffer",
    "longitudinal buffer",
    "buffer length",
    "stopping distance",
    "braking distance",
    "clear zone",
    "activity area",
    "work space",
    "buffer area",
  ],
  devices: [
    "channelizing devices",
    "cones",
    "drums",
    "barricades",
    "arrow board",
    "arrow panel",
    "flagger",
    "flaggers",
    "delineators",
    "traffic control devices",
  ],
};

/**
 * Perform category-targeted retrieval to ensure coverage gate categories are found.
 * Runs separate searches for spacing, taper, buffer, and devices.
 */
async function retrieveCategoryChunks(
  allChunks: SourceChunk[],
  category: keyof typeof CATEGORY_QUERIES,
  maxResults: number = 8
): Promise<RetrievedChunk[]> {
  const terms = CATEGORY_QUERIES[category];
  
  const scored = allChunks
    .filter((c) => c.kind === "handbook")
    .map<RetrievedChunk>((c) => ({
      ...c,
      score: scoreChunkWithTerms(c, terms),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
  
  return scored;
}

export async function retrieveSupport(
  ctx: RetrievalQueryContext,
  options?: { topHandbooks?: number; topExamples?: number }
): Promise<{
  handbookChunks: RetrievedChunk[];
  exampleChunks: RetrievedChunk[];
}> {
  const { topHandbooks = 12, topExamples = 4 } = options || {};
  const chunks = await ensureLoaded();
  
  // ===== CATEGORY-TARGETED RETRIEVAL =====
  // Run separate searches for each coverage category to ensure we find relevant chunks
  const [spacingChunks, taperChunks, bufferChunks, devicesChunks] = await Promise.all([
    retrieveCategoryChunks(chunks, "spacing", 8),
    retrieveCategoryChunks(chunks, "taper", 8),
    retrieveCategoryChunks(chunks, "buffer", 8),
    retrieveCategoryChunks(chunks, "devices", 8),
  ]);
  
  // Merge and deduplicate by chunk ID, keeping highest score per chunk
  const chunkMap = new Map<string, RetrievedChunk>();
  
  for (const chunk of [...spacingChunks, ...taperChunks, ...bufferChunks, ...devicesChunks]) {
    const existing = chunkMap.get(chunk.id);
    if (!existing || chunk.score > existing.score) {
      chunkMap.set(chunk.id, chunk);
    }
  }
  
  // Also add context-based retrieval (original keywords)
  const keywords = buildKeywords(ctx);
  const contextScored = chunks
    .filter((c) => c.kind === "handbook")
    .map<RetrievedChunk>((c) => ({
      ...c,
      score: scoreChunk(c, keywords),
    }))
    .filter((c) => c.score > 0);
  
  for (const chunk of contextScored) {
    const existing = chunkMap.get(chunk.id);
    if (!existing || chunk.score > existing.score) {
      chunkMap.set(chunk.id, chunk);
    }
  }
  
  // Sort by score and take top results
  const handbookChunks = Array.from(chunkMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topHandbooks);
  
  // Example retrieval (unchanged)
  const exampleScored = chunks
    .filter((c) => c.kind === "example")
    .map<RetrievedChunk>((c) => ({
      ...c,
      score: scoreChunk(c, keywords),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topExamples);

  console.log("[retrieval] Category-targeted results:", {
    spacing: spacingChunks.length,
    taper: taperChunks.length,
    buffer: bufferChunks.length,
    devices: devicesChunks.length,
    mergedHandbooks: handbookChunks.length,
    examples: exampleScored.length,
  });

  return { handbookChunks, exampleChunks: exampleScored };
}

export function formatCitation(chunk: SourceChunk): string {
  if (chunk.kind === "handbook") {
    const page = chunk.pageNumber ? `p${chunk.pageNumber}` : "p?";
    const section = chunk.sectionOrTableId ?? "unknown";
    return `HB::${chunk.docName}::${page}::${section}`;
  }

  const page = chunk.pageNumber ? `p${chunk.pageNumber}` : "p?";
  const figure = chunk.figureId ?? "unknown";
  return `EX::${chunk.docName}::${page}::${figure}`;
}


