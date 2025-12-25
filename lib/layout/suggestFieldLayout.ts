/**
 * AI Layout Suggestion Generator
 * 
 * Generates a credible visual mockup of TCP device placement based on
 * the work zone polygon and job parameters. This is NOT compliance math —
 * it's a starting point for the user to visualize and edit.
 */

import {
  FieldLayout,
  FieldDevice,
  LayoutSuggestionInput,
  ApproachDirection,
  generateDeviceId,
  SIGN_LABELS,
} from "../layoutTypes";

/**
 * Spacing buckets based on posted speed (simplified for MVP)
 * These are rough approximations for visual mockup purposes only
 */
const SPEED_SPACING: Record<number, { signSpacing: number; coneSpacing: number }> = {
  25: { signSpacing: 100, coneSpacing: 20 },
  30: { signSpacing: 100, coneSpacing: 20 },
  35: { signSpacing: 150, coneSpacing: 25 },
  40: { signSpacing: 200, coneSpacing: 30 },
  45: { signSpacing: 250, coneSpacing: 35 },
  50: { signSpacing: 300, coneSpacing: 40 },
  55: { signSpacing: 350, coneSpacing: 45 },
  60: { signSpacing: 400, coneSpacing: 50 },
  65: { signSpacing: 500, coneSpacing: 55 },
};

/**
 * Get spacing values for a given speed, interpolating if needed
 */
function getSpacingForSpeed(speedMph: number): { signSpacing: number; coneSpacing: number } {
  // Clamp to valid range
  const clampedSpeed = Math.max(25, Math.min(65, speedMph));
  
  // Round to nearest 5
  const roundedSpeed = Math.round(clampedSpeed / 5) * 5;
  
  return SPEED_SPACING[roundedSpeed] || SPEED_SPACING[35];
}

/**
 * Compute the bounding box of a polygon ring
 */
