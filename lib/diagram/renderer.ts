/**
 * SVG Diagram Renderer
 * 
 * Generates accessible SVG diagrams for TCP plans.
 * Supports linear (normal road) and intersection layout modes.
 */

import {
  DiagramConfig,
  DiagramInput,
  DiagramPlanData,
  DiagramJobData,
  ZoneProportions,
  DiagramAccessibility,
  LayoutMode,
  DEFAULT_DIAGRAM_CONFIG,
  Devices,
} from "./types";
import { computeZoneProportions, getSignPositions } from "./proportions";

// Colors
const COLORS = {
  background: "#f5f5f5",
  road: "#d4d4d4",
  centerLine: "#ffffff",
  workZone: "#f97316",
  taper: "#fed7aa",
  buffer: "#fee2e2",
  advanceWarning: "#fef3c7",
  signFill: "#fde68a",
  signStroke: "#92400e",
  arrowBoard: "#111827",
  arrowBoardDots: "#f97316",
  text: "#111827",
  textMuted: "#374151",
  placeholder: "#9ca3af",
};

/**
 * Build accessibility metadata for the diagram.
 */
function buildAccessibility(
  input: DiagramInput
): DiagramAccessibility {
  const { state, layoutMode, job, plan } = input;

  const title = "Traffic Control Plan Schematic";

  if (state === "empty") {
    return {
      title,
      description: "No work zone geometry selected. Draw a polygon on the map to preview the traffic control plan.",
    };
  }

  if (state === "geometry-only") {
    return {
      title,
      description: `Work zone area selected. ${layoutMode === "intersection" ? "Intersection" : "Linear road"} layout. Generate a plan to see detailed zones and devices.`,
    };
  }

  // Full state
  const workType = job?.workType?.replace(/_/g, " ") ?? "work zone";
  const roadType = job?.roadType?.replace(/_/g, " ") ?? "road";
  const taperFt = plan?.taperLengthFt ?? 0;
  const bufferFt = plan?.bufferLengthFt ?? 0;
  const workLengthFt = job?.workLengthFt ?? 0;
  const devices = plan?.devices;

  let deviceDesc = "";
  if (devices) {
    const parts: string[] = [];
    if (devices.arrowBoard) parts.push("arrow board");
    if (devices.cones > 0) parts.push(`${devices.cones} cones`);
    if (devices.signs > 0) parts.push(`${devices.signs} signs`);
    if (devices.flaggers > 0) parts.push(`${devices.flaggers} flagger${devices.flaggers > 1 ? "s" : ""}`);
    if (parts.length > 0) {
      deviceDesc = ` Devices include ${parts.join(", ")}.`;
    }
  }

  return {
    title,
    description: `${layoutMode === "intersection" ? "Intersection" : "Linear"} traffic control plan for ${workType} on ${roadType}. Taper length ${taperFt} feet, buffer ${bufferFt} feet, work zone ${workLengthFt} feet.${deviceDesc}`,
  };
}

/**
 * Render a sign diamond marker.
 */
function renderSign(
  centerX: number,
  y: number,
  label: string,
  distanceFt: number,
  isPlaceholder: boolean = false
): string {
  const size = 28;
  const half = size / 2;
  const x = centerX - 100; // Position to the left of road

  const points = [
    `${x},${y - half}`,
    `${x + half},${y}`,
    `${x},${y + half}`,
    `${x - half},${y}`,
  ].join(" ");

  const fill = isPlaceholder ? COLORS.placeholder : COLORS.signFill;
  const stroke = isPlaceholder ? COLORS.placeholder : COLORS.signStroke;
  const textColor = isPlaceholder ? COLORS.placeholder : COLORS.text;

  return `
    <polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="2" />
    <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="14" fill="${textColor}" font-weight="bold">
      ${label}
    </text>
    <text x="${x + 50}" y="${y + 4}" text-anchor="start" font-size="11" fill="${COLORS.textMuted}">
      ${isPlaceholder ? "—" : distanceFt + " ft"}
    </text>
  `;
}

/**
 * Render arrow board device.
 */
function renderArrowBoard(centerX: number, y: number): string {
  const width = 70;
  const height = 30;
  const x = centerX + 80;

  return `
    <rect x="${x}" y="${y - height / 2}" width="${width}" height="${height}" rx="4" fill="${COLORS.arrowBoard}" />
    <circle cx="${x + 14}" cy="${y}" r="3" fill="${COLORS.arrowBoardDots}" />
    <circle cx="${x + 26}" cy="${y}" r="3" fill="${COLORS.arrowBoardDots}" />
    <circle cx="${x + 38}" cy="${y}" r="3" fill="${COLORS.arrowBoardDots}" />
    <circle cx="${x + 50}" cy="${y}" r="3" fill="${COLORS.arrowBoardDots}" />
    <text x="${x + width / 2}" y="${y + 22}" text-anchor="middle" font-size="10" fill="${COLORS.textMuted}">
      Arrow Board
    </text>
  `;
}

