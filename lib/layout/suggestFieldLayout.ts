/**
 * Street-Aware Layout Suggestion Engine
 * 
 * Generates a credible visual mockup of TCP device placement based on
 * polygon geometry analysis. Uses a "work zone axis" derived from the
 * polygon shape to place devices realistically along a virtual centerline.
 */

import {
  FieldLayout,
  FieldDevice,
  LayoutSuggestionInput,
  ApproachDirection,
  generateDeviceId,
  SIGN_LABELS,
} from "../layoutTypes";

// ============================================
// CONSTANTS
// ============================================

/** Feet to meters conversion */
const FT_TO_M = 0.3048;

/** Meters to approximate degrees (rough, ~45° latitude) */
const M_TO_DEG = 1 / 111320;

/** Speed-based spacing in feet */
const SPEED_CONFIG: Record<number, { signSpacingFt: number[]; taperLengthFt: number; coneSpacingFt: number }> = {
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
  const lng1 = p[0] * Math.PI / 180;
  
  // Simplified projection (works well for small distances)
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
 * Find the longest edge of a polygon and return its bearing
 */
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
  
  const edgeBearing = bearing(longestEdge.p1, longestEdge.p2);
  const midpoint: Point = [
    (longestEdge.p1[0] + longestEdge.p2[0]) / 2,
    (longestEdge.p1[1] + longestEdge.p2[1]) / 2,
  ];
  
  return { bearing: edgeBearing, midpoint };
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
 * Find the closest point on a polygon boundary to a given point
 */
function closestPointOnPolygon(point: Point, ring: number[][]): Point {
  let minDist = Infinity;
  let closest: Point = point;
  
  for (let i = 0; i < ring.length; i++) {
    const p1: Point = [ring[i][0], ring[i][1]];
    const p2: Point = [ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1]];
    
    // Project point onto line segment
    const projected = projectPointOnSegment(point, p1, p2);
    const dist = distanceMeters(point, projected);
    
    if (dist < minDist) {
      minDist = dist;
      closest = projected;
    }
  }
  
  return closest;
}

/**
 * Project a point onto a line segment
 */
function projectPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) return a;
  
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Find intersection points between a line and polygon
 */
