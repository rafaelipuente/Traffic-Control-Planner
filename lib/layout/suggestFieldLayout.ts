/**
 * Street-Aware Layout Suggestion Engine (Phase 2.1 + Rules-Driven)
 * 
 * Generates TCP device placement aligned to REAL streets when road centerline
 * data is available (via queryRenderedFeatures). Signs are placed on the correct
 * shoulder (left/right) relative to traffic direction and the work zone.
 * Falls back to polygon-axis method when no road data is provided.
 * 
 * IMPORTANT: All spacing/distance values are now derived from the TCP Rules Pack
 * (src/rules/tcpRulesPack.v1.json) via resolveTcpRules(). This ensures MUTCD compliance
 * and eliminates heuristic guessing.
 */

import {
  FieldLayout,
  FieldDevice,
  LayoutSuggestionInput,
  ApproachDirection,
  generateDeviceId,
  SIGN_LABELS,
  RoadPolyline,
} from "../layoutTypes";

import {
  resolveTcpRules,
  ResolvedTcpRules,
  OperationType,
} from "@/src/rules/resolveTcpRules";

// ============================================
// CONSTANTS
// ============================================

/** Feet to meters conversion */
const FT_TO_M = 0.3048;

/** Meters to approximate degrees (rough, ~45° latitude) */
const M_TO_DEG = 1 / 111320;

/** Minimum distance between devices to prevent stacking (meters) */
const MIN_DEVICE_SPACING_M = 3;

/** Shoulder offset distance - how far from road centerline to place signs (meters) */
const SHOULDER_OFFSET_M = 5;

/** Maximum distance from road centerline for a valid sign placement (meters) */
const MAX_SIGN_ROAD_DISTANCE_M = 15;

/** Debug mode flag - set to true to enable debug overlays in dev */
export const DEBUG_LAYOUT = false;

/** Debug flag for sign spacing specifically */
const DEBUG_SIGN_SPACING = true;

/** Base offset from entry point for the closest sign (Sign C) in feet */
const SIGN_BASE_OFFSET_FT = 50;

/** Minimum separation between signs to prevent stacking (meters) */
const MIN_SIGN_SEPARATION_M = 15;

/** 
 * LEGACY: Speed-based spacing in feet (DEPRECATED - now using rules resolver)
 * Kept as fallback if rules resolution fails
 */
const LEGACY_SPEED_CONFIG: Record<number, { signSpacingFt: number[]; taperLengthFt: number; coneSpacingFt: number }> = {
  25: { signSpacingFt: [100, 200, 300], taperLengthFt: 100, coneSpacingFt: 15 },
  30: { signSpacingFt: [100, 200, 300], taperLengthFt: 120, coneSpacingFt: 15 },
  35: { signSpacingFt: [150, 300, 450], taperLengthFt: 175, coneSpacingFt: 17 },
  40: { signSpacingFt: [200, 400, 600], taperLengthFt: 240, coneSpacingFt: 20 },
  45: { signSpacingFt: [250, 500, 750], taperLengthFt: 300, coneSpacingFt: 22 },
  50: { signSpacingFt: [300, 600, 900], taperLengthFt: 360, coneSpacingFt: 25 },
  55: { signSpacingFt: [350, 700, 1050], taperLengthFt: 420, coneSpacingFt: 27 },
  60: { signSpacingFt: [400, 800, 1200], taperLengthFt: 480, coneSpacingFt: 30 },
  65: { signSpacingFt: [500, 1000, 1500], taperLengthFt: 550, coneSpacingFt: 32 },
};

/** Road class priority for selecting dominant road */
const ROAD_CLASS_PRIORITY: Record<string, number> = {
  "motorway": 10,
  "trunk": 9,
  "primary": 8,
  "secondary": 7,
  "tertiary": 6,
  "street": 5,
  "residential": 4,
  "service": 3,
  "path": 1,
  "default": 2,
};

// ============================================
// DEBUG DATA STRUCTURE
// ============================================

export interface LayoutDebugInfo {
  dominantRoad: RoadPolyline | null;
  entryPoint: Point | null;
  upstreamBearing: number | null;
  shoulderSide: "left" | "right" | null;
  signTargetsBefore: Point[]; // Before snapping/offset
  signTargetsAfter: Point[];  // After snapping/offset
}

let _debugInfo: LayoutDebugInfo | null = null;

export function getLayoutDebugInfo(): LayoutDebugInfo | null {
  return _debugInfo;
}

function resetDebugInfo(): void {
  _debugInfo = DEBUG_LAYOUT ? {
    dominantRoad: null,
    entryPoint: null,
    upstreamBearing: null,
    shoulderSide: null,
    signTargetsBefore: [],
    signTargetsAfter: [],
  } : null;
}

// ============================================
// GEOMETRY UTILITIES
// ============================================

type Point = [number, number]; // [lng, lat]

/**
 * Calculate distance between two points in meters (Haversine approximation)
 */
function distanceMeters(p1: Point, p2: Point): number {
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const dLat = (p2[1] - p1[1]) * Math.PI / 180;
  const lat1 = p1[1] * Math.PI / 180;
  const lat2 = p2[1] * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c; // Earth radius in meters
}

/**
 * Calculate bearing from p1 to p2 in radians
 */
function bearing(p1: Point, p2: Point): number {
  const dLng = (p2[0] - p1[0]) * Math.PI / 180;
  const lat1 = p1[1] * Math.PI / 180;
  const lat2 = p2[1] * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x);
}

/**
 * Move a point by distance (meters) along a bearing (radians)
 */
function movePoint(p: Point, distanceM: number, bearingRad: number): Point {
  const distDeg = distanceM * M_TO_DEG;
  const lat1 = p[1] * Math.PI / 180;
  
  const dLat = distDeg * Math.cos(bearingRad);
  const dLng = distDeg * Math.sin(bearingRad) / Math.cos(lat1);
  
  return [p[0] + dLng, p[1] + dLat];
}

