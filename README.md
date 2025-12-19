# TCP Planner

AI-powered Traffic Control Plan Generator using MUTCD guidelines and real-world examples.

## Overview

TCP Planner is a minimal, AI-first MVP for generating draft Traffic Control Plans. Users can:

1. **Search for a location** on an interactive map
2. **Draw a work zone** (rectangle or polygon) to define the affected area
3. **Enter job details** (road type, speed, work type, length, day/night)
4. **Generate a draft TCP** with AI assistance
5. **View structured plan details** including spacing, taper, buffer, and device counts
6. **Preview a schematic SVG diagram** of the traffic control setup

## Features

- **Real LLM integration**: Uses OpenAI-compatible API for plan generation
- **Source-grounded responses**: AI bases recommendations on handbook excerpts from `tcp handbooks/` and examples from `tcp examples/`
- **Deterministic SVG diagrams**: Server-generated diagrams ensure consistency
- **Structured validation**: All API responses are validated against strict schemas
- **No mock data**: Every plan is generated in real-time from actual model calls

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- An OpenAI API key (or compatible API)
- A Mapbox access token

### Environment Variables

Create a `.env.local` file in the project root:

```bash
# Required: OpenAI-compatible API credentials
OPENAI_API_KEY="sk-your-api-key-here"
OPENAI_MODEL="gpt-4o"

# Optional: Custom API endpoint (defaults to OpenAI)
# OPENAI_BASE_URL="https://api.openai.com/v1/chat/completions"

# Required: Mapbox access token for map + geocoding
NEXT_PUBLIC_MAP_TOKEN="pk.your-mapbox-token-here"
```

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000/planner](http://localhost:3000/planner) in your browser.

## Project Structure

```
TCPME/
├── app/
│   ├── api/
│   │   └── draft-tcp/
│   │       └── route.ts      # POST endpoint for TCP generation
│   ├── planner/
│   │   └── page.tsx          # Main planner UI
│   ├── globals.css           # Global styles
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Redirects to /planner
├── components/
│   ├── JobDetailsForm.tsx    # Job details input form
│   ├── MapSelector.tsx       # Mapbox map with draw tools
│   └── OutputPanel.tsx       # Response display panel
├── lib/
│   ├── retrieval.ts          # Document retrieval from handbooks/examples
│   └── tcpTypes.ts           # TypeScript types and Zod schemas
├── tcp handbooks/            # Authoritative TCP rule documents (PDF)
├── tcp examples/             # Real-world TCP examples (PDF, images)
└── README.md
```

## API Reference

### POST /api/draft-tcp

Generates a draft Traffic Control Plan.

#### Request Body (`TcpDraftRequest`)

```json
{
  "geometry": {
    "type": "bbox",
    "bbox": [-122.42, 37.77, -122.41, 37.78]
  },
  "locationLabel": "San Francisco, CA",
  "roadType": "2_lane_undivided",
  "postedSpeedMph": 35,
  "workType": "lane_closure",
  "workLengthFt": 500,
  "isNight": false,
  "notes": "Near intersection"
}
```

#### Response Body (`TcpDraftResponse`)

```json
{
  "summary": "Short job-site description...",
  "plan": {
    "recommendedLayout": "Typical Application 6C-2",
    "signSpacing": [
      { "label": "A", "distanceFt": 350 },
      { "label": "B", "distanceFt": 350 },
      { "label": "C", "distanceFt": 350 }
    ],
    "taperLengthFt": 175,
    "bufferLengthFt": 100,
    "devices": {
      "cones": 24,
      "signs": 6,
      "arrowBoard": true,
      "flaggers": 0
    }
  },
  "assumptions": ["Assumes normal traffic conditions..."],
  "references": ["HB::mutcd11thedition::p123::Table6C-2"],
  "svgContent": "<svg>...</svg>"
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid request body | Missing or invalid fields in request |
| 500 | Missing environment configuration | API key or model not set |
| 500 | No applicable handbook guidance found | No relevant rules in source documents |
| 500 | Invalid JSON from model | Model returned non-JSON output |
| 500 | Model response failed validation | Model output failed schema validation |
| 502 | Model API error | Upstream API returned error |

## Source Documents

### tcp handbooks/

Authoritative TCP rulebooks and standards:
- MUTCD (Manual on Uniform Traffic Control Devices)
- State/local traffic control manuals
- DOT guidelines

These documents define what is **required** and **compliant**.

### tcp examples/

Real-world Traffic Control Plan examples:
- Actual TCP drawings
- Site-specific implementations
- Layout patterns

These show what **good TCPs look like in practice**.

**Important**: These folders are read-only knowledge sources. The AI retrieves from them but never modifies them.

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## RAG (Retrieval-Augmented Generation)

TCP Planner uses RAG to ground AI responses in your actual handbook and example documents.

### Building the Index

Before the retriever can work, you need to ingest your PDF documents:

```bash
# Make sure OPENAI_API_KEY is set (for generating embeddings)
npm run rag:ingest
```

This will:
1. Extract text from PDFs in `tcp handbooks/` and `tcp examples/`
2. Chunk the text (~500 tokens per chunk)
3. Generate embeddings using OpenAI's `text-embedding-3-small`
4. Write index files to `rag_index/` (gitignored)

**Note**: The `rag_index/` folder is generated output and should not be committed.

### Testing Retrieval (Dev Only)

A dev-only endpoint is available to test retrieval without calling the LLM:

```bash
# Check if index is ready
curl http://localhost:3000/api/rag-search

# Search for relevant chunks
curl -X POST http://localhost:3000/api/rag-search \
  -H "Content-Type: application/json" \
  -d '{"query": "sign spacing for 35 mph road", "k": 5}'
```

**Response:**
```json
{
  "query": "sign spacing for 35 mph road",
  "indexStats": {
    "totalChunks": 245,
    "handbookChunks": 180,
    "exampleChunks": 65,
    "uniqueDocs": 10
  },
  "handbooks": [
    {
      "id": "handbook-mutcd11thedition-chunk-42",
      "docName": "mutcd11thedition",
      "score": 0.8523,
      "snippet": "Table 6C-2 shows sign spacing..."
    }
  ],
  "examples": [...]
}
```

### RAG Index Files

The `rag_index/` folder contains:
- `chunks.jsonl` - Text chunks with metadata
- `embeddings.jsonl` - Vector embeddings for each chunk

These files are automatically generated and should be re-built whenever source documents change.

## License

Private project - All rights reserved.
