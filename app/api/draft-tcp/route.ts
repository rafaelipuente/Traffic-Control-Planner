import { NextRequest, NextResponse } from "next/server";
import {
  MAX_SVG_LENGTH,
  TcpDraftRequest,
  TcpDraftResponse,
  TcpPlan,
  tcpDraftRequestSchema,
  CoverageInfo,
} from "@/lib/tcpTypes";
import {
  RetrievalQueryContext,
  formatCitation,
  retrieveSupport,
} from "@/lib/retrieval";
import { RulesEngine, SiteFacts } from "@/lib/rules/engine";

export const runtime = "nodejs";

const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";

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

/**
 * Map road type string to road_context for the rules engine.
 */
function mapRoadContext(roadType: string, speedMph: number): string {
  if (roadType === "intersection") {
    return speedMph <= 35 ? "urban_low_speed" : "urban_high_speed";
  }
  if (roadType === "multilane_divided") {
    return speedMph >= 50 ? "expressway_freeway" : "urban_high_speed";
  }
  // 2_lane_undivided
  return speedMph <= 35 ? "urban_low_speed" : "rural";
}

/**
 * Call the backend rules engine for deterministic computation.
 * ALL numeric values come from here, not from the LLM.
 */
async function computeViaBackendEngine(req: TcpDraftRequest): Promise<{
  computation: TcpPlan;
  citations: Array<{ field: string; citation: string }>;
  refused?: string[];
} | null> {
  try {
    const siteFacts = {
      posted_or_statutory_speed_mph: req.postedSpeedMph,
      speed_basis: "posted",
      road_context: mapRoadContext(req.roadType, req.postedSpeedMph),
      lane_count: req.roadType === "2_lane_undivided" ? 2 : 4,
      opposing_directions: true,
      lane_width_ft: 12,
      work_length_ft: req.workLengthFt,
      is_night: req.isNight,
    };

    // Call local rules engine directly (no network call needed for Phase 1)
    // In production, this would call the FastAPI backend
    const engine = new RulesEngine();
    const facts: SiteFacts = {
      posted_or_statutory_speed_mph: siteFacts.posted_or_statutory_speed_mph,
      speed_basis: siteFacts.speed_basis as "posted" | "off_peak_85th" | "anticipated",
      road_context: siteFacts.road_context as "urban_low_speed" | "urban_high_speed" | "rural" | "expressway_freeway",
      lane_count: siteFacts.lane_count,
      opposing_directions: siteFacts.opposing_directions,
      lane_width_ft: siteFacts.lane_width_ft,
      work_length_ft: siteFacts.work_length_ft,
      is_night: siteFacts.is_night,
      control_method: "flaggers",
      uses_ottch_short_term: true,
      jurisdiction: "OR",
      duration_days: 1,
    };

    const result = engine.compute(facts);

    if (result.refused_reasons.length > 0) {
      return {
        computation: {
          recommendedLayout: "REFUSED",
          signSpacing: [
            { label: "A" as const, distanceFt: 0 },
            { label: "B" as const, distanceFt: 0 },
            { label: "C" as const, distanceFt: 0 },
          ],
          taperLengthFt: 0,
          bufferLengthFt: 0,
          devices: { cones: 0, signs: 0, arrowBoard: false, flaggers: 0 },
        },
        citations: [],
        refused: result.refused_reasons,
      };
    }

    // Convert engine result to TcpPlan format
    const plan: TcpPlan = {
      recommendedLayout: `OTTCH Diagram 320 / MUTCD Figure 6P-10`,
      signSpacing: [
        { label: "A" as const, distanceFt: Number(result.spacing_A_ft.value) },
        { label: "B" as const, distanceFt: Number(result.spacing_B_ft.value) },
        { label: "C" as const, distanceFt: Number(result.spacing_C_ft.value) },
      ],
      taperLengthFt: Number(result.taper_length_ft.value),
      bufferLengthFt: Number(result.buffer_length_ft.value),
      devices: {
        cones: Number(result.cones_per_taper.value) * 2 + Number(result.cones_tangent.value),
        signs: result.signs_count,
        arrowBoard: result.arrow_board_required,
        flaggers: Number(result.flagger_count.value),
      },
    };

    // Collect citations
    const citations = [
      { field: "spacing_A_ft", citation: `${result.spacing_A_ft.citation.source_doc} ${result.spacing_A_ft.citation.source_ref}` },
      { field: "spacing_B_ft", citation: `${result.spacing_B_ft.citation.source_doc} ${result.spacing_B_ft.citation.source_ref}` },
      { field: "spacing_C_ft", citation: `${result.spacing_C_ft.citation.source_doc} ${result.spacing_C_ft.citation.source_ref}` },
      { field: "taper_length_ft", citation: `${result.taper_length_ft.citation.source_doc} ${result.taper_length_ft.citation.source_ref}` },
      { field: "buffer_length_ft", citation: `${result.buffer_length_ft.citation.source_doc} ${result.buffer_length_ft.citation.source_ref}` },
      { field: "flagger_count", citation: `${result.flagger_count.citation.source_doc} ${result.flagger_count.citation.source_ref}` },
    ];

    return { computation: plan, citations };
  } catch (error) {
    console.error("[draft-tcp] Backend engine error:", error);
    return null;
  }
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

  const bufferPx = plan.bufferLengthFt * scale;
  const taperPx = plan.taperLengthFt * scale;

  const taperEndY = workZoneTop;
  const taperStartY = taperEndY + taperPx;
  const bufferStartY = clamp(taperStartY + bufferPx, roadTop, roadBottom);

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

function clamp(value: number, min: number, max: number): number {
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

  console.log("[draft-tcp] Processing request for:", {
    roadType: tcpReq.roadType,
    workType: tcpReq.workType,
    speedMph: tcpReq.postedSpeedMph,
    isNight: tcpReq.isNight,
  });

  // PHASE 1: Use backend rules engine for ALL numeric values
  const engineResult = await computeViaBackendEngine(tcpReq);

  if (!engineResult) {
    return jsonError(500, {
      error: "Rules engine computation failed",
      details: { message: "Unable to compute plan values" },
    });
  }

  if (engineResult.refused) {
    return jsonError(422, {
      error: "Plan computation refused",
      details: {
        reasons: engineResult.refused,
        message: "The requested configuration is outside the supported scope for Phase 1",
      },
    });
  }

  const plan = engineResult.computation;
  const svgContent = generateSvgFromPlan(plan);

  // Build references from engine citations
  const references = engineResult.citations.map(
    (c) => `${c.field}: ${c.citation}`
  );

  // Build assumptions list
  const assumptions: string[] = [
    "All numeric values computed by deterministic rules engine (not LLM)",
    `Posted speed: ${tcpReq.postedSpeedMph} mph`,
    `Road type: ${tcpReq.roadType}`,
    `Work type: ${tcpReq.workType}`,
    tcpReq.isNight ? "Night operation" : "Daytime operation",
  ];

  // Build coverage info
  const coverage: CoverageInfo = {
    spacing: true,
    taper: true,
    buffer: true,
    devices: true,
    citations: references.map((ref) => ({
      category: "spacing" as const,
      docName: ref.split(":")[1]?.trim().split(" ")[0] || "MUTCD",
      snippet: ref,
    })),
  };

  const response: TcpDraftResponse = {
    summary: `Traffic control plan for ${tcpReq.workType.replace(/_/g, " ")} on ${tcpReq.roadType.replace(/_/g, " ")} road at ${tcpReq.postedSpeedMph} mph. Layout: OTTCH Diagram 320 / MUTCD Figure 6P-10.`,
    plan,
    assumptions,
    references,
    svgContent,
    coverage,
  };

  console.log("[draft-tcp] Plan computed successfully:", {
    spacing_A: plan.signSpacing[0].distanceFt,
    spacing_B: plan.signSpacing[1].distanceFt,
    spacing_C: plan.signSpacing[2].distanceFt,
    taperFt: plan.taperLengthFt,
    bufferFt: plan.bufferLengthFt,
    flaggers: plan.devices.flaggers,
  });

  return NextResponse.json(response);
}