/**
 * Compute polygon centroid
 */
function computeCentroid(ring: number[][]): Point {
  if (ring.length === 0) return [0, 0];
  const sumLng = ring.reduce((s, p) => s + p[0], 0);
  const sumLat = ring.reduce((s, p) => s + p[1], 0);
  return [sumLng / ring.length, sumLat / ring.length];
}

/**
 * Compute bounding box of polygon
 */
function computeBbox(ring: number[][]): { minLng: number; minLat: number; maxLng: number; maxLat: number } {
  const lngs = ring.map(p => p[0]);
  const lats = ring.map(p => p[1]);
  return {
    minLng: Math.min(...lngs),
    minLat: Math.min(...lats),
    maxLng: Math.max(...lngs),
    maxLat: Math.max(...lats),
  };
}

/**
 * Check if a point is inside a polygon using ray casting
 */
function isPointInPolygon(point: Point, ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Find the closest point on a line segment to a given point
 */
function closestPointOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) return { point: a, t: 0 };
  
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  return {
    point: [a[0] + t * dx, a[1] + t * dy],
    t,
  };
}

/**
 * Find the closest point on a polygon boundary to a given point
 */
function closestPointOnPolygon(point: Point, ring: number[][]): Point {
  let minDist = Infinity;
  let closest: Point = point;
  
  for (let i = 0; i < ring.length; i++) {
    const a: Point = [ring[i][0], ring[i][1]];
    const b: Point = [ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]];
    
    const { point: projected } = closestPointOnSegment(point, a, b);
    const dist = distanceMeters(point, projected);
    
    if (dist < minDist) {
      minDist = dist;
      closest = projected;
    }
  }
  
  return closest;
}

/**
 * Clamp a point to be inside the polygon
 */
function clampToPolygon(point: Point, ring: number[][]): Point {
  if (isPointInPolygon(point, ring)) {
    return point;
  }
  return closestPointOnPolygon(point, ring);
}

/**
 * Get distance from point to nearest polygon edge (meters)
 */
function distanceToPolygon(point: Point, ring: number[][]): number {
  const closest = closestPointOnPolygon(point, ring);
  return distanceMeters(point, closest);
}

// ============================================
// POLYLINE UTILITIES
// ============================================

interface PolylineProjection {
  point: Point;
  segmentIndex: number;
  distanceAlongLine: number;
  distanceFromLine: number;
  segmentBearing: number;
}

/**
 * Project a point onto a polyline and return the closest point + segment info
 */
function projectPointToPolyline(point: Point, polyline: RoadPolyline): PolylineProjection {
  let minDist = Infinity;
  let closestPoint: Point = polyline[0];
  let closestSegment = 0;
  let distanceAlong = 0;
  let cumulativeDistance = 0;
  
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segmentLength = distanceMeters(a, b);
    
    const { point: projected, t } = closestPointOnSegment(point, a, b);
    const dist = distanceMeters(point, projected);
    
    if (dist < minDist) {
      minDist = dist;
      closestPoint = projected;
      closestSegment = i;
      distanceAlong = cumulativeDistance + t * segmentLength;
    }
    
    cumulativeDistance += segmentLength;
  }
  
  // Calculate bearing at the closest segment
  const segA = polyline[closestSegment];
  const segB = polyline[Math.min(closestSegment + 1, polyline.length - 1)];
  const segmentBearing = bearing(segA, segB);
  
  return {
    point: closestPoint,
    segmentIndex: closestSegment,
    distanceAlongLine: distanceAlong,
    distanceFromLine: minDist,
    segmentBearing,
  };
}

/**
 * Calculate total length of a polyline in meters
 */
function polylineLength(polyline: RoadPolyline): number {
  let length = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    length += distanceMeters(polyline[i], polyline[i + 1]);
  }
  return length;
}

/**
 * Walk along a polyline by a given distance (meters) from a starting point
 * Returns { point, segmentIndex, bearing } or null if cannot walk
 * 
 * IMPORTANT: This version does NOT extend beyond the polyline - it clamps to endpoints
 * to avoid placing signs off-road.
 */
function walkAlongPolylineStrict(
  polyline: RoadPolyline,
  startSegmentIndex: number,
  startDistanceAlong: number,
  walkDistance: number
): { point: Point; segmentIndex: number; bearing: number } | null {
  if (polyline.length < 2) return null;
  
  // Calculate cumulative distances to each vertex
  const distances: number[] = [0];
  for (let i = 0; i < polyline.length - 1; i++) {
    distances.push(distances[i] + distanceMeters(polyline[i], polyline[i + 1]));
  }
  
  const totalLength = distances[distances.length - 1];
  let targetDistance = startDistanceAlong + walkDistance;
  
  // Clamp to polyline bounds (don't extend off-road)
  targetDistance = Math.max(0, Math.min(totalLength, targetDistance));
  
  // Find the segment containing the target distance
  for (let i = 0; i < distances.length - 1; i++) {
    if (targetDistance >= distances[i] && targetDistance <= distances[i + 1]) {
      const segmentLength = distances[i + 1] - distances[i];
      const t = segmentLength > 0 ? (targetDistance - distances[i]) / segmentLength : 0;
      
      const a = polyline[i];
      const b = polyline[i + 1];
      const point: Point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const segBearing = bearing(a, b);
      
      return { point, segmentIndex: i, bearing: segBearing };
    }
  }
  
  // Fallback to last point
  const lastIdx = polyline.length - 1;
  return { 
    point: polyline[lastIdx], 
    segmentIndex: lastIdx - 1,
    bearing: bearing(polyline[lastIdx - 1], polyline[lastIdx])
  };
}

/**
 * Snap a point to the nearest point on the polyline
 */
