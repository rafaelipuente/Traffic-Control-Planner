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
      const pages = text.split(/\n\s*\f|\f/g); // crude page split
      pages.forEach((pageText, index) => {
        const trimmed = pageText.trim();
        if (!trimmed) return;
        chunks.push({
          id: `HB-${docName}-p${index + 1}`,
          kind: "handbook",
          docName,
          pageNumber: index + 1,
          text: trimmed.slice(0, 4000),
        });
      });
    } catch (err) {
      console.error("Failed to parse handbook PDF", fullPath, err);
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

export async function retrieveSupport(
  ctx: RetrievalQueryContext,
  options?: { topHandbooks?: number; topExamples?: number }
): Promise<{
  handbookChunks: RetrievedChunk[];
  exampleChunks: RetrievedChunk[];
}> {
  const { topHandbooks = 6, topExamples = 4 } = options || {};
  const chunks = await ensureLoaded();
  const keywords = buildKeywords(ctx);

  const scored = chunks.map<RetrievedChunk>((c) => ({
    ...c,
    score: scoreChunk(c, keywords),
  }));

  const handbookChunks = scored
    .filter((c) => c.kind === "handbook" && c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topHandbooks);

  const exampleChunks = scored
    .filter((c) => c.kind === "example" && c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topExamples);

  return { handbookChunks, exampleChunks };
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