/**
 * Render flagger icon.
 */
function renderFlagger(x: number, y: number): string {
  // Simple person icon
  return `
    <circle cx="${x}" cy="${y - 12}" r="6" fill="${COLORS.signFill}" stroke="${COLORS.signStroke}" stroke-width="1.5" />
    <line x1="${x}" y1="${y - 6}" x2="${x}" y2="${y + 8}" stroke="${COLORS.signStroke}" stroke-width="2" />
    <line x1="${x - 8}" y1="${y}" x2="${x + 8}" y2="${y}" stroke="${COLORS.signStroke}" stroke-width="2" />
    <text x="${x}" y="${y + 22}" text-anchor="middle" font-size="9" fill="${COLORS.textMuted}">Flagger</text>
  `;
}

/**
 * Render linear road layout.
 */
function renderLinearLayout(
  config: DiagramConfig,
  proportions: ZoneProportions,
  plan: DiagramPlanData | undefined,
  job: DiagramJobData | undefined,
  isPlaceholder: boolean
): string {
  const { width, height, paddingTop, paddingBottom, paddingLeft, laneWidth } = config;
  const centerX = width / 2;
  
  // Calculate zone Y positions (from top to bottom: Work Zone -> Buffer -> Taper -> AWA)
  // Traffic flows from bottom (upstream) to top (downstream)
  const workZoneTop = paddingTop;
  const workZoneBottom = workZoneTop + proportions.workZonePx;
  const bufferTop = workZoneBottom;
  const bufferBottom = bufferTop + proportions.bufferPx;
  const taperTop = bufferBottom;
  const taperBottom = taperTop + proportions.taperPx;
  const awaTop = taperBottom;
  const awaBottom = awaTop + proportions.advanceWarningPx;

  const roadTop = paddingTop;
  const roadBottom = height - paddingBottom;

  // Road background
  let svg = `
    <rect x="${centerX - laneWidth / 2}" y="${roadTop}" width="${laneWidth}" height="${roadBottom - roadTop}" fill="${COLORS.road}" />
    <line x1="${centerX}" y1="${roadTop}" x2="${centerX}" y2="${roadBottom}" stroke="${COLORS.centerLine}" stroke-width="3" stroke-dasharray="16 12" />
  `;

  // Advance Warning Area
  svg += `
    <g class="diagram-zone" data-zone="awa">
      <rect x="${centerX - laneWidth / 2}" y="${awaTop}" width="${laneWidth}" height="${proportions.advanceWarningPx}" fill="${COLORS.advanceWarning}" opacity="0.5" />
      <text x="${centerX + laneWidth / 2 + 10}" y="${awaTop + proportions.advanceWarningPx / 2}" font-size="12" fill="${COLORS.textMuted}" dominant-baseline="middle">
        Advance Warning
      </text>
      <text x="${centerX + laneWidth / 2 + 10}" y="${awaTop + proportions.advanceWarningPx / 2 + 14}" font-size="11" fill="${COLORS.textMuted}" dominant-baseline="middle">
        ${isPlaceholder ? "—" : "~" + proportions.advanceWarningFt + " ft"}
      </text>
    </g>
  `;

  // Signs within AWA
  if (plan?.signSpacing) {
    const signPositions = getSignPositions(
      plan.signSpacing,
      proportions.advanceWarningPx,
      proportions.advanceWarningFt
    );
    for (const sign of signPositions) {
      svg += renderSign(centerX, awaTop + sign.yOffset + 20, sign.label, sign.distanceFt, isPlaceholder);
    }
  } else {
    // Placeholder signs
    const spacing = proportions.advanceWarningPx / 4;
    svg += renderSign(centerX, awaTop + spacing, "A", 0, true);
    svg += renderSign(centerX, awaTop + spacing * 2, "B", 0, true);
    svg += renderSign(centerX, awaTop + spacing * 3, "C", 0, true);
  }

  // Taper zone
  svg += `
    <g class="diagram-zone" data-zone="taper">
      <rect x="${centerX - laneWidth / 2}" y="${taperTop}" width="${laneWidth}" height="${proportions.taperPx}" fill="${COLORS.taper}" />
      <text x="${centerX + laneWidth / 2 + 10}" y="${taperTop + proportions.taperPx / 2}" font-size="12" fill="${COLORS.textMuted}" dominant-baseline="middle">
        Taper ${isPlaceholder ? "" : "~" + proportions.taperFt + " ft"}
      </text>
    </g>
  `;

  // Buffer zone
  svg += `
    <g class="diagram-zone" data-zone="buffer">
      <rect x="${centerX - laneWidth / 2}" y="${bufferTop}" width="${laneWidth}" height="${proportions.bufferPx}" fill="${COLORS.buffer}" />
      <text x="${centerX + laneWidth / 2 + 10}" y="${bufferTop + proportions.bufferPx / 2}" font-size="12" fill="${COLORS.textMuted}" dominant-baseline="middle">
        Buffer ${isPlaceholder ? "" : "~" + proportions.bufferFt + " ft"}
      </text>
    </g>
  `;

  // Work zone
  svg += `
    <g class="diagram-zone" data-zone="work-zone">
      <rect x="${centerX - laneWidth / 2}" y="${workZoneTop}" width="${laneWidth}" height="${proportions.workZonePx}" fill="${COLORS.workZone}" opacity="0.85" />
      <text x="${centerX}" y="${workZoneTop + proportions.workZonePx / 2 - 8}" text-anchor="middle" font-size="14" fill="#fff" font-weight="bold" dominant-baseline="middle">
        WORK ZONE
      </text>
      <text x="${centerX}" y="${workZoneTop + proportions.workZonePx / 2 + 10}" text-anchor="middle" font-size="12" fill="#fff" dominant-baseline="middle">
        ${isPlaceholder ? "—" : proportions.workZoneFt + " ft"}
      </text>
    </g>
  `;

  // Devices
  if (plan?.devices) {
    // Arrow board at start of taper
    if (plan.devices.arrowBoard) {
      svg += renderArrowBoard(centerX, taperTop + 20);
    }
    // Flaggers for one-lane-two-way
    if (plan.devices.flaggers > 0 && job?.workType === "one_lane_two_way_flaggers") {
      svg += renderFlagger(centerX - laneWidth - 20, bufferTop);
      if (plan.devices.flaggers > 1) {
        svg += renderFlagger(centerX - laneWidth - 20, workZoneBottom);
      }
    }
  }

  // Traffic flow arrow
  svg += `
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="${COLORS.text}" />
      </marker>
    </defs>
    <line x1="${paddingLeft - 60}" y1="${roadBottom - 20}" x2="${paddingLeft - 60}" y2="${roadTop + 40}" stroke="${COLORS.text}" stroke-width="2" marker-end="url(#arrowhead)" />
    <text x="${paddingLeft - 60}" y="${roadBottom + 12}" text-anchor="middle" font-size="11" fill="${COLORS.text}">
      Traffic
    </text>
  `;

  return svg;
}