function snapToPolyline(point: Point, polyline: RoadPolyline): { point: Point; bearing: number } {
  const projection = projectPointToPolyline(point, polyline);
  return { point: projection.point, bearing: projection.segmentBearing };
}

// ============================================
// SHOULDER SIDE DETECTION
// ============================================

type ShoulderSide = "left" | "right";

/**
 * Determine which shoulder (left or right) to place signs on.
 * Signs should be placed on the side AWAY from the work zone polygon
 * so they're visible to approaching traffic without obstructing work.
 * 
 * Method:
 * 1. Get the road bearing at the entry point (upstream direction)
 * 2. Compute perpendicular directions (left = bearing - 90°, right = bearing + 90°)
 * 3. Test which side has the polygon centroid
 * 4. Place signs on the OPPOSITE side
 */
function computeShoulderSide(
  roadBearing: number,
  roadPoint: Point,
  polygonCentroid: Point
): ShoulderSide {
  // Left normal = bearing - 90° (perpendicular left)
  const leftNormal = roadBearing - Math.PI / 2;
  // Right normal = bearing + 90° (perpendicular right)
  const rightNormal = roadBearing + Math.PI / 2;
  
  // Sample points on each side
  const testDist = 20; // meters
  const leftPoint = movePoint(roadPoint, testDist, leftNormal);
  const rightPoint = movePoint(roadPoint, testDist, rightNormal);
  
  // Check which side is closer to the polygon centroid
  const distToLeftFromCentroid = distanceMeters(leftPoint, polygonCentroid);
  const distToRightFromCentroid = distanceMeters(rightPoint, polygonCentroid);
  
  // Place signs on the side AWAY from the polygon (opposite side)
  if (distToLeftFromCentroid < distToRightFromCentroid) {
    // Polygon is on the left, so place signs on the right
    return "right";
  } else {
    // Polygon is on the right, so place signs on the left
    return "left";
  }
}

/**
 * Apply shoulder offset to a point based on road bearing and shoulder side
 */
function applyShoulderOffset(
  point: Point,
  roadBearing: number,
  shoulderSide: ShoulderSide,
  offsetM: number = SHOULDER_OFFSET_M
): Point {
  // Left = bearing - 90°, Right = bearing + 90°
  const normalBearing = shoulderSide === "left" 
    ? roadBearing - Math.PI / 2 
    : roadBearing + Math.PI / 2;
  
  return movePoint(point, offsetM, normalBearing);
}

// ============================================
// ROAD SELECTION
// ============================================

interface ScoredRoad {
  polyline: RoadPolyline;
  score: number;
  distanceFromCentroid: number;
  lengthInBbox: number;
}

/**
 * Select the dominant road polyline near the work zone
 * Improved scoring: 60% road class weight, 40% length near polygon
 */
function selectDominantRoadPolyline(
  roads: RoadPolyline[],
  polygonRing: number[][],
  centroid: Point
): RoadPolyline | null {
  if (!roads || roads.length === 0) return null;
  
  const bbox = computeBbox(polygonRing);
  const bboxPadding = 0.001; // ~100m padding
  const expandedBbox = {
    minLng: bbox.minLng - bboxPadding,
    minLat: bbox.minLat - bboxPadding,
    maxLng: bbox.maxLng + bboxPadding,
    maxLat: bbox.maxLat + bboxPadding,
  };
  
  const scoredRoads: ScoredRoad[] = [];
  
  for (const road of roads) {
    if (road.length < 2) continue;
    
    // Check if road intersects expanded bbox
    let intersectsBbox = false;
    let lengthInBbox = 0;
    
    for (let i = 0; i < road.length - 1; i++) {
      const p1 = road[i];
      const p2 = road[i + 1];
      
      const segMinLng = Math.min(p1[0], p2[0]);
      const segMaxLng = Math.max(p1[0], p2[0]);
      const segMinLat = Math.min(p1[1], p2[1]);
      const segMaxLat = Math.max(p1[1], p2[1]);
      
      if (segMaxLng >= expandedBbox.minLng && segMinLng <= expandedBbox.maxLng &&
          segMaxLat >= expandedBbox.minLat && segMinLat <= expandedBbox.maxLat) {
        intersectsBbox = true;
        lengthInBbox += distanceMeters(p1, p2);
      }
    }
    
    if (!intersectsBbox) continue;
    
    // Calculate distance from centroid to road
    const projection = projectPointToPolyline(centroid, road);
    const distanceFromCentroid = projection.distanceFromLine;
    
    // Score: prefer closer roads with more length in bbox
    const distanceScore = Math.max(0, 500 - distanceFromCentroid) / 500;
    const lengthScore = Math.min(lengthInBbox / 200, 1);
    const score = distanceScore * 0.6 + lengthScore * 0.4;
    
    if (score > 0) {
      scoredRoads.push({
        polyline: road,
        score,
        distanceFromCentroid,
        lengthInBbox,
      });
    }
  }
  
  if (scoredRoads.length === 0) return null;
  
  // Sort by score descending
  scoredRoads.sort((a, b) => b.score - a.score);
  
  return scoredRoads[0].polyline;
}

// ============================================
// FALLBACK: POLYGON AXIS DERIVATION
// ============================================

function findLongestEdgeBearing(ring: number[][]): { bearing: number; midpoint: Point } {
  let maxDist = 0;
  let longestEdge: { p1: Point; p2: Point } = { p1: [0, 0], p2: [0, 0] };
  
  for (let i = 0; i < ring.length; i++) {
    const p1: Point = [ring[i][0], ring[i][1]];
    const p2: Point = [ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]];
    const dist = distanceMeters(p1, p2);
    
    if (dist > maxDist) {
      maxDist = dist;
      longestEdge = { p1, p2 };
    }
  }
  
  return {
    bearing: bearing(longestEdge.p1, longestEdge.p2),
    midpoint: [(longestEdge.p1[0] + longestEdge.p2[0]) / 2, (longestEdge.p1[1] + longestEdge.p2[1]) / 2],
  };
}