function linePolygonIntersections(
  lineStart: Point,
  lineEnd: Point,
  ring: number[][]
): Point[] {
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

/**
 * Find intersection point between two line segments
 */
function lineSegmentIntersection(
  a1: Point, a2: Point,
  b1: Point, b2: Point
): Point | null {
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
  
  // Check if intersection is within both segments
  // For the polygon edge, must be within [0, 1]
  // For the centerline, we allow extended range since it's a long line
  if (u >= 0 && u <= 1 && t >= -10 && t <= 10) {
    return [a1[0] + t * d1x, a1[1] + t * d1y];
  }
  
  return null;
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
// WORK ZONE AXIS DERIVATION
// ============================================

interface WorkZoneAxis {
  /** Polygon centroid */
  centroid: Point;
  /** Primary axis bearing (radians) */
  axisBearing: number;
  /** Entry point where axis enters polygon (upstream) */
  entryPoint: Point;
  /** Exit point where axis exits polygon (downstream) */
  exitPoint: Point;
  /** Upstream direction bearing (traffic comes from this direction) */
  upstreamBearing: number;
}

/**
 * Derive the work zone axis from polygon geometry
 */
function deriveWorkZoneAxis(ring: number[][], trafficDirection: "forward" | "reverse" = "forward"): WorkZoneAxis {
  const centroid = computeCentroid(ring);
  const { bearing: edgeBearing } = findLongestEdgeBearing(ring);
  
  // Create a long virtual centerline through the centroid
  const extendDist = 500; // meters
  const lineStart = movePoint(centroid, extendDist, edgeBearing + Math.PI);
  const lineEnd = movePoint(centroid, extendDist, edgeBearing);
  
  // Find intersections with polygon
  const intersections = linePolygonIntersections(lineStart, lineEnd, ring);
  
  let entryPoint: Point;
  let exitPoint: Point;
  
  if (intersections.length >= 2) {
    // Sort by distance from lineStart
    intersections.sort((a, b) => 
      distanceMeters(lineStart, a) - distanceMeters(lineStart, b)
    );
    
    if (trafficDirection === "forward") {
      entryPoint = intersections[0];
      exitPoint = intersections[intersections.length - 1];
    } else {
      entryPoint = intersections[intersections.length - 1];
      exitPoint = intersections[0];
    }
  } else {
    // Fallback: use closest polygon points
    entryPoint = closestPointOnPolygon(lineStart, ring);
    exitPoint = closestPointOnPolygon(lineEnd, ring);
  }
  
  // Upstream bearing points AWAY from polygon (direction traffic comes from)
  const upstreamBearing = bearing(entryPoint, lineStart);
  
  return {
    centroid,
    axisBearing: edgeBearing,
    entryPoint,
    exitPoint,
    upstreamBearing,
  };
}

// ============================================
// DEVICE PLACEMENT
// ============================================

/**
 * Get speed configuration, interpolating if needed
 */
function getSpeedConfig(speedMph: number): { signSpacingFt: number[]; taperLengthFt: number; coneSpacingFt: number } {
  const clamped = Math.max(25, Math.min(65, speedMph));
  const rounded = Math.round(clamped / 5) * 5;
  return SPEED_CONFIG[rounded] || SPEED_CONFIG[35];
}

/**
 * Place signs upstream of entry point along the axis
 */
function placeSigns(
  axis: WorkZoneAxis,
  ring: number[][],
  config: { signSpacingFt: number[] }
): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  for (let i = 0; i < config.signSpacingFt.length && i < 3; i++) {
    const distFt = config.signSpacingFt[i];
    const distM = distFt * FT_TO_M;
    
    // Place sign upstream of entry point
    let signPos = movePoint(axis.entryPoint, distM, axis.upstreamBearing);
    
    // Validation: sign must be OUTSIDE polygon
    if (isPointInPolygon(signPos, ring)) {
      // Move further upstream until outside
      for (let j = 1; j <= 5; j++) {
        signPos = movePoint(axis.entryPoint, distM + j * 20, axis.upstreamBearing);
        if (!isPointInPolygon(signPos, ring)) break;
      }
    }
    
    // Validation: sign should be within 15m of centerline (it should be on centerline by construction)
    // This is already satisfied since we're moving along the axis
    
    devices.push({
      id: generateDeviceId(),
      type: "sign",
      lngLat: signPos,
      label: SIGN_LABELS[i],
      meta: {
        sequence: i + 1,
        purpose: "advance_warning",
        distanceFt: distFt,
      },
    });
  }
  
  return devices;
}

/**
 * Place cones as a taper from entry point into the polygon
 */
function placeCones(
  axis: WorkZoneAxis,
  ring: number[][],
  config: { taperLengthFt: number; coneSpacingFt: number }
): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  const taperLengthM = config.taperLengthFt * FT_TO_M;
  const coneSpacingM = config.coneSpacingFt * FT_TO_M;
  
  // Taper direction: from entry point toward centroid (into polygon)
  const taperBearing = bearing(axis.entryPoint, axis.centroid);
  
  // Perpendicular offset for creating a taper line (alternating sides)
  const perpBearing = taperBearing + Math.PI / 2;
  const perpOffset = 2; // meters, alternating left/right
  
  const numCones = Math.max(4, Math.floor(taperLengthM / coneSpacingM));
  
  for (let i = 0; i < numCones; i++) {
    const distAlongTaper = i * coneSpacingM;
    
    // Base position along taper line
    let conePos = movePoint(axis.entryPoint, distAlongTaper, taperBearing);
    
    // Add perpendicular offset for taper angle
    // Offset increases as we move into the polygon (creates taper shape)
    const taperOffset = (i / numCones) * 3; // max 3m lateral shift
    const sideMultiplier = i % 2 === 0 ? 1 : -1; // alternate sides for visual effect
    conePos = movePoint(conePos, taperOffset + sideMultiplier * perpOffset * 0.5, perpBearing);
    
    // Validation: cone should be INSIDE polygon or within 5m of boundary
    const distToPoly = distanceToPolygon(conePos, ring);
    const isInside = isPointInPolygon(conePos, ring);
    
    if (!isInside && distToPoly > 5) {
      // Clamp to polygon boundary
      conePos = clampToPolygon(conePos, ring);
    }
    
    devices.push({
      id: generateDeviceId(),
      type: "cone",
      lngLat: conePos,
      meta: {
        sequence: i + 1,
        purpose: "taper",
      },
    });
  }
  
  return devices;
}

