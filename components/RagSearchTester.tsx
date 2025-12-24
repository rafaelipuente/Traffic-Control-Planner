"use client";

import { useState, useMemo } from "react";

interface SearchResult {
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
  handbooks: SearchResult[];
  examples: SearchResult[];
  error?: string;
}

export default function RagSearchTester() {
  const [query, setQuery] = useState("lane closure 35 mph taper length");
  const [k, setK] = useState(5);
  const [handbooksOnly, setHandbooksOnly] = useState(false);
  const [examplesOnly, setExamplesOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResponse | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) {
      setError("Query cannot be empty");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch("/api/rag-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), k }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || `Request failed with status ${response.status}`);
        return;
      }

      setResults(data as SearchResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  // Raw results from API (NEVER mutated)
  const rawHandbooks = results?.handbooks ?? [];
  const rawExamples = results?.examples ?? [];

  // Raw counts from API (unchanged)
  const fetchedHandbookCount = rawHandbooks.length;
  const fetchedExampleCount = rawExamples.length;

  // DEV: Log folderType values when results change
  useMemo(() => {
    if (process.env.NODE_ENV === "development" && results) {
      const allResults = [...rawHandbooks, ...rawExamples];
      const folderTypes = Array.from(new Set(allResults.map(r => r.folderType)));
      console.log("[rag] folderType values:", folderTypes);
      console.log("[rag] rawHandbooks:", rawHandbooks.length, "rawExamples:", rawExamples.length);
    }
  }, [results, rawHandbooks, rawExamples]);

  // Filter results based on checkboxes using useMemo for instant updates
  const { displayedHandbooks, displayedExamples, showBothBanner } = useMemo(() => {
    // Explicit filter logic - no ambiguity
    const hbOnly = handbooksOnly === true;
    const exOnly = examplesOnly === true;

    let filteredHandbooks: SearchResult[];
    let filteredExamples: SearchResult[];
    let bothEnabled = false;

    if (hbOnly && exOnly) {
      // BOTH checked → show all + banner
      filteredHandbooks = rawHandbooks;
      filteredExamples = rawExamples;
      bothEnabled = true;
    } else if (hbOnly && !exOnly) {
      // ONLY handbooks checked → hide examples
      filteredHandbooks = rawHandbooks;
      filteredExamples = [];
    } else if (exOnly && !hbOnly) {
      // ONLY examples checked → hide handbooks
      filteredHandbooks = [];
      filteredExamples = rawExamples;
    } else {
      // NEITHER checked → show all, no banner
      filteredHandbooks = rawHandbooks;
      filteredExamples = rawExamples;
    }

    // DEV: Assertions
    if (process.env.NODE_ENV === "development") {
      console.log(`[rag] Filter state: HB=${hbOnly} EX=${exOnly} → displayedH=${filteredHandbooks.length} displayedE=${filteredExamples.length} banner=${bothEnabled}`);
      
      if (exOnly && !hbOnly && filteredHandbooks.length > 0) {
        console.error("[rag] BUG: handbook rows shown in examplesOnly mode");
      }
      if (hbOnly && !exOnly && filteredExamples.length > 0) {
        console.error("[rag] BUG: example rows shown in handbooksOnly mode");
      }
    }

    return {
      displayedHandbooks: filteredHandbooks,
      displayedExamples: filteredExamples,
      showBothBanner: bothEnabled,
    };
  }, [rawHandbooks, rawExamples, handbooksOnly, examplesOnly]);

  // Displayed counts (computed from filtered results)
  const displayedHandbookCount = displayedHandbooks.length;
  const displayedExampleCount = displayedExamples.length;

  return (
    <div
      data-testid="rag-panel"
      className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 mt-6"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded">
          DEV ONLY
        </span>
        <h3 className="text-lg font-semibold text-yellow-900">
          RAG Search Tester
        </h3>
      </div>

      {/* Inputs */}
      <div className="space-y-3 mb-4">
        {/* Query Input */}
        <div>
          <label
            htmlFor="rag-query"
            className="block text-sm font-medium text-yellow-800 mb-1"
          >
            Query
          </label>
          <input
            id="rag-query"
            data-testid="rag-query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter search query..."
            className="w-full px-3 py-2 border border-yellow-300 rounded-md bg-white text-gray-800 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
          />
        </div>

        {/* K Input */}
        <div className="flex items-center gap-4">
          <div>
            <label
              htmlFor="rag-k"
              className="block text-sm font-medium text-yellow-800 mb-1"
            >
              Results (k)
            </label>
            <input
              id="rag-k"
              data-testid="rag-k"
              type="number"
              min={1}
              max={20}
              value={k}
              onChange={(e) => setK(Math.min(20, Math.max(1, parseInt(e.target.value) || 5)))}
              className="w-20 px-3 py-2 border border-yellow-300 rounded-md bg-white text-gray-800 focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400"
            />
          </div>

          {/* Filter Checkboxes */}
          <div className="flex items-center gap-4 mt-5">
            <label className="flex items-center gap-2 text-sm text-yellow-800 cursor-pointer">
              <input
                type="checkbox"
                checked={handbooksOnly}
                onChange={(e) => setHandbooksOnly(e.target.checked)}
                className="w-4 h-4 rounded border-yellow-400 text-yellow-600 focus:ring-yellow-400"
              />
              Handbooks only
            </label>
            <label className="flex items-center gap-2 text-sm text-yellow-800 cursor-pointer">
              <input
                type="checkbox"
                checked={examplesOnly}
                onChange={(e) => setExamplesOnly(e.target.checked)}
                className="w-4 h-4 rounded border-yellow-400 text-yellow-600 focus:ring-yellow-400"
              />
              Examples only
            </label>
            {/* DEV: Filter state debug */}
            {process.env.NODE_ENV === "development" && (
              <span className="text-xs text-gray-400 font-mono ml-2">
                [HB={handbooksOnly ? "on" : "off"} EX={examplesOnly ? "on" : "off"}]
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Search Button */}
      <button
        data-testid="rag-run"
        onClick={handleSearch}
        disabled={isLoading}
        className="w-full py-2 px-4 bg-yellow-500 text-yellow-900 font-semibold rounded-md hover:bg-yellow-400 disabled:bg-yellow-300 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? "Searching…" : "Run RAG Search"}
      </button>

      {/* Error Display */}
      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-800 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {results && (
        <div data-testid="rag-results" className="mt-4">
          {/* Dual Counters - Fetched vs Displayed */}
          <div className="bg-white border border-yellow-200 rounded-md p-3 mb-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-yellow-700 font-medium mb-1">Fetched:</div>
                <div className="text-gray-700">
                  Handbooks: <strong>{fetchedHandbookCount}</strong>, Examples: <strong>{fetchedExampleCount}</strong>
                </div>
              </div>
              <div>
                <div className="text-yellow-700 font-medium mb-1">Displayed:</div>
                <div className="text-gray-700">
                  Handbooks: <strong className={displayedHandbookCount !== fetchedHandbookCount ? "text-orange-600" : ""}>{displayedHandbookCount}</strong>, 
                  Examples: <strong className={displayedExampleCount !== fetchedExampleCount ? "text-orange-600" : ""}>{displayedExampleCount}</strong>
                </div>
              </div>
            </div>
            {showBothBanner && (
              <div className="mt-2 text-xs text-yellow-600 italic">
                ℹ️ Both filters enabled = showing all results
              </div>
            )}
            {results.indexStats && (
              <div className="mt-2 text-xs text-gray-500">
                Index: {results.indexStats.totalChunks} chunks, {results.indexStats.uniqueDocs} docs
              </div>
            )}
          </div>

          {/* Results List */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {[...displayedHandbooks, ...displayedExamples].map((result) => (
              <div
                key={result.id}
                className="bg-white border border-yellow-200 rounded-md p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        result.folderType === "handbook"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {result.folderType.toUpperCase()}
                    </span>
                    <span className="font-medium text-gray-800 text-sm">
                      {result.docName}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 font-mono">
                    {result.score.toFixed(4)}
                  </span>
                </div>

                {(result.pageNumber || result.sectionOrFigure) && (
                  <div className="text-xs text-gray-500 mb-1">
                    {result.pageNumber && <span>Page {result.pageNumber}</span>}
                    {result.pageNumber && result.sectionOrFigure && <span> • </span>}
                    {result.sectionOrFigure && <span>{result.sectionOrFigure}</span>}
                  </div>
                )}

                <p className="text-xs text-gray-600 leading-relaxed">
                  {result.snippet.length > 220
                    ? result.snippet.slice(0, 220) + "..."
                    : result.snippet}
                </p>
              </div>
            ))}

            {displayedHandbookCount === 0 && displayedExampleCount === 0 && (
              <p className="text-sm text-yellow-700 text-center py-4">
                No results match the current filters.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