function linePolygonIntersections(lineStart: Point, lineEnd: Point, ring: number[][]): Point[] {
  const intersections: Point[] = [];
  
  for (let i = 0; i < ring.length; i++) {
    const p1: Point = [ring[i][0], ring[i][1]];
    const p2: Point = [ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]];
    
    const intersection = lineSegmentIntersection(lineStart, lineEnd, p1, p2);
    if (intersection) {
      intersections.push(intersection);
    }
  }
  
  return intersections;
}

function lineSegmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1x = a2[0] - a1[0];
  const d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0];
  const d2y = b2[1] - b1[1];
  
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  
  const dx = b1[0] - a1[0];
  const dy = b1[1] - a1[1];
  
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  
  if (u >= 0 && u <= 1 && t >= -10 && t <= 10) {
    return [a1[0] + t * d1x, a1[1] + t * d1y];
  }
  
  return null;
}

interface FallbackAxis {
  centroid: Point;
  axisBearing: number;
  entryPoint: Point;
  exitPoint: Point;
  upstreamBearing: number;
}

function deriveFallbackAxis(ring: number[][]): FallbackAxis {
  const centroid = computeCentroid(ring);
  const { bearing: edgeBearing } = findLongestEdgeBearing(ring);
  
  const extendDist = 500;
  const lineStart = movePoint(centroid, extendDist, edgeBearing + Math.PI);
  const lineEnd = movePoint(centroid, extendDist, edgeBearing);
  
  const intersections = linePolygonIntersections(lineStart, lineEnd, ring);
  
  let entryPoint: Point;
  let exitPoint: Point;
  
  if (intersections.length >= 2) {
    intersections.sort((a, b) => distanceMeters(lineStart, a) - distanceMeters(lineStart, b));
    entryPoint = intersections[0];
    exitPoint = intersections[intersections.length - 1];
  } else {
    entryPoint = closestPointOnPolygon(lineStart, ring);
    exitPoint = closestPointOnPolygon(lineEnd, ring);
  }
  
  const upstreamBearing = bearing(entryPoint, lineStart);
  
  return { centroid, axisBearing: edgeBearing, entryPoint, exitPoint, upstreamBearing };
}

// ============================================
// DEVICE PLACEMENT
// ============================================

/** Config derived from rules pack for current job */
interface LayoutConfig {
  signSpacingFt: number[];
  taperLengthFt: number;
  coneSpacingFt: number;
  bufferLengthFt: number;
  drumsRequired: boolean;
  requiredSigns: string[];
}

/** Global cache for last resolved rules (for debugging) */
let _lastResolvedRules: ResolvedTcpRules | null = null;

/**
 * Get the last resolved rules (for debugging/QA)
 */
export function getLastResolvedRules(): ResolvedTcpRules | null {
  return _lastResolvedRules;
}

/**
 * LEGACY fallback: Get speed config from hardcoded table
 * Only used when rules resolution fails
 */
function getLegacySpeedConfig(speedMph: number): LayoutConfig {
  const clamped = Math.max(25, Math.min(65, speedMph));
  const rounded = Math.round(clamped / 5) * 5;
  const legacy = LEGACY_SPEED_CONFIG[rounded] || LEGACY_SPEED_CONFIG[35];
  
  console.warn("[RULES_FALLBACK] Using legacy spacing logic");
  
  return {
    signSpacingFt: legacy.signSpacingFt,
    taperLengthFt: legacy.taperLengthFt,
    coneSpacingFt: legacy.coneSpacingFt,
    bufferLengthFt: 50,
    drumsRequired: speedMph >= 35,
    requiredSigns: ["ROAD_WORK_AHEAD", "BE_PREPARED_TO_STOP"],
  };
}

/**
 * Get layout config using the TCP Rules Pack
 * 
 * This is now the PRIMARY source of truth for all spacing values.
 * Falls back to legacy config only if rules resolution throws.
 */
function getLayoutConfig(
  speedMph: number,
  workType?: string
): LayoutConfig {
  try {
    // Map workType to operation type for rules resolution
    const operation: OperationType = mapWorkTypeToOperation(workType);
    
    // Resolve rules from the rules pack
    const resolved = resolveTcpRules({
      speedMph,
      laneWidthFt: 12, // Default lane width
      operation,
      timeOfDay: "day", // Default to day (could be made configurable)
    });
    
    // Cache for debugging
    _lastResolvedRules = resolved;
    
    // Compute sign distances from entry point:
    // Sign C (closest to work zone): baseOffset
    // Sign B: baseOffset + 1*spacing
    // Sign A (furthest upstream): baseOffset + 2*spacing
    // This ensures proper separation even with polyline clamping
    const spacing = resolved.signSpacingFt;
    const signSpacingFt = [
      SIGN_BASE_OFFSET_FT,                    // Sign C: closest
      SIGN_BASE_OFFSET_FT + spacing,          // Sign B: middle
      SIGN_BASE_OFFSET_FT + spacing * 2,      // Sign A: furthest
    ];
    
    if (DEBUG_SIGN_SPACING) {
      console.log(
        `[SIGN_SPACING] speed=${speedMph}mph spacing=${spacing}ft ` +
        `distances: C=${signSpacingFt[0]}ft B=${signSpacingFt[1]}ft A=${signSpacingFt[2]}ft`
      );
    }
    
    return {
      signSpacingFt,
      taperLengthFt: resolved.taperLengthFt,
      coneSpacingFt: resolved.coneSpacingFt,
      bufferLengthFt: resolved.bufferLengthFt,
      drumsRequired: resolved.drumsRequired,
      requiredSigns: resolved.requiredSigns,
    };
  } catch (error) {
    console.error("[RULES_ERROR] Failed to resolve TCP rules:", error);
    return getLegacySpeedConfig(speedMph);
  }
}