/**
 * Render intersection layout (simplified T/+ template for v1).
 */
function renderIntersectionLayout(
  config: DiagramConfig,
  proportions: ZoneProportions,
  plan: DiagramPlanData | undefined,
  isPlaceholder: boolean
): string {
  const { width, height, paddingTop, paddingBottom, laneWidth } = config;
  const centerX = width / 2;
  const centerY = height / 2;
  
  const roadLength = height - paddingTop - paddingBottom;
  const roadHalfLength = roadLength / 2;

  // Draw a simple + intersection
  let svg = "";

  // Vertical road
  svg += `
    <rect x="${centerX - laneWidth / 2}" y="${paddingTop}" width="${laneWidth}" height="${roadLength}" fill="${COLORS.road}" />
  `;

  // Horizontal road
  svg += `
    <rect x="${centerX - roadHalfLength}" y="${centerY - laneWidth / 2}" width="${roadLength}" height="${laneWidth}" fill="${COLORS.road}" />
  `;

  // Center intersection box
  svg += `
    <rect x="${centerX - laneWidth / 2}" y="${centerY - laneWidth / 2}" width="${laneWidth}" height="${laneWidth}" fill="${COLORS.road}" stroke="${COLORS.centerLine}" stroke-width="2" />
  `;

  // Work zone indication (on one approach)
  const workZoneHeight = Math.min(proportions.workZonePx, roadHalfLength * 0.4);
  svg += `
    <g class="diagram-zone" data-zone="work-zone">
      <rect x="${centerX - laneWidth / 2}" y="${centerY + laneWidth / 2 + 20}" width="${laneWidth}" height="${workZoneHeight}" fill="${COLORS.workZone}" opacity="0.85" />
      <text x="${centerX}" y="${centerY + laneWidth / 2 + 20 + workZoneHeight / 2}" text-anchor="middle" font-size="12" fill="#fff" font-weight="bold" dominant-baseline="middle">
        WORK ZONE
      </text>
    </g>
  `;

  // Taper indication
  const taperHeight = Math.min(proportions.taperPx * 0.5, 40);
  svg += `
    <g class="diagram-zone" data-zone="taper">
      <rect x="${centerX - laneWidth / 2}" y="${centerY + laneWidth / 2 + 20 + workZoneHeight}" width="${laneWidth}" height="${taperHeight}" fill="${COLORS.taper}" />
    </g>
  `;

  // Label with values
  svg += `
    <text x="${centerX + laneWidth + 20}" y="${centerY + laneWidth / 2 + 40}" font-size="11" fill="${COLORS.textMuted}">
      Work: ${isPlaceholder ? "—" : proportions.workZoneFt + " ft"}
    </text>
    <text x="${centerX + laneWidth + 20}" y="${centerY + laneWidth / 2 + 56}" font-size="11" fill="${COLORS.textMuted}">
      Taper: ${isPlaceholder ? "—" : proportions.taperFt + " ft"}
    </text>
    <text x="${centerX + laneWidth + 20}" y="${centerY + laneWidth / 2 + 72}" font-size="11" fill="${COLORS.textMuted}">
      Buffer: ${isPlaceholder ? "—" : proportions.bufferFt + " ft"}
    </text>
  `;

  // Intersection label
  svg += `
    <text x="${centerX}" y="${paddingTop - 10}" text-anchor="middle" font-size="13" fill="${COLORS.text}" font-weight="bold">
      Intersection Layout
    </text>
  `;

  // Arrow board if present
  if (plan?.devices?.arrowBoard) {
    svg += renderArrowBoard(centerX - 140, centerY + laneWidth / 2 + 60);
  }

  return svg;
}

