import { NextRequest, NextResponse } from "next/server";
import {
  MAX_SVG_LENGTH,
  TcpDraftRequest,
  TcpDraftResponse,
  TcpPlan,
  tcpDraftRequestSchema,
} from "@/lib/tcpTypes";
import {
  RetrievalQueryContext,
  formatCitation,
  retrieveSupport,
} from "@/lib/retrieval";

export const runtime = "nodejs";

const MODEL_API_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";

type ErrorBody = Record<string, unknown>;

function jsonError(status: number, body: ErrorBody) {
  return NextResponse.json(body, { status });
}

function validateGeometry(req: TcpDraftRequest): string[] {
  const issues: string[] = [];
  const { geometry } = req;

  if (geometry.type === "bbox") {
    if (!geometry.bbox || geometry.bbox.length !== 4) {
      issues.push("geometry.bbox must be a 4-element array [west,south,east,north]");
    }
    if (geometry.polygon) {
      issues.push("geometry.polygon must be omitted when geometry.type = \"bbox\"");
    }
  } else if (geometry.type === "polygon") {
    if (
      !geometry.polygon ||
      geometry.polygon.length !== 1 ||
      geometry.polygon[0].length < 3
    ) {
      issues.push(
        "geometry.polygon must be a single unclosed ring with at least 3 [lng,lat] points when geometry.type = \"polygon\""
      );
    }
    if (geometry.bbox) {
      issues.push("geometry.bbox must be omitted when geometry.type = \"polygon\"");
    }
  } else {
    issues.push("geometry.type must be \"bbox\" or \"polygon\"");
  }

  return issues;
}