/**
 * Map workType string to OperationType for rules resolution
 */
function mapWorkTypeToOperation(workType?: string): OperationType {
  switch (workType) {
    case "lane_closure":
      return "lane_closure";
    case "lane_shift":
      return "lane_shift";
    case "one_lane_two_way_flaggers":
    case "flagging":
      return "flagging";
    case "shoulder_work":
      return "shoulder_work";
    case "full_closure":
      return "full_closure";
    default:
      return "lane_closure"; // Default operation type
  }
}

function isTooCloseToExisting(pos: Point, existingDevices: FieldDevice[], minSpacing: number): boolean {
  for (const device of existingDevices) {
    if (distanceMeters(pos, device.lngLat) < minSpacing) {
      return true;
    }
  }
  return false;
}

/**
 * Place signs along a road polyline with proper shoulder offset (street-aware method)
 * 
 * FIXED ISSUES:
 * 1. Signs are now placed on the correct shoulder (left/right based on polygon location)
 * 2. Signs are snapped to the road polyline and not extended off-road
 * 3. Signs are validated to be near the road
 * 4. Anti-stacking: Enforces MIN_SIGN_SEPARATION_M between signs
 */
function placeSignsAlongRoad(
  road: RoadPolyline,
  polygonRing: number[][],
  centroid: Point,
  config: { signSpacingFt: number[] }
): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  // Project centroid to road to find entry point
  const projection = projectPointToPolyline(centroid, road);
  
  // Determine which direction is "upstream" (away from polygon center)
  const testDist = 50; // meters
  const testWalk1 = walkAlongPolylineStrict(road, projection.segmentIndex, projection.distanceAlongLine, -testDist);
  const testWalk2 = walkAlongPolylineStrict(road, projection.segmentIndex, projection.distanceAlongLine, testDist);
  
  // Pick direction that goes farther from polygon
  let upstreamDirection = -1;
  let upstreamBearing = projection.segmentBearing + Math.PI; // Default: reverse of road direction
  
  if (testWalk1 && testWalk2) {
    const dist1ToPolygon = distanceToPolygon(testWalk1.point, polygonRing);
    const dist2ToPolygon = distanceToPolygon(testWalk2.point, polygonRing);
    
    if (dist2ToPolygon > dist1ToPolygon) {
      upstreamDirection = 1;
      upstreamBearing = testWalk2.bearing;
    } else {
      upstreamDirection = -1;
      upstreamBearing = testWalk1.bearing + Math.PI; // Reverse since we're going backwards
    }
  }
  
  // Determine shoulder side
  const shoulderSide = computeShoulderSide(upstreamBearing, projection.point, centroid);
  
  // Store debug info
  if (_debugInfo) {
    _debugInfo.dominantRoad = road;
    _debugInfo.entryPoint = projection.point;
    _debugInfo.upstreamBearing = upstreamBearing;
    _debugInfo.shoulderSide = shoulderSide;
  }
  
  // Track last placed sign position for minimum separation enforcement
  let lastSignDistanceM = 0;
  
  // Place signs upstream with shoulder offset
  // Order: Sign C (closest), B (middle), A (furthest)
  for (let i = 0; i < config.signSpacingFt.length && i < 3; i++) {
    const requestedDistFt = config.signSpacingFt[i];
    let distM = requestedDistFt * FT_TO_M;
    
    // Enforce minimum separation from previous sign
    if (i > 0 && distM < lastSignDistanceM + MIN_SIGN_SEPARATION_M) {
      distM = lastSignDistanceM + MIN_SIGN_SEPARATION_M;
      if (DEBUG_SIGN_SPACING) {
        console.log(`[SIGN_SPACING] Sign ${SIGN_LABELS[i]}: Adjusted distance from ${(requestedDistFt * FT_TO_M).toFixed(1)}m to ${distM.toFixed(1)}m for min separation`);
      }
    }
    
    // Walk along polyline (strict - no off-road extension)
    const walkResult = walkAlongPolylineStrict(
      road,
      projection.segmentIndex,
      projection.distanceAlongLine,
      upstreamDirection * distM
    );
    
    if (!walkResult) continue;
    
    // Store pre-offset position for debug
    if (_debugInfo) {
      _debugInfo.signTargetsBefore.push(walkResult.point);
    }
    
    // Apply shoulder offset perpendicular to road
    let signPos = applyShoulderOffset(walkResult.point, walkResult.bearing, shoulderSide);
    
    // Validation: sign must be OUTSIDE polygon
    let attempts = 0;
    while (isPointInPolygon(signPos, polygonRing) && attempts < 5) {
      attempts++;
      // Try increasing offset
      signPos = applyShoulderOffset(walkResult.point, walkResult.bearing, shoulderSide, SHOULDER_OFFSET_M + attempts * 2);
    }
    
    // Validation: sign must be near road
    const distToRoad = projectPointToPolyline(signPos, road).distanceFromLine;
    if (distToRoad > MAX_SIGN_ROAD_DISTANCE_M) {
      // Reduce offset to stay near road
      signPos = applyShoulderOffset(walkResult.point, walkResult.bearing, shoulderSide, MAX_SIGN_ROAD_DISTANCE_M * 0.8);
    }
    
    // Anti-stacking check: ensure this sign is far enough from all existing devices
    if (isTooCloseToExisting(signPos, devices, MIN_SIGN_SEPARATION_M)) {
      // Move further upstream until we find a valid position
      let adjustedDistM = distM + MIN_SIGN_SEPARATION_M;
      for (let adjustAttempt = 0; adjustAttempt < 5; adjustAttempt++) {
        const adjustedWalk = walkAlongPolylineStrict(
          road,
          projection.segmentIndex,
          projection.distanceAlongLine,
          upstreamDirection * adjustedDistM
        );
        if (adjustedWalk) {
          const adjustedPos = applyShoulderOffset(adjustedWalk.point, adjustedWalk.bearing, shoulderSide);
          if (!isTooCloseToExisting(adjustedPos, devices, MIN_SIGN_SEPARATION_M)) {
            signPos = adjustedPos;
            distM = adjustedDistM;
            break;
          }
        }
        adjustedDistM += MIN_SIGN_SEPARATION_M;
      }
    }
    
    // Update last sign distance for next iteration
    lastSignDistanceM = distM;
    
    // Store post-offset position for debug
    if (_debugInfo) {
      _debugInfo.signTargetsAfter.push(signPos);
    }
    
    // Assign labels in reverse order (C closest, A furthest)
    // i=0 (closest) -> C
    // i=1 -> B
    // i=2 (furthest) -> A
    const signLabels = ["C", "B", "A"];
    const label = i < 3 ? signLabels[i] : SIGN_LABELS[i];
    
    devices.push({
      id: generateDeviceId(),
      type: "sign",
      lngLat: signPos,
      label,
      meta: { 
        sequence: i + 1, 
        purpose: "advance_warning", 
        distanceFt: Math.round(distM / FT_TO_M), 
        method: "road_aligned",
        shoulderSide,
      },
    });
  }
  
  // Debug: Log final sign positions and pairwise distances
  if (DEBUG_SIGN_SPACING && devices.length >= 2) {
    const signLabels = devices.map(d => d.label).join(", ");
    console.log(`[SIGN_SPACING] Placed signs: ${signLabels}`);
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      console.log(`[SIGN_SPACING] ${d.label}: lng=${d.lngLat[0].toFixed(6)} lat=${d.lngLat[1].toFixed(6)} distFt=${d.meta?.distanceFt}`);
    }
    // Pairwise distances
    for (let i = 0; i < devices.length; i++) {
      for (let j = i + 1; j < devices.length; j++) {
        const dist = distanceMeters(devices[i].lngLat, devices[j].lngLat);
        const status = dist >= MIN_SIGN_SEPARATION_M ? "✅" : "❌ STACKED";
        console.log(`[SIGN_SPACING] ${devices[i].label}-${devices[j].label} distance: ${dist.toFixed(1)}m ${status}`);
      }
    }
  }
  
  return devices;
}