function computeBbox(ring: number[][]): { west: number; south: number; east: number; north: number } {
  const lngs = ring.map(p => p[0]);
  const lats = ring.map(p => p[1]);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

/**
 * Infer the approach direction based on polygon shape and orientation
 * This is a simple heuristic based on the longer axis of the bounding box
 */
function inferApproachDirection(ring: number[][]): ApproachDirection {
  const bbox = computeBbox(ring);
  const width = bbox.east - bbox.west;
  const height = bbox.north - bbox.south;
  
  // If polygon is taller than wide, assume N-S traffic flow
  // Otherwise, assume E-W traffic flow
  // Default to approaching from South (most common for lane closures)
  if (height > width * 1.2) {
    return "S"; // Traffic approaches from south
  } else if (width > height * 1.2) {
    return "W"; // Traffic approaches from west
  }
  return "S"; // Default
}

/**
 * Convert feet to approximate degrees (very rough, varies by latitude)
 * At ~45° latitude: 1 degree ≈ 364,000 feet longitude, 364,000 feet latitude
 * This is a rough approximation for visual purposes only
 */
function feetToDegrees(feet: number, isLongitude: boolean = false): number {
  // Rough conversion: 1 foot ≈ 0.000003 degrees (at mid-latitudes)
  const baseFactor = 0.000003;
  // Longitude degrees are "smaller" at higher latitudes, but for mockup we'll ignore
  return feet * baseFactor;
}

/**
 * Generate a point offset from a base point in a given direction
 */
function offsetPoint(
  base: [number, number],
  distanceFt: number,
  direction: ApproachDirection
): [number, number] {
  const [lng, lat] = base;
  const dist = feetToDegrees(distanceFt);
  
  switch (direction) {
    case "N":
      return [lng, lat + dist];
    case "S":
      return [lng, lat - dist];
    case "E":
      return [lng + dist, lat];
    case "W":
      return [lng - dist, lat];
    case "NE":
      return [lng + dist * 0.707, lat + dist * 0.707];
    case "NW":
      return [lng - dist * 0.707, lat + dist * 0.707];
    case "SE":
      return [lng + dist * 0.707, lat - dist * 0.707];
    case "SW":
      return [lng - dist * 0.707, lat - dist * 0.707];
    default:
      return [lng, lat - dist];
  }
}

/**
 * Get the "approach" direction (opposite of traffic flow direction)
 * If traffic approaches from S, we place devices to the S of the work zone
 */
function getApproachOffset(direction: ApproachDirection): ApproachDirection {
  // The approach direction is where we place advance warning devices
  // (upstream of the work zone, where traffic comes from)
  return direction;
}

/**
 * Get the perpendicular direction for taper offset
 */
function getTaperDirection(direction: ApproachDirection): ApproachDirection {
  switch (direction) {
    case "N":
    case "S":
      return "E"; // Offset east for N/S traffic
    case "E":
    case "W":
      return "N"; // Offset north for E/W traffic
    default:
      return "E";
  }
}

/**
 * Find the edge of the polygon closest to the approach direction
 */
function getApproachEdgePoint(
  ring: number[][],
  centroid: { lng: number; lat: number },
  direction: ApproachDirection
): [number, number] {
  const bbox = computeBbox(ring);
  
  switch (direction) {
    case "S":
      return [centroid.lng, bbox.south];
    case "N":
      return [centroid.lng, bbox.north];
    case "W":
      return [bbox.west, centroid.lat];
    case "E":
      return [bbox.east, centroid.lat];
    default:
      return [centroid.lng, bbox.south];
  }
}

/**
 * Generate a suggested field layout for a work zone
 * 
 * MVP behavior:
 * - Place 3 signs upstream of polygon centroid along approach line
 * - Place cones along a taper line toward polygon edge
 * - Use simple spacing based on speed
 */
export function suggestFieldLayout(input: LayoutSuggestionInput): FieldLayout {
  const {
    polygonRing,
    centroid,
    roadType,
    postedSpeedMph,
    workType,
    workLengthFt,
  } = input;
  
  const now = new Date().toISOString();
  const devices: FieldDevice[] = [];
  
  // Infer approach direction
  const direction = inferApproachDirection(polygonRing);
  
  // Get spacing values for this speed
  const { signSpacing, coneSpacing } = getSpacingForSpeed(postedSpeedMph);
  
  // Get the edge of the work zone closest to approaching traffic
  const approachEdge = getApproachEdgePoint(polygonRing, centroid, direction);
  
  // ============================================
  // PLACE ADVANCE WARNING SIGNS (A, B, C)
  // ============================================
  // Signs are placed upstream of the work zone, in the approach direction
  const signCount = 3;
  for (let i = 0; i < signCount; i++) {
    const distanceFromEdge = signSpacing * (signCount - i); // A is furthest, C is closest
    const signPos = offsetPoint(approachEdge, distanceFromEdge, direction);
    
    devices.push({
      id: generateDeviceId(),
      type: "sign",
      lngLat: signPos,
      label: SIGN_LABELS[i],
      meta: {
        sequence: i + 1,
        purpose: "advance_warning",
      },
    });
  }
  
  // ============================================
  // PLACE TAPER CONES
  // ============================================
  // Cones form a taper from the last sign position toward the work zone
  const taperDirection = getTaperDirection(direction);
  const taperLength = Math.min(500, workLengthFt * 0.5); // Rough taper length
  const coneCount = Math.max(4, Math.floor(taperLength / coneSpacing));
  
  // Start taper at the approach edge
  const taperStartPos = approachEdge;
  
  for (let i = 0; i < coneCount; i++) {
    // Move along the approach direction (toward work zone)
    const alongDist = -coneSpacing * i; // Negative because we're moving into the work zone
    const basePos = offsetPoint(taperStartPos, alongDist, direction);
    
    // Also offset perpendicular to create the taper angle
    const perpOffset = (coneSpacing * i) * 0.3; // Gradual taper
    const conePos = offsetPoint(basePos, perpOffset, taperDirection);
    
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
  
  // ============================================
  // PLACE FLAGGERS (for specific work types)
  // ============================================
  if (workType === "one_lane_two_way_flaggers") {
    // Place flagger at approach edge
    devices.push({
      id: generateDeviceId(),
      type: "flagger",
      lngLat: offsetPoint(approachEdge, 50, direction), // 50 ft from edge
      label: "F1",
      meta: {
        purpose: "traffic_control",
      },
    });
    
    // Place flagger at downstream edge (opposite direction)
    const oppositeDirection = direction === "S" ? "N" : direction === "N" ? "S" : direction === "W" ? "E" : "W";
    const downstreamEdge = getApproachEdgePoint(polygonRing, centroid, oppositeDirection as ApproachDirection);
    devices.push({
      id: generateDeviceId(),
      type: "flagger",
      lngLat: offsetPoint(downstreamEdge, 50, oppositeDirection as ApproachDirection),
      label: "F2",
      meta: {
        purpose: "traffic_control",
      },
    });
  }
  
  // ============================================
  // PLACE ARROW BOARD (for lane closures)
  // ============================================
  if (workType === "lane_closure" && postedSpeedMph >= 45) {
    // Arrow board placed at the beginning of the taper
    const arrowPos = offsetPoint(taperStartPos, signSpacing * 0.5, direction);
    devices.push({
      id: generateDeviceId(),
      type: "arrowBoard",
      lngLat: arrowPos,
      label: "AB",
      rotation: direction === "S" ? 0 : direction === "N" ? 180 : direction === "W" ? 90 : 270,
      meta: {
        purpose: "lane_closure_warning",
      },
    });
  }
  
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