function validateDraftResponse(
  candidate: unknown
): { ok: true; value: TcpDraftResponse } | { ok: false; issues: string[] } {
  const issues: string[] = [];

  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, issues: ["Model output is not an object"] };
  }

  const obj = candidate as Record<string, unknown>;

  if (typeof obj.summary !== "string") {
    issues.push("summary must be a string");
  }

  if (typeof obj.svgContent !== "string") {
    issues.push("svgContent must be a string");
  } else if (obj.svgContent.length > MAX_SVG_LENGTH) {
    issues.push("svgContent exceeds maximum length");
  }

  if (!Array.isArray(obj.assumptions)) {
    issues.push("assumptions must be an array of strings");
  } else if (!obj.assumptions.every((a) => typeof a === "string")) {
    issues.push("assumptions must contain only strings");
  }

  if (!Array.isArray(obj.references)) {
    issues.push("references must be an array of strings");
  } else if (!obj.references.every((r) => typeof r === "string")) {
    issues.push("references must contain only strings");
  }

  if (typeof obj.plan !== "object" || obj.plan === null) {
    issues.push("plan must be an object");
  } else {
    const plan = obj.plan as Record<string, unknown>;

    if (typeof plan.recommendedLayout !== "string") {
      issues.push("plan.recommendedLayout must be a string");
    }

    if (!Array.isArray(plan.signSpacing)) {
      issues.push("plan.signSpacing must be an array");
    } else {
      const labels = new Set<string>();
      for (const [index, item] of (plan.signSpacing as unknown[]).entries()) {
        const path = `plan.signSpacing[${index}]`;
        if (typeof item !== "object" || item === null) {
          issues.push(`${path} must be an object`);
          continue;
        }
        const s = item as Record<string, unknown>;
        if (s.label !== "A" && s.label !== "B" && s.label !== "C") {
          issues.push(`${path}.label must be \"A\", \"B\", or \"C\"`);
        } else {
          labels.add(s.label as string);
        }
        if (typeof s.distanceFt !== "number" || !Number.isFinite(s.distanceFt)) {
          issues.push(`${path}.distanceFt must be a finite number`);
        }
      }
      ["A", "B", "C"].forEach((label) => {
        if (!labels.has(label)) {
          issues.push(`plan.signSpacing must include label ${label}`);
        }
      });
    }

    if (
      typeof plan.taperLengthFt !== "number" ||
      !Number.isFinite(plan.taperLengthFt) ||
      plan.taperLengthFt <= 0
    ) {
      issues.push("plan.taperLengthFt must be a number > 0");
    }

    if (
      typeof plan.bufferLengthFt !== "number" ||
      !Number.isFinite(plan.bufferLengthFt) ||
      plan.bufferLengthFt <= 0
    ) {
      issues.push("plan.bufferLengthFt must be a number > 0");
    }

    if (typeof plan.devices !== "object" || plan.devices === null) {
      issues.push("plan.devices must be an object");
    } else {
      const d = plan.devices as Record<string, unknown>;
      if (typeof d.cones !== "number" || !Number.isFinite(d.cones) || d.cones < 0) {
        issues.push("plan.devices.cones must be a number >= 0");
      }
      if (typeof d.signs !== "number" || !Number.isFinite(d.signs) || d.signs < 0) {
        issues.push("plan.devices.signs must be a number >= 0");
      }
      if (typeof d.arrowBoard !== "boolean") {
        issues.push("plan.devices.arrowBoard must be a boolean");
      }
      if (
        typeof d.flaggers !== "number" ||
        !Number.isFinite(d.flaggers) ||
        d.flaggers < 0
      ) {
        issues.push("plan.devices.flaggers must be a number >= 0");
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: obj as TcpDraftResponse };
}

function buildRetrievalContext(req: TcpDraftRequest): RetrievalQueryContext {
  return {
    roadType: req.roadType,
    postedSpeedMph: req.postedSpeedMph,
    workType: req.workType,
    workLengthFt: req.workLengthFt,
    isNight: req.isNight,
    notes: req.notes,
  };
}

function buildSystemPrompt(): string {
  return [
    "You are a traffic control planning assistant.",
    "You draft temporary traffic control plans strictly based on the provided handbook and example excerpts.",
    "",
    "Rules:",
    "- Use ONLY the provided handbook (HB::...) and example (EX::...) excerpts for numeric rules and layout patterns.",
    "- Do NOT use any outside knowledge beyond these excerpts.",
    "- Handbooks (HB) always override examples (EX) when there is any conflict.",
    "- Every numeric value for sign spacing (A/B/C), taperLengthFt, bufferLengthFt, and device counts must be traceable to at least one provided excerpt.",
    "- For each such numeric field, include at least one matching citation string in the references array.",
    "- If you cannot find applicable guidance for any required numeric field in the excerpts, use reasonable MUTCD defaults and note this in assumptions[].",
    "",
    "Planner Notes (HIGH PRIORITY):",
    "- Treat planner notes as intentional guidance from a human planner.",
    "- Planner notes may add constraints, override defaults, add safety considerations, or request specific devices, layouts, or handling.",
    "- Incorporate planner notes wherever possible.",
    "- If planner notes conflict with handbook rules, handbook rules still win, but you MUST state the conflict clearly in assumptions[].",
    "- When planner notes materially influence the plan, include an assumption like: \"Planner notes requested X; plan adjusted by Y.\"",
    "- If planner notes could not be applied, state why in assumptions[] (e.g., conflicts with handbook guidance).",
    "",
    "Citation format for references:",
    '- Handbooks:  "HB::<docName>::p<pageNumber>::<sectionOrTableId>"',
    '- Examples:   "EX::<docName>::p<pageNumber>::<figureId>"',
    "",
    "=== STRICT OUTPUT REQUIREMENTS ===",
    "You MUST output a single JSON object only. No markdown, no backticks, no text before or after.",
    "",
    "REQUIRED FIELDS (all must be present):",
    "- summary: string (short description of the plan)",
    "- plan: object with ALL sub-fields below",
    "- plan.recommendedLayout: string (e.g., \"Typical Application 6C-2\")",
    "- plan.signSpacing: array with EXACTLY 3 objects for labels \"A\", \"B\", \"C\" (uppercase)",
    "  - Each object: { \"label\": \"A\"|\"B\"|\"C\", \"distanceFt\": number }",
    "  - distanceFt must be a NUMBER (not string), e.g., 350 not \"350\"",
    "- plan.taperLengthFt: number > 0",
    "- plan.bufferLengthFt: number > 0",
    "- plan.devices: object with cones (number >= 0), signs (number >= 0), arrowBoard (boolean), flaggers (number >= 0)",
    "- assumptions: string[] (array of strings)",
    "- references: string[] (array of citation strings)",
    "- svgContent: string - MUST be exactly \"<svg></svg>\" (server generates the real SVG)",
    "",
    "EXAMPLE OUTPUT (use this exact structure):",
    '{',
    '  "summary": "Lane closure TCP for 35 mph 2-lane road, daytime work.",',
    '  "plan": {',
    '    "recommendedLayout": "Typical Application 6C-2",',
    '    "signSpacing": [',
    '      { "label": "A", "distanceFt": 350 },',
    '      { "label": "B", "distanceFt": 350 },',
    '      { "label": "C", "distanceFt": 350 }',
    '    ],',
    '    "taperLengthFt": 180,',
    '    "bufferLengthFt": 100,',
    '    "devices": { "cones": 20, "signs": 6, "arrowBoard": true, "flaggers": 0 }',
    '  },',
    '  "assumptions": ["Based on 35 mph posted speed.", "Daytime work assumed."],',
    '  "references": ["HB::mutcd::p123::Table6C-2"],',
    '  "svgContent": "<svg></svg>"',
    '}',
    "",
    "CRITICAL REMINDERS:",
    "- signSpacing MUST include all three labels: A, B, and C",
    "- All numeric values must be JSON numbers, not strings",
    "- arrowBoard must be true or false (boolean), not a string",
    "- svgContent MUST be \"<svg></svg>\" - the server overwrites it",
  ].join("\n");
}

function buildContextPrompt(handbookText: string, exampleText: string): string {
  return [
    "You are given excerpts from official TCP handbooks (HB) and real TCP examples (EX).",
    "Use handbooks for authoritative numeric rules, and examples only for pattern/context.",
    "",
    "=== HANDBOOK EXCERPTS (HB) ===",
    handbookText || "(none)",
    "",
    "=== EXAMPLE EXCERPTS (EX) ===",
    exampleText || "(none)",
  ].join("\n");
}

function buildUserPrompt(req: TcpDraftRequest): string {
  const { geometry, locationLabel, roadType, postedSpeedMph, workType, workLengthFt, isNight, notes } =
    req;

  const parts: string[] = [];
  parts.push("Draft a temporary traffic control plan for the following job.");
  parts.push("");
  parts.push(
    `Location: ${locationLabel ?? "unspecified label"}, roadType=${roadType}, speed=${postedSpeedMph} mph, workType=${workType}, workLength=${workLengthFt} ft, time=${
      isNight ? "night" : "day"
    }.`
  );

  if (geometry.type === "bbox" && geometry.bbox) {
    const [west, south, east, north] = geometry.bbox;
    parts.push(
      `Geometry: bbox [west=${west}, south=${south}, east=${east}, north=${north}] (units: degrees longitude/latitude).`
    );
  } else if (geometry.type === "polygon" && geometry.polygon) {
    parts.push(
      `Geometry: polygon with ${geometry.polygon[0]?.length ?? 0} vertices (unclosed ring, coordinates [lng,lat]).`
    );
  }

  if (notes) {
    parts.push("");
    parts.push("=== PLANNER NOTES (HIGH PRIORITY) ===");
    parts.push(notes);
    parts.push("=== END PLANNER NOTES ===");
    parts.push("");
    parts.push("Remember: Incorporate planner notes where possible and document how they affected the plan in assumptions[].");
  }

  parts.push("");
  parts.push(
    "You must base all numeric values on the provided handbook excerpts. If suitable guidance is missing for any required numeric field, you must say so in assumptions and you must not invent values."
  );

  return parts.join("\n");
}

function generateSvgFromPlan(plan: TcpPlan): string {
  const width = 800;
  const height = 400;

  const totalApproach =
    plan.taperLengthFt + plan.bufferLengthFt + (plan.signSpacing[0]?.distanceFt ?? 0);

  const scale =
    totalApproach > 0 ? Math.min(500 / totalApproach, 2) : 1;

  const laneWidth = 80;
  const centerX = width / 2;
  const roadTop = 40;
  const roadBottom = height - 40;

  const workZoneHeight = Math.min(120, height / 3);
  const workZoneTop = height / 2 - workZoneHeight / 2;
  const workZoneBottom = workZoneTop + workZoneHeight;

  const bufferPx = plan.bufferLengthFt * scale;
  const taperPx = plan.taperLengthFt * scale;

  const workZoneStartY = workZoneTop;
  const taperEndY = workZoneStartY;
  const taperStartY = taperEndY + taperPx;
  const bufferStartY = tapperClamp(taperStartY + bufferPx, roadTop, roadBottom);

  const a = plan.signSpacing.find((s) => s.label === "A");
  const b = plan.signSpacing.find((s) => s.label === "B");
  const c = plan.signSpacing.find((s) => s.label === "C");

  const baseSignY = bufferStartY;
  const signAY = baseSignY + (a ? a.distanceFt * scale : 0);
  const signBY = baseSignY + (b ? b.distanceFt * scale : 0);
  const signCY = baseSignY + (c ? c.distanceFt * scale : 0);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f5f5f5" />
  <rect x="${centerX - laneWidth / 2}" y="${roadTop}" width="${laneWidth}" height="${
    roadBottom - roadTop
  }" fill="#d4d4d4" />
  <line x1="${centerX}" y1="${roadTop}" x2="${centerX}" y2="${roadBottom}" stroke="#ffffff" stroke-width="4" stroke-dasharray="16 12" />
  <rect x="${centerX - laneWidth / 2}" y="${workZoneTop}" width="${laneWidth}" height="${workZoneHeight}" fill="#f97316" opacity="0.85" />
  <text x="${centerX}" y="${workZoneTop - 8}" text-anchor="middle" font-size="14" fill="#111827">
    Work zone
  </text>
  <polygon points="${centerX - laneWidth / 2},${taperStartY} ${centerX + laneWidth / 2},${taperStartY} ${centerX + laneWidth / 2},${taperEndY} ${centerX - laneWidth / 2},${taperEndY}" fill="#fed7aa" />
  <text x="${centerX + laneWidth / 2 + 8}" y="${(taperStartY + taperEndY) / 2}" font-size="12" fill="#374151">
    Taper ~ ${plan.taperLengthFt.toFixed(0)} ft
  </text>
  <rect x="${centerX - laneWidth / 2}" y="${bufferStartY}" width="${laneWidth}" height="${
    taperStartY - bufferStartY
  }" fill="#fee2e2" />
  <text x="${centerX + laneWidth / 2 + 8}" y="${
    (bufferStartY + taperStartY) / 2
  }" font-size="12" fill="#374151">
    Buffer ~ ${plan.bufferLengthFt.toFixed(0)} ft
  </text>
  <text x="${centerX}" y="${height - 10}" text-anchor="middle" font-size="12" fill="#111827">
    Approach from bottom → upstream to downstream
  </text>
  ${renderSign(centerX, signAY, "A")}
  ${renderSign(centerX, signBY, "B")}
  ${renderSign(centerX, signCY, "C")}
  ${plan.devices.arrowBoard ? renderArrowBoard(centerX, taperStartY + 20) : ""}