/**
 * Place signs using fallback axis method (when no road data available)
 * IMPROVED: Also applies shoulder offset to avoid centerline placement
 * Anti-stacking: Enforces MIN_SIGN_SEPARATION_M between signs
 */
function placeSignsFallback(
  axis: FallbackAxis,
  polygonRing: number[][],
  config: { signSpacingFt: number[] }
): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  // Determine shoulder side based on polygon position relative to axis
  const shoulderSide = computeShoulderSide(axis.upstreamBearing, axis.entryPoint, axis.centroid);
  
  if (_debugInfo) {
    _debugInfo.entryPoint = axis.entryPoint;
    _debugInfo.upstreamBearing = axis.upstreamBearing;
    _debugInfo.shoulderSide = shoulderSide;
  }
  
  // Track last placed sign distance for minimum separation enforcement
  let lastSignDistanceM = 0;
  
  for (let i = 0; i < config.signSpacingFt.length && i < 3; i++) {
    const requestedDistFt = config.signSpacingFt[i];
    let distM = requestedDistFt * FT_TO_M;
    
    // Enforce minimum separation from previous sign
    if (i > 0 && distM < lastSignDistanceM + MIN_SIGN_SEPARATION_M) {
      distM = lastSignDistanceM + MIN_SIGN_SEPARATION_M;
      if (DEBUG_SIGN_SPACING) {
        console.log(`[SIGN_SPACING_FALLBACK] Sign ${SIGN_LABELS[i]}: Adjusted distance from ${(requestedDistFt * FT_TO_M).toFixed(1)}m to ${distM.toFixed(1)}m for min separation`);
      }
    }
    
    // Move along upstream bearing
    const basePos = movePoint(axis.entryPoint, distM, axis.upstreamBearing);
    
    if (_debugInfo) {
      _debugInfo.signTargetsBefore.push(basePos);
    }
    
    // Apply shoulder offset
    let signPos = applyShoulderOffset(basePos, axis.upstreamBearing, shoulderSide);
    
    // Validation: sign must be OUTSIDE polygon
    let attempts = 0;
    while (isPointInPolygon(signPos, polygonRing) && attempts < 5) {
      attempts++;
      signPos = applyShoulderOffset(basePos, axis.upstreamBearing, shoulderSide, SHOULDER_OFFSET_M + attempts * 3);
    }
    
    // Anti-stacking check: ensure this sign is far enough from all existing devices
    if (isTooCloseToExisting(signPos, devices, MIN_SIGN_SEPARATION_M)) {
      let adjustedDistM = distM + MIN_SIGN_SEPARATION_M;
      for (let adjustAttempt = 0; adjustAttempt < 5; adjustAttempt++) {
        const adjustedBase = movePoint(axis.entryPoint, adjustedDistM, axis.upstreamBearing);
        const adjustedPos = applyShoulderOffset(adjustedBase, axis.upstreamBearing, shoulderSide);
        if (!isTooCloseToExisting(adjustedPos, devices, MIN_SIGN_SEPARATION_M)) {
          signPos = adjustedPos;
          distM = adjustedDistM;
          break;
        }
        adjustedDistM += MIN_SIGN_SEPARATION_M;
      }
    }
    
    // Update last sign distance for next iteration
    lastSignDistanceM = distM;
    
    if (_debugInfo) {
      _debugInfo.signTargetsAfter.push(signPos);
    }
    
    // Assign labels in reverse order (C closest, A furthest)
    const signLabels = ["C", "B", "A"];
    const label = i < 3 ? signLabels[i] : SIGN_LABELS[i];
    
    devices.push({
      id: generateDeviceId(),
      type: "sign",
      lngLat: signPos,
      label,
      meta: { 
        sequence: i + 1, 
        purpose: "advance_warning", 
        distanceFt: Math.round(distM / FT_TO_M), 
        method: "axis_fallback",
        shoulderSide,
      },
    });
  }
  
  // Debug: Log final sign positions and pairwise distances
  if (DEBUG_SIGN_SPACING && devices.length >= 2) {
    const signLabels = devices.map(d => d.label).join(", ");
    console.log(`[SIGN_SPACING_FALLBACK] Placed signs: ${signLabels}`);
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      console.log(`[SIGN_SPACING_FALLBACK] ${d.label}: lng=${d.lngLat[0].toFixed(6)} lat=${d.lngLat[1].toFixed(6)} distFt=${d.meta?.distanceFt}`);
    }
    // Pairwise distances
    for (let i = 0; i < devices.length; i++) {
      for (let j = i + 1; j < devices.length; j++) {
        const dist = distanceMeters(devices[i].lngLat, devices[j].lngLat);
        const status = dist >= MIN_SIGN_SEPARATION_M ? "✅" : "❌ STACKED";
        console.log(`[SIGN_SPACING_FALLBACK] ${devices[i].label}-${devices[j].label} distance: ${dist.toFixed(1)}m ${status}`);
      }
    }
  }
  
  return devices;
}