/**
 * Render empty state placeholder.
 */
function renderEmptyState(config: DiagramConfig): string {
  const { width, height } = config;
  const centerX = width / 2;
  const centerY = height / 2;

  return `
    <rect x="${centerX - 100}" y="${centerY - 60}" width="200" height="120" rx="8" fill="${COLORS.background}" stroke="${COLORS.placeholder}" stroke-width="2" stroke-dasharray="8 4" />
    <text x="${centerX}" y="${centerY - 20}" text-anchor="middle" font-size="14" fill="${COLORS.placeholder}">
      Draw a work zone on the map
    </text>
    <text x="${centerX}" y="${centerY + 5}" text-anchor="middle" font-size="13" fill="${COLORS.placeholder}">
      to preview the traffic control plan
    </text>
    <text x="${centerX}" y="${centerY + 35}" text-anchor="middle" font-size="24" fill="${COLORS.placeholder}">
      📍
    </text>
  `;
}

/**
 * Main render function - generates complete SVG string.
 */
export function renderDiagram(
  input: DiagramInput,
  config: DiagramConfig = DEFAULT_DIAGRAM_CONFIG
): string {
  const { state, layoutMode, plan, job } = input;
  const { width, height } = config;

  // Build accessibility metadata
  const accessibility = buildAccessibility(input);

  // Compute proportions
  const proportions = computeZoneProportions(plan, job, config);
  const isPlaceholder = state === "geometry-only";

  // Generate content based on state
  let content: string;

  if (state === "empty") {
    content = renderEmptyState(config);
  } else if (layoutMode === "intersection") {
    content = renderIntersectionLayout(config, proportions, plan, isPlaceholder);
  } else {
    content = renderLinearLayout(config, proportions, plan, job, isPlaceholder);
  }

  // Assemble final SVG
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="tcp-diagram-title tcp-diagram-desc">
  <title id="tcp-diagram-title">${accessibility.title}</title>
  <desc id="tcp-diagram-desc">${accessibility.description}</desc>
  <rect width="100%" height="100%" fill="${COLORS.background}" />
  ${content}
  <text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-size="10" fill="${COLORS.placeholder}" font-style="italic">
    Schematic Preview — For Reference Only
  </text>
</svg>`;
}

/**
 * Determine layout mode from job data.
 * Only uses "intersection" when roadType is explicitly "intersection".
 */
export function determineLayoutMode(job: DiagramJobData | undefined): LayoutMode {
  if (job?.roadType === "intersection") {
    return "intersection";
  }
  return "linear";
}