</svg>
`;

  return svg.length > MAX_SVG_LENGTH ? svg.slice(0, MAX_SVG_LENGTH) : svg;
}

function tapperClamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function renderSign(centerX: number, y: number, label: string): string {
  if (!Number.isFinite(y)) return "";
  const size = 28;
  const x = centerX - 140;
  const half = size / 2;
  const points = [
    `${x},${y - half}`,
    `${x + half},${y}`,
    `${x},${y + half}`,
    `${x - half},${y}`,
  ].join(" ");

  return `
  <polygon points="${points}" fill="#fde68a" stroke="#92400e" stroke-width="2" />
  <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="14" fill="#111827" font-weight="bold">
    ${label}
  </text>
  `;
}

function renderArrowBoard(centerX: number, y: number): string {
  const width = 70;
  const height = 30;
  const x = centerX + 120;

  return `
  <rect x="${x}" y="${y - height / 2}" width="${width}" height="${height}" rx="4" fill="#111827" />
  <circle cx="${x + 14}" cy="${y}" r="3" fill="#f97316" />
  <circle cx="${x + 26}" cy="${y}" r="3" fill="#f97316" />
  <circle cx="${x + 38}" cy="${y}" r="3" fill="#f97316" />
  <circle cx="${x + 50}" cy="${y}" r="3" fill="#f97316" />
  <text x="${x + width / 2}" y="${y + 22}" text-anchor="middle" font-size="11" fill="#374151">
    Arrow board
  </text>
  `;
}

export async function POST(req: NextRequest) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonError(400, {
      error: "Invalid request body",
      details: { issues: ["Request body must be valid JSON"] },
    });
  }

  const parsedReq = tcpDraftRequestSchema.safeParse(body);
  const issues: string[] = [];

  if (!parsedReq.success) {
    parsedReq.error.issues.forEach((i) => {
      issues.push(i.message);
    });
  } else {
    issues.push(...validateGeometry(parsedReq.data));
  }

  if (issues.length > 0) {
    return jsonError(400, { error: "Invalid request body", details: { issues } });
  }

  const tcpReq = parsedReq.data as TcpDraftRequest;

  const missingEnv: string[] = [];
  if (!process.env.OPENAI_API_KEY) missingEnv.push("OPENAI_API_KEY");
  if (!process.env.OPENAI_MODEL) missingEnv.push("OPENAI_MODEL");

  if (missingEnv.length > 0) {
    return jsonError(500, {
      error: "Missing environment configuration",
      details: { missing: missingEnv },
    });
  }

  const retrievalCtx = buildRetrievalContext(tcpReq);

  const { handbookChunks, exampleChunks } = await retrieveSupport(retrievalCtx);

  if (handbookChunks.length === 0) {
    return jsonError(500, {
      error: "No applicable handbook guidance found",
      details: {
        message:
          "Could not find relevant spacing/taper/buffer/device guidance in tcp handbooks/ for this scenario.",
      },
    });
  }

  const handbookText = handbookChunks
    .map(
      (c, idx) =>
        `[HB${idx + 1}] ${formatCitation(c)}\n${c.text.slice(0, 1200)}`
    )
    .join("\n\n");

  const exampleText = exampleChunks
    .map(
      (c, idx) =>
        `[EX${idx + 1}] ${formatCitation(c)}\n${c.text.slice(0, 800)}`
    )
    .join("\n\n");

  const systemPrompt = buildSystemPrompt();
  const contextPrompt = buildContextPrompt(handbookText, exampleText);
  const userPrompt = buildUserPrompt(tcpReq);

  const apiKey = process.env.OPENAI_API_KEY as string;
  const model = process.env.OPENAI_MODEL as string;

  // Validate model name format (warn on suspicious names)
  const knownModels = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1", "o1-mini", "o1-preview"];
  const isKnownModel = knownModels.some(m => model.startsWith(m));
  if (!isKnownModel) {
    console.warn(`[draft-tcp] Warning: Model "${model}" is not a recognized OpenAI model. Known models: ${knownModels.join(", ")}`);
  }

  // Combine system + context into a single system message for better compatibility
  const combinedSystemPrompt = `${systemPrompt}\n\n${contextPrompt}`;

  const requestBody = {
    model,
    messages: [
      { role: "system", content: combinedSystemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
  };

  console.log("[draft-tcp] Calling model API:", MODEL_API_URL);
  console.log("[draft-tcp] Model:", model);
  console.log("[draft-tcp] System prompt length:", combinedSystemPrompt.length);
  console.log("[draft-tcp] User prompt length:", userPrompt.length);

  let response: Response;
  try {
    response = await fetch(MODEL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (fetchError) {
    const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error("[draft-tcp] Fetch error:", errMsg);
    return jsonError(502, {
      error: "Model API error",
      status: 502,
      details: {
        upstreamStatus: 0,
        upstreamBody: `Network error: ${errMsg}`.slice(0, 2000),
      },
    });
  }

  if (!response.ok) {
    const upstreamBody = await response.text();
    const requestId = response.headers.get("x-request-id") || response.headers.get("request-id");
    
    // Server-side logging for debugging
    console.error("[draft-tcp] Model API error:");
    console.error("  - upstream status:", response.status);
    console.error("  - upstream body:", upstreamBody.slice(0, 2000));
    if (requestId) {
      console.error("  - request id:", requestId);
    }

    // Extract the actual error message from OpenAI response for clearer UI display
    let errorMessage = "Model API error";
    let errorCode: string | undefined;
    try {
      const parsed = JSON.parse(upstreamBody);
      if (parsed?.error?.message) {
        errorMessage = parsed.error.message;
        errorCode = parsed.error.code;
      }
    } catch {
      // Keep default error message if parsing fails
    }

    // Provide actionable error messages for common issues
    if (response.status === 429) {
      errorMessage = `OpenAI quota exceeded: ${errorMessage}`;
    } else if (response.status === 401) {
      errorMessage = `Invalid API key: ${errorMessage}`;
    } else if (response.status === 404) {
      errorMessage = `Model "${model}" not found. Check OPENAI_MODEL in .env.local. Valid models: gpt-4o, gpt-4-turbo, gpt-3.5-turbo`;
    }

    return jsonError(502, {
      error: errorMessage,
      status: 502,
      details: {
        upstreamStatus: response.status,
        upstreamBody: upstreamBody.slice(0, 2000),
        ...(requestId && { requestId }),
        ...(errorCode && { errorCode }),
      },
    });
  }

  let completionJson: unknown;
  try {
    completionJson = await response.json();
  } catch (parseErr) {
    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error("[draft-tcp] Failed to parse API response as JSON:", errMsg);
    return jsonError(500, {
      error: "Invalid JSON from model",
      rawText: `Failed to parse API response: ${errMsg}`,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawText: string = (completionJson as any)?.choices?.[0]?.message?.content ?? "";

  console.log("[draft-tcp] Model response received, content length:", rawText.length);

  if (typeof rawText !== "string" || !rawText.trim()) {
    console.error("[draft-tcp] Empty or invalid content from model");
    return jsonError(500, {
      error: "Invalid JSON from model",
      rawText: rawText ? String(rawText).slice(0, 2000) : "(empty response)",
    });
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    console.error("[draft-tcp] No valid JSON object found in model response");
    return jsonError(500, {
      error: "Invalid JSON from model",
      rawText: rawText.slice(0, 2000),
    });
  }

  const jsonSlice = rawText.slice(firstBrace, lastBrace + 1);

  let candidate: unknown;
  try {
    candidate = JSON.parse(jsonSlice);
  } catch (jsonErr) {
    const errMsg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
    console.error("[draft-tcp] JSON parse failed:", errMsg);
    return jsonError(500, {
      error: "Invalid JSON from model",
      rawText: rawText.slice(0, 2000),
    });
  }

  console.log("[draft-tcp] Successfully parsed model response JSON");

  const validation = validateDraftResponse(candidate);

  if (!validation.ok) {
    // Log detailed info for debugging
    console.error("[draft-tcp] Validation failed:");
    console.error("  - issues:", validation.issues);
    console.error("  - rawText:", rawText.slice(0, 1000));
    console.error("  - jsonSlice:", jsonSlice.slice(0, 1000));
    console.error("  - parsed:", JSON.stringify(candidate, null, 2).slice(0, 1000));

    // One automatic retry with corrective instruction
    console.log("[draft-tcp] Attempting retry with corrective prompt...");
    
    const retryPrompt = `Your last JSON failed validation with these issues: ${validation.issues.join("; ")}