/**
 * Place cones along polygon boundary (closure edge)
 */
function placeConesAlongBoundary(
  polygonRing: number[][],
  entryPoint: Point,
  centroid: Point,
  config: { taperLengthFt: number; coneSpacingFt: number },
  existingDevices: FieldDevice[]
): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  const taperLengthM = config.taperLengthFt * FT_TO_M;
  const coneSpacingM = config.coneSpacingFt * FT_TO_M;
  
  // Direction from entry point toward centroid (into polygon)
  const taperBearing = bearing(entryPoint, centroid);
  const perpBearing = taperBearing + Math.PI / 2;
  
  const numCones = Math.max(4, Math.floor(taperLengthM / coneSpacingM));
  
  for (let i = 0; i < numCones; i++) {
    const distAlongTaper = i * coneSpacingM;
    
    // Base position along taper line
    let conePos = movePoint(entryPoint, distAlongTaper, taperBearing);
    
    // Add perpendicular offset for taper angle
    const taperOffset = (i / numCones) * 4;
    const sideMultiplier = i % 2 === 0 ? 1 : 0.5;
    conePos = movePoint(conePos, taperOffset * sideMultiplier, perpBearing);
    
    // Validation: cone should be INSIDE polygon or within 5m of boundary
    const distToPoly = distanceToPolygon(conePos, polygonRing);
    const isInside = isPointInPolygon(conePos, polygonRing);
    
    if (!isInside && distToPoly > 5) {
      conePos = clampToPolygon(conePos, polygonRing);
    }
    
    // Anti-stacking check
    if (isTooCloseToExisting(conePos, [...existingDevices, ...devices], MIN_DEVICE_SPACING_M)) {
      conePos = movePoint(conePos, MIN_DEVICE_SPACING_M, perpBearing);
      if (!isPointInPolygon(conePos, polygonRing)) {
        conePos = clampToPolygon(conePos, polygonRing);
      }
    }
    
    devices.push({
      id: generateDeviceId(),
      type: "cone",
      lngLat: conePos,
      meta: { sequence: i + 1, purpose: "taper" },
    });
  }
  
  return devices;
}

/**
 * Place flaggers at entry and exit points
 * Returns array with up to 2 flaggers (caller can slice if fewer needed)
 */
function placeFlaggers(entryPoint: Point, exitPoint: Point, upstreamBearing: number): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  // Flagger 1: Always placed at entry/taper point (upstream approach)
  const flagger1Pos = movePoint(entryPoint, 15, upstreamBearing);
  devices.push({
    id: generateDeviceId(),
    type: "flagger",
    lngLat: flagger1Pos,
    label: "F1",
    meta: { purpose: "Control traffic entering work zone", position: "upstream_approach" },
  });
  
  // Flagger 2: Placed at exit point (downstream approach) - for two-way operations
  const downstreamBearing = upstreamBearing + Math.PI;
  const flagger2Pos = movePoint(exitPoint, 15, downstreamBearing);
  devices.push({
    id: generateDeviceId(),
    type: "flagger",
    lngLat: flagger2Pos,
    label: "F2",
    meta: { purpose: "Control traffic from opposite direction", position: "downstream_approach" },
  });
  
  return devices;
}

/**
 * Place arrow board near entry point
 */
function placeArrowBoard(entryPoint: Point, upstreamBearing: number, polygonRing: number[][]): FieldDevice[] {
  let arrowPos = movePoint(entryPoint, 30, upstreamBearing);
  
  if (isPointInPolygon(arrowPos, polygonRing)) {
    arrowPos = movePoint(entryPoint, 50, upstreamBearing);
  }
  
  const rotationDeg = ((upstreamBearing + Math.PI) * 180 / Math.PI + 360) % 360;
  
  return [{
    id: generateDeviceId(),
    type: "arrowBoard",
    lngLat: arrowPos,
    label: "AB",
    rotation: Math.round(rotationDeg),
    meta: { purpose: "lane_closure_warning" },
  }];
}

// ============================================
// MAIN EXPORT
// ============================================