/**
 * Place flaggers at entry and exit points (for applicable work types)
 */
function placeFlaggers(axis: WorkZoneAxis): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  // Flagger 1: upstream of entry point
  const flagger1Pos = movePoint(axis.entryPoint, 15, axis.upstreamBearing);
  devices.push({
    id: generateDeviceId(),
    type: "flagger",
    lngLat: flagger1Pos,
    label: "F1",
    meta: { purpose: "traffic_control", position: "upstream" },
  });
  
  // Flagger 2: downstream of exit point
  const downstreamBearing = axis.upstreamBearing + Math.PI;
  const flagger2Pos = movePoint(axis.exitPoint, 15, downstreamBearing);
  devices.push({
    id: generateDeviceId(),
    type: "flagger",
    lngLat: flagger2Pos,
    label: "F2",
    meta: { purpose: "traffic_control", position: "downstream" },
  });
  
  return devices;
}

/**
 * Place arrow board near entry point (for lane closures at higher speeds)
 */
function placeArrowBoard(axis: WorkZoneAxis, ring: number[][]): FieldDevice[] {
  // Arrow board position: just upstream of entry point
  let arrowPos = movePoint(axis.entryPoint, 30, axis.upstreamBearing);
  
  // Ensure outside polygon
  if (isPointInPolygon(arrowPos, ring)) {
    arrowPos = movePoint(axis.entryPoint, 50, axis.upstreamBearing);
  }
  
  // Convert bearing to rotation degrees (0 = north, clockwise)
  const rotationDeg = ((axis.upstreamBearing + Math.PI) * 180 / Math.PI + 360) % 360;
  
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
 * Street-aware algorithm:
 * 1. Derive work zone axis from polygon geometry
 * 2. Place signs upstream along the axis (outside polygon)
 * 3. Place cones as a taper from entry point (inside polygon)
 * 4. Validate all placements
 */
export function suggestFieldLayout(input: LayoutSuggestionInput): FieldLayout {
  const {
    polygonRing,
    centroid: inputCentroid,
    roadType,
    postedSpeedMph,
    workType,
    workLengthFt,
  } = input;
  
  const now = new Date().toISOString();
  const devices: FieldDevice[] = [];
  
  // Get speed-based configuration
  const config = getSpeedConfig(postedSpeedMph);
  
  // Derive work zone axis from polygon geometry
  const axis = deriveWorkZoneAxis(polygonRing);
  
  // Place signs (always)
  const signs = placeSigns(axis, polygonRing, config);
  devices.push(...signs);
  
  // Place cones (always)
  const cones = placeCones(axis, polygonRing, config);
  devices.push(...cones);
  
  // Place flaggers (for specific work types)
  if (workType === "one_lane_two_way_flaggers") {
    const flaggers = placeFlaggers(axis);
    devices.push(...flaggers);
  }
  
  // Place arrow board (for lane closures at higher speeds)
  if (workType === "lane_closure" && postedSpeedMph >= 45) {
    const arrowBoards = placeArrowBoard(axis, polygonRing);
    devices.push(...arrowBoards);
  }
  
  // Determine approach direction from axis bearing
  const bearingDeg = (axis.upstreamBearing * 180 / Math.PI + 360) % 360;
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