Return ONLY a corrected JSON object with the exact same schema. Remember:
- signSpacing must have exactly 3 objects with labels "A", "B", "C" (uppercase)
- All numeric fields (distanceFt, taperLengthFt, bufferLengthFt, cones, signs, flaggers) must be numbers, not strings
- arrowBoard must be a boolean (true or false), not a string
- svgContent must be "<svg></svg>"

Return ONLY the corrected JSON, no explanation.`;

    try {
      const retryResponse = await fetch(MODEL_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: combinedSystemPrompt },
            { role: "user", content: userPrompt },
            { role: "assistant", content: rawText },
            { role: "user", content: retryPrompt },
          ],
          temperature: 0.0,
        }),
      });

      if (retryResponse.ok) {
        const retryJson = await retryResponse.json() as { choices?: { message?: { content?: string } }[] };
        const retryRawText = retryJson?.choices?.[0]?.message?.content ?? "";
        
        console.log("[draft-tcp] Retry response received, length:", retryRawText.length);

        const retryFirstBrace = retryRawText.indexOf("{");
        const retryLastBrace = retryRawText.lastIndexOf("}");

        if (retryFirstBrace !== -1 && retryLastBrace > retryFirstBrace) {
          const retryJsonSlice = retryRawText.slice(retryFirstBrace, retryLastBrace + 1);
          try {
            const retryCandidate = JSON.parse(retryJsonSlice);
            const retryValidation = validateDraftResponse(retryCandidate);

            if (retryValidation.ok) {
              console.log("[draft-tcp] Retry succeeded!");
              const svgContent = generateSvgFromPlan(retryValidation.value.plan);
              const finalResponse: TcpDraftResponse = {
                ...retryValidation.value,
                svgContent,
              };
              return NextResponse.json(finalResponse);
            } else {
              console.error("[draft-tcp] Retry also failed validation:", retryValidation.issues);
            }
          } catch (retryParseErr) {
            console.error("[draft-tcp] Retry JSON parse failed:", retryParseErr);
          }
        }
      }
    } catch (retryErr) {
      console.error("[draft-tcp] Retry fetch failed:", retryErr);
    }

    // Return original validation error if retry failed
    return jsonError(500, {
      error: "Model response failed validation",
      details: { issues: validation.issues },
      parsed: candidate,
    });
  }

  const responseValue = validation.value;

  const svgContent = generateSvgFromPlan(responseValue.plan);
  const finalResponse: TcpDraftResponse = {
    ...responseValue,
    svgContent,
  };

  return NextResponse.json(finalResponse);
}


