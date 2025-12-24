/**
 * Geometry Analysis Utilities
 * 
 * BBox-only MVP implementation for deriving diagram orientation.
 * Uses simple ratio thresholds with hysteresis to prevent flip-flopping.
 */

import {
  DiagramGeometry,
  DiagramOrientation,
  GeometryAnalysis,
  Bbox,
  PolygonRing,
} from "./types";

// Ratio thresholds with hysteresis to prevent flip-flopping
const VERTICAL_THRESHOLD = 1.15; // H/W > 1.15 => vertical
const HORIZONTAL_THRESHOLD = 0.87; // H/W < 0.87 => horizontal
// Values between 0.87 and 1.15 default to vertical (stable default)

/**
 * Derive bounding box from polygon vertices.
 * Takes the first ring of the polygon and computes [west, south, east, north].
 */
function bboxFromPolygon(polygon: PolygonRing[]): Bbox {
  const ring = polygon[0];
  if (!ring || ring.length === 0) {
    // Fallback to a default small bbox
    return [0, 0, 0.001, 0.001];
  }

  let west = ring[0][0];
  let east = ring[0][0];
  let south = ring[0][1];
  let north = ring[0][1];

  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  return [west, south, east, north];
}

/**
 * Determine orientation from aspect ratio with hysteresis.
 * 
 * - H/W > 1.15 => "vertical" (taller than wide)
 * - H/W < 0.87 => "horizontal" (wider than tall)
 * - Otherwise => "vertical" (stable default)
 */
function orientationFromRatio(aspectRatio: number): DiagramOrientation {
  if (aspectRatio > VERTICAL_THRESHOLD) {
    return "vertical";
  } else if (aspectRatio < HORIZONTAL_THRESHOLD) {
    return "horizontal";
  }
  // In the hysteresis band, default to vertical for stability
  return "vertical";
}

/**
 * Analyze geometry and derive diagram properties.
 * 
 * For MVP, we only use the bounding box (derived from polygon if needed).
 * Returns orientation and bbox dimensions.
 */
export function analyzeGeometry(geometry: DiagramGeometry): GeometryAnalysis {
  let bbox: Bbox;

  if (geometry.type === "bbox" && geometry.bbox) {
    bbox = geometry.bbox;
  } else if (geometry.type === "polygon" && geometry.polygon) {
    bbox = bboxFromPolygon(geometry.polygon);
  } else {
    // Fallback: no valid geometry
    bbox = [0, 0, 0.001, 0.001];
  }

  const [west, south, east, north] = bbox;
  
  // Bbox dimensions in degrees
  const bboxWidthDeg = Math.abs(east - west);
  const bboxHeightDeg = Math.abs(north - south);

  // Prevent division by zero
  const aspectRatio = bboxWidthDeg > 0 
    ? bboxHeightDeg / bboxWidthDeg 
    : 1; // Default to square-ish

  const orientation = orientationFromRatio(aspectRatio);

  return {
    orientation,
    bboxWidthDeg,
    bboxHeightDeg,
    aspectRatio,
  };
}

/**
 * Check if geometry is valid (has coordinates).
 */
export function hasValidGeometry(geometry: DiagramGeometry | undefined): boolean {
  if (!geometry) return false;

  if (geometry.type === "bbox" && geometry.bbox) {
    const [west, south, east, north] = geometry.bbox;
    return west !== east || south !== north; // Not a point
  }

  if (geometry.type === "polygon" && geometry.polygon) {
    const ring = geometry.polygon[0];
    return ring && ring.length >= 3;
  }

  return false;
}