/**
 * Generate a suggested field layout for a work zone
 * 
 * Phase 2.1 Algorithm (Rules-Driven):
 * 1. Resolve placement rules from TCP Rules Pack (MUTCD/TTCM compliant)
 * 2. If roadCenterlines provided, select dominant road near polygon
 * 3. Determine upstream direction and shoulder side (left/right)
 * 4. Place signs along road with shoulder offset using resolved sign spacing
 * 5. Place cones as boundary-aligned taper using resolved taper length and cone spacing
 * 6. Validate all placements (inside/outside rules, road proximity, anti-stacking)
 */
export function suggestFieldLayout(input: LayoutSuggestionInput): FieldLayout {
  const {
    polygonRing,
    centroid: inputCentroid,
    roadType,
    postedSpeedMph,
    workType,
    workLengthFt,
    roadCenterlines,
  } = input;
  
  // Reset debug info
  resetDebugInfo();
  
  const now = new Date().toISOString();
  const devices: FieldDevice[] = [];
  
  // Get layout config from TCP Rules Pack (primary) or legacy fallback
  const config = getLayoutConfig(postedSpeedMph, workType);
  
  // Log the rules being used for debugging/QA
  console.log(
    `[LAYOUT] Using rules-based config: signSpacing=${config.signSpacingFt[0]}ft ` +
    `taper=${config.taperLengthFt}ft coneSpacing=${config.coneSpacingFt}ft ` +
    `drums=${config.drumsRequired} signs=[${config.requiredSigns.join(",")}]`
  );
  
  const centroid: Point = [inputCentroid.lng, inputCentroid.lat];
  
  // Try to select dominant road
  const dominantRoad = selectDominantRoadPolyline(roadCenterlines || [], polygonRing, centroid);
  
  let entryPoint: Point;
  let exitPoint: Point;
  let upstreamBearing: number;
  
  if (dominantRoad) {
    // STREET-AWARE: Use road polyline with shoulder offset
    const projection = projectPointToPolyline(centroid, dominantRoad);
    entryPoint = closestPointOnPolygon(projection.point, polygonRing);
    
    // Determine upstream direction
    const testDist = 50;
    const testWalk1 = walkAlongPolylineStrict(dominantRoad, projection.segmentIndex, projection.distanceAlongLine, -testDist);
    const testWalk2 = walkAlongPolylineStrict(dominantRoad, projection.segmentIndex, projection.distanceAlongLine, testDist);
    
    if (testWalk1 && testWalk2) {
      const dist1 = distanceToPolygon(testWalk1.point, polygonRing);
      const dist2 = distanceToPolygon(testWalk2.point, polygonRing);
      const upstreamPoint = dist1 > dist2 ? testWalk1.point : testWalk2.point;
      upstreamBearing = bearing(entryPoint, upstreamPoint);
      
      const downstreamPoint = dist1 > dist2 ? testWalk2.point : testWalk1.point;
      exitPoint = closestPointOnPolygon(downstreamPoint, polygonRing);
    } else {
      upstreamBearing = projection.segmentBearing;
      exitPoint = closestPointOnPolygon(movePoint(entryPoint, 100, upstreamBearing + Math.PI), polygonRing);
    }
    
    // Place signs along road with shoulder offset
    const signs = placeSignsAlongRoad(dominantRoad, polygonRing, centroid, config);
    devices.push(...signs);
  } else {
    // FALLBACK: Use polygon axis with shoulder offset
    const axis = deriveFallbackAxis(polygonRing);
    entryPoint = axis.entryPoint;
    exitPoint = axis.exitPoint;
    upstreamBearing = axis.upstreamBearing;
    
    const signs = placeSignsFallback(axis, polygonRing, config);
    devices.push(...signs);
  }
  
  // Place cones
  const cones = placeConesAlongBoundary(polygonRing, entryPoint, centroid, config, devices);
  devices.push(...cones);
  
  // Place flaggers based on resolved rules
  if (resolved.flaggerCount > 0) {
    console.log(`[LAYOUT] Placing ${resolved.flaggerCount} flaggers based on rules`);
    const flaggers = placeFlaggers(entryPoint, exitPoint, upstreamBearing);
    // Only place as many flaggers as the rules specify
    devices.push(...flaggers.slice(0, resolved.flaggerCount));
  }
  
  // Place arrow board (for lane closures at higher speeds)
  if (workType === "lane_closure" && postedSpeedMph >= 45) {
    const arrowBoards = placeArrowBoard(entryPoint, upstreamBearing, polygonRing);
    devices.push(...arrowBoards);
  }
  
  // Determine approach direction
  const bearingDeg = (upstreamBearing * 180 / Math.PI + 360) % 360;
  let direction: ApproachDirection;
  if (bearingDeg >= 315 || bearingDeg < 45) direction = "N";
  else if (bearingDeg >= 45 && bearingDeg < 135) direction = "E";
  else if (bearingDeg >= 135 && bearingDeg < 225) direction = "S";
  else direction = "W";
  
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    direction,
    devices,
    source: "ai_suggested",
  };
}

/**
 * Count devices by type in a layout
 */
export function countDevicesByType(layout: FieldLayout): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const device of layout.devices) {
    counts[device.type] = (counts[device.type] || 0) + 1;
  }
  return counts;
}

/**
 * Normalize GeoJSON features from queryRenderedFeatures into polylines
 */
export function normalizeRoadFeatures(features: GeoJSON.Feature[]): RoadPolyline[] {
  const polylines: RoadPolyline[] = [];
  
  for (const feature of features) {
    if (!feature.geometry) continue;
    
    if (feature.geometry.type === "LineString") {
      const coords = feature.geometry.coordinates as [number, number][];
      if (coords.length >= 2) {
        polylines.push(coords);
      }
    } else if (feature.geometry.type === "MultiLineString") {
      const multiCoords = feature.geometry.coordinates as [number, number][][];
      for (const coords of multiCoords) {
        if (coords.length >= 2) {
          polylines.push(coords);
        }
      }
    }
  }
  
  return polylines;
}
