/**
 * Dev-only RAG Search Test Endpoint
 * POST /api/rag-search
 *
 * Tests the RAG retrieval without calling the LLM.
 * Returns top handbook + example matches with metadata and snippets.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  searchHandbooks,
  searchExamples,
  isIndexAvailable,
  getIndexError,
  getIndexStats,
  SearchResult,
} from "@/lib/rag/retriever";

export const runtime = "nodejs";

interface SearchRequest {
  query: string;
  k?: number;
}

interface SearchResponseItem {
  id: string;
  folderType: "handbook" | "example";
  docName: string;
  docPath: string;
  pageNumber: number | null;
  sectionOrFigure: string | null;
  score: number;
  snippet: string;
}

interface SearchResponse {
  query: string;
  indexStats: {
    totalChunks: number;
    handbookChunks: number;
    exampleChunks: number;
    uniqueDocs: number;
  } | null;
  handbooks: SearchResponseItem[];
  examples: SearchResponseItem[];
}

function formatResult(result: SearchResult): SearchResponseItem {
  // Create a snippet (first 300 chars)
  const snippet =
    result.chunk.text.length > 300
      ? result.chunk.text.slice(0, 300) + "..."
      : result.chunk.text;

  return {
    id: result.chunk.id,
    folderType: result.chunk.folderType,
    docName: result.chunk.docName,
    docPath: result.chunk.docPath,
    pageNumber: result.chunk.pageNumber,
    sectionOrFigure: result.chunk.sectionOrFigure,
    score: Math.round(result.score * 10000) / 10000, // Round to 4 decimal places
    snippet: snippet.replace(/\s+/g, " ").trim(), // Normalize whitespace
  };
}

export async function POST(req: NextRequest) {
  // Dev-only check (optional - remove in production if you want this endpoint)
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "This endpoint is only available in development mode" },
      { status: 403 }
    );
  }

  // Check if index is available
  if (!isIndexAvailable()) {
    const error = getIndexError() || "RAG index not available";
    return NextResponse.json(
      {
        error,
        hint: "Run 'npm run rag:ingest' to build the index",
      },
      { status: 503 }
    );
  }

  // Parse request body
  let body: SearchRequest;
  try {
    body = (await req.json()) as SearchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate query
  if (!body.query || typeof body.query !== "string" || body.query.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or empty 'query' field" },
      { status: 400 }
    );
  }

  const query = body.query.trim();
  const k = typeof body.k === "number" && body.k > 0 ? Math.min(body.k, 20) : 5;

  console.log(`[rag-search] Query: "${query.slice(0, 100)}..." k=${k}`);

  try {
    // Search handbooks and examples
    const [handbookResults, exampleResults] = await Promise.all([
      searchHandbooks(query, k),
      searchExamples(query, k),
    ]);

    const response: SearchResponse = {
      query,
      indexStats: getIndexStats(),
      handbooks: handbookResults.map(formatResult),
      examples: exampleResults.map(formatResult),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[rag-search] Search failed:", error);
    return NextResponse.json(
      {
        error: "Search failed",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// GET endpoint for quick stats check
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "This endpoint is only available in development mode" },
      { status: 403 }
    );
  }

  if (!isIndexAvailable()) {
    const error = getIndexError() || "RAG index not available";
    return NextResponse.json(
      {
        status: "not_ready",
        error,
        hint: "Run 'npm run rag:ingest' to build the index",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    status: "ready",
    stats: getIndexStats(),
  });
}

