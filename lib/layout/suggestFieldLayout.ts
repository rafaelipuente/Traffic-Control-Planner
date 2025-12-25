/**
 * Street-Aware Layout Suggestion Engine (Phase 2)
 * 
 * Generates TCP device placement aligned to REAL streets when road centerline
 * data is available (via queryRenderedFeatures). Falls back to polygon-axis
 * method when no road data is provided.
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

// ============================================
// CONSTANTS
// ============================================

/** Feet to meters conversion */
const FT_TO_M = 0.3048;

/** Meters to approximate degrees (rough, ~45° latitude) */
const M_TO_DEG = 1 / 111320;

/** Minimum distance between devices to prevent stacking (meters) */
const MIN_DEVICE_SPACING_M = 3;

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

/**
 * Project a point onto a polyline and return the closest point + segment info
 */
function projectPointToPolyline(point: Point, polyline: RoadPolyline): {
  point: Point;
  segmentIndex: number;
  distanceAlongLine: number;
  distanceFromLine: number;
} {
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
  
  return {
    point: closestPoint,
    segmentIndex: closestSegment,
    distanceAlongLine: distanceAlong,
    distanceFromLine: minDist,
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
 * Negative distance walks backwards
 */
function walkAlongPolyline(
  polyline: RoadPolyline,
  startSegmentIndex: number,
  startDistanceAlong: number,
  walkDistance: number
): Point | null {
  // Calculate cumulative distances to each vertex
  const distances: number[] = [0];
  for (let i = 0; i < polyline.length - 1; i++) {
    distances.push(distances[i] + distanceMeters(polyline[i], polyline[i + 1]));
  }
  
  const targetDistance = startDistanceAlong + walkDistance;
  
  // Handle walking off the end
  if (targetDistance < 0) {
    // Extend from start
    const dir = bearing(polyline[1], polyline[0]);
    return movePoint(polyline[0], -targetDistance, dir);
  }
  
  const totalLength = distances[distances.length - 1];
  if (targetDistance > totalLength) {
    // Extend from end
    const lastIdx = polyline.length - 1;
    const dir = bearing(polyline[lastIdx - 1], polyline[lastIdx]);
    return movePoint(polyline[lastIdx], targetDistance - totalLength, dir);
  }
  
  // Find the segment containing the target distance
  for (let i = 0; i < distances.length - 1; i++) {
    if (targetDistance >= distances[i] && targetDistance <= distances[i + 1]) {
      const segmentLength = distances[i + 1] - distances[i];
      const t = segmentLength > 0 ? (targetDistance - distances[i]) / segmentLength : 0;
      
      const a = polyline[i];
      const b = polyline[i + 1];
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  
  return polyline[polyline.length - 1];
}

/**
 * Get the bearing at a point along a polyline
 */
function bearingAtPolylinePoint(polyline: RoadPolyline, segmentIndex: number): number {
  const idx = Math.min(segmentIndex, polyline.length - 2);
  return bearing(polyline[idx], polyline[idx + 1]);
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
      
      // Simple bbox intersection check
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
    const { distanceFromLine } = projectPointToPolyline(centroid, road);
    
    // Score: prefer closer roads with more length in bbox
    // Lower distance = better, higher length = better
    const distanceScore = Math.max(0, 500 - distanceFromLine) / 500; // 0-1, 1 is best
    const lengthScore = Math.min(lengthInBbox / 200, 1); // 0-1, cap at 200m
    const score = distanceScore * 0.7 + lengthScore * 0.3;
    
    if (score > 0) {
      scoredRoads.push({
        polyline: road,
        score,
        distanceFromCentroid: distanceFromLine,
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
  
  return {
    bearing: bearing(longestEdge.p1, longestEdge.p2),
    midpoint: [(longestEdge.p1[0] + longestEdge.p2[0]) / 2, (longestEdge.p1[1] + longestEdge.p2[1]) / 2],
  };
}

/**
 * Find intersection points between a line and polygon
 */
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

/**
 * Derive work zone axis from polygon geometry (fallback method)
 */
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

function getSpeedConfig(speedMph: number): { signSpacingFt: number[]; taperLengthFt: number; coneSpacingFt: number } {
  const clamped = Math.max(25, Math.min(65, speedMph));
  const rounded = Math.round(clamped / 5) * 5;
  return SPEED_CONFIG[rounded] || SPEED_CONFIG[35];
}

/**
 * Check if a device position is too close to existing devices
 */
function isTooCloseToExisting(pos: Point, existingDevices: FieldDevice[], minSpacing: number): boolean {
  for (const device of existingDevices) {
    if (distanceMeters(pos, device.lngLat) < minSpacing) {
      return true;
    }
  }
  return false;
}

/**
 * Place signs along a road polyline (street-aware method)
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
  // Try both directions and pick the one that leads outside the polygon faster
  const testDist = 50; // meters
  const testPoint1 = walkAlongPolyline(road, projection.segmentIndex, projection.distanceAlongLine, -testDist);
  const testPoint2 = walkAlongPolyline(road, projection.segmentIndex, projection.distanceAlongLine, testDist);
  
  // Pick direction that goes outside polygon
  let upstreamDirection = -1; // negative = walk backwards along polyline
  if (testPoint1 && testPoint2) {
    const dist1ToPolygon = distanceToPolygon(testPoint1, polygonRing);
    const dist2ToPolygon = distanceToPolygon(testPoint2, polygonRing);
    upstreamDirection = dist1ToPolygon > dist2ToPolygon ? -1 : 1;
  }
  
  // Place signs upstream
  for (let i = 0; i < config.signSpacingFt.length && i < 3; i++) {
    const distFt = config.signSpacingFt[i];
    const distM = distFt * FT_TO_M;
    
    let signPos = walkAlongPolyline(
      road,
      projection.segmentIndex,
      projection.distanceAlongLine,
      upstreamDirection * distM
    );
    
    if (!signPos) continue;
    
    // Validation: sign must be OUTSIDE polygon
    let attempts = 0;
    while (isPointInPolygon(signPos, polygonRing) && attempts < 10) {
      attempts++;
      signPos = walkAlongPolyline(
        road,
        projection.segmentIndex,
        projection.distanceAlongLine,
        upstreamDirection * (distM + attempts * 20)
      );
      if (!signPos) break;
    }
    
    if (!signPos) continue;
    
    // Anti-stacking check
    if (isTooCloseToExisting(signPos, devices, MIN_DEVICE_SPACING_M)) {
      // Push further upstream
      signPos = walkAlongPolyline(
        road,
        projection.segmentIndex,
        projection.distanceAlongLine,
        upstreamDirection * (distM + 15)
      );
      if (!signPos) continue;
    }
    
    devices.push({
      id: generateDeviceId(),
      type: "sign",
      lngLat: signPos,
      label: SIGN_LABELS[i],
      meta: { sequence: i + 1, purpose: "advance_warning", distanceFt: distFt, method: "road_aligned" },
    });
  }
  
  return devices;
}

/**
 * Place signs using fallback axis method
 */
function placeSignsFallback(
  axis: FallbackAxis,
  polygonRing: number[][],
  config: { signSpacingFt: number[] }
): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  for (let i = 0; i < config.signSpacingFt.length && i < 3; i++) {
    const distFt = config.signSpacingFt[i];
    const distM = distFt * FT_TO_M;
    
    let signPos = movePoint(axis.entryPoint, distM, axis.upstreamBearing);
    
    // Validation: sign must be OUTSIDE polygon
    let attempts = 0;
    while (isPointInPolygon(signPos, polygonRing) && attempts < 5) {
      attempts++;
      signPos = movePoint(axis.entryPoint, distM + attempts * 20, axis.upstreamBearing);
    }
    
    // Anti-stacking check
    if (isTooCloseToExisting(signPos, devices, MIN_DEVICE_SPACING_M)) {
      signPos = movePoint(axis.entryPoint, distM + 15, axis.upstreamBearing);
    }
    
    devices.push({
      id: generateDeviceId(),
      type: "sign",
      lngLat: signPos,
      label: SIGN_LABELS[i],
      meta: { sequence: i + 1, purpose: "advance_warning", distanceFt: distFt, method: "axis_fallback" },
    });
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
  
  // Find the polygon edge segment closest to the entry point
  let closestEdgeStart = 0;
  let minDist = Infinity;
  
  for (let i = 0; i < polygonRing.length; i++) {
    const p: Point = [polygonRing[i][0], polygonRing[i][1]];
    const dist = distanceMeters(entryPoint, p);
    if (dist < minDist) {
      minDist = dist;
      closestEdgeStart = i;
    }
  }
  
  // Direction from entry point toward centroid (into polygon)
  const taperBearing = bearing(entryPoint, centroid);
  const perpBearing = taperBearing + Math.PI / 2;
  
  const numCones = Math.max(4, Math.floor(taperLengthM / coneSpacingM));
  
  for (let i = 0; i < numCones; i++) {
    const distAlongTaper = i * coneSpacingM;
    
    // Base position along taper line
    let conePos = movePoint(entryPoint, distAlongTaper, taperBearing);
    
    // Add perpendicular offset for taper angle (creates diagonal line)
    const taperOffset = (i / numCones) * 4; // max 4m lateral shift
    const sideMultiplier = i % 2 === 0 ? 1 : 0.5; // slight alternation
    conePos = movePoint(conePos, taperOffset * sideMultiplier, perpBearing);
    
    // Validation: cone should be INSIDE polygon or within 5m of boundary
    const distToPoly = distanceToPolygon(conePos, polygonRing);
    const isInside = isPointInPolygon(conePos, polygonRing);
    
    if (!isInside && distToPoly > 5) {
      conePos = clampToPolygon(conePos, polygonRing);
    }
    
    // Anti-stacking check
    if (isTooCloseToExisting(conePos, [...existingDevices, ...devices], MIN_DEVICE_SPACING_M)) {
      // Try offset position
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
 */
function placeFlaggers(entryPoint: Point, exitPoint: Point, upstreamBearing: number): FieldDevice[] {
  const devices: FieldDevice[] = [];
  
  const flagger1Pos = movePoint(entryPoint, 15, upstreamBearing);
  devices.push({
    id: generateDeviceId(),
    type: "flagger",
    lngLat: flagger1Pos,
    label: "F1",
    meta: { purpose: "traffic_control", position: "upstream" },
  });
  
  const downstreamBearing = upstreamBearing + Math.PI;
  const flagger2Pos = movePoint(exitPoint, 15, downstreamBearing);
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
 * Phase 2 Algorithm:
 * 1. If roadCenterlines provided, select dominant road near polygon
 * 2. Place signs along road (street-aware) or fallback axis
 * 3. Place cones as boundary-aligned taper (no stacking)
 * 4. Validate all placements (inside/outside rules, anti-stacking)
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
  
  const now = new Date().toISOString();
  const devices: FieldDevice[] = [];
  const config = getSpeedConfig(postedSpeedMph);
  const centroid: Point = [inputCentroid.lng, inputCentroid.lat];
  
  // Try to select dominant road
  const dominantRoad = selectDominantRoadPolyline(roadCenterlines || [], polygonRing, centroid);
  
  let entryPoint: Point;
  let exitPoint: Point;
  let upstreamBearing: number;
  let usedMethod: "road_aligned" | "axis_fallback";
  
  if (dominantRoad) {
    // STREET-AWARE: Use road polyline
    usedMethod = "road_aligned";
    
    // Project centroid to road
    const projection = projectPointToPolyline(centroid, dominantRoad);
    entryPoint = closestPointOnPolygon(projection.point, polygonRing);
    
    // Determine upstream direction
    const testDist = 50;
    const testPoint1 = walkAlongPolyline(dominantRoad, projection.segmentIndex, projection.distanceAlongLine, -testDist);
    const testPoint2 = walkAlongPolyline(dominantRoad, projection.segmentIndex, projection.distanceAlongLine, testDist);
    
    if (testPoint1 && testPoint2) {
      const dist1 = distanceToPolygon(testPoint1, polygonRing);
      const dist2 = distanceToPolygon(testPoint2, polygonRing);
      const upstreamPoint = dist1 > dist2 ? testPoint1 : testPoint2;
      upstreamBearing = bearing(entryPoint, upstreamPoint);
      
      // Exit point is opposite direction
      const downstreamPoint = dist1 > dist2 ? testPoint2 : testPoint1;
      exitPoint = closestPointOnPolygon(downstreamPoint, polygonRing);
    } else {
      // Fallback within road method
      upstreamBearing = bearingAtPolylinePoint(dominantRoad, projection.segmentIndex);
      exitPoint = closestPointOnPolygon(movePoint(entryPoint, 100, upstreamBearing + Math.PI), polygonRing);
    }
    
    // Place signs along road
    const signs = placeSignsAlongRoad(dominantRoad, polygonRing, centroid, config);
    devices.push(...signs);
  } else {
    // FALLBACK: Use polygon axis
    usedMethod = "axis_fallback";
    
    const axis = deriveFallbackAxis(polygonRing);
    entryPoint = axis.entryPoint;
    exitPoint = axis.exitPoint;
    upstreamBearing = axis.upstreamBearing;
    
    // Place signs using fallback
    const signs = placeSignsFallback(axis, polygonRing, config);
    devices.push(...signs);
  }
  
  // Place cones (same method for both)
  const cones = placeConesAlongBoundary(polygonRing, entryPoint, centroid, config, devices);
  devices.push(...cones);
  
  // Place flaggers (for specific work types)
  if (workType === "one_lane_two_way_flaggers") {
    const flaggers = placeFlaggers(entryPoint, exitPoint, upstreamBearing);
    devices.push(...flaggers);
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
