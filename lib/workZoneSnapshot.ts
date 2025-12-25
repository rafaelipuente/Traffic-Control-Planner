/**
 * Work Zone Snapshot Utilities
 * 
 * Computes polygon metadata (bounds, centroid, vertex count) and generates
 * Mapbox Static Images API URLs for work zone visualization.
 */

export interface WorkZoneBounds {
  west: number;  // min longitude
  south: number; // min latitude
  east: number;  // max longitude
  north: number; // max latitude
}

export interface WorkZoneCentroid {
  lng: number;
  lat: number;
}

export interface WorkZoneMetadata {
  bounds: WorkZoneBounds;
  centroid: WorkZoneCentroid;
  vertexCount: number;
}

/**
 * Compute bounds from a polygon ring (array of [lng, lat] coordinates)
 */
export function computeBounds(ring: number[][]): WorkZoneBounds {
  if (ring.length === 0) {
    return { west: 0, south: 0, east: 0, north: 0 };
  }

  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);

  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

/**
 * Compute bounds from a bbox [west, south, east, north]
 */
export function boundsFromBbox(bbox: [number, number, number, number]): WorkZoneBounds {
  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3],
  };
}

/**
 * Compute the centroid (geometric center) of a polygon ring
 */
export function computeCentroid(ring: number[][]): WorkZoneCentroid {
  if (ring.length === 0) {
    return { lng: 0, lat: 0 };
  }

  const sumLng = ring.reduce((sum, p) => sum + p[0], 0);
  const sumLat = ring.reduce((sum, p) => sum + p[1], 0);

  return {
    lng: sumLng / ring.length,
    lat: sumLat / ring.length,
  };
}

/**
 * Compute centroid from bounds (center of bounding box)
 */
export function centroidFromBounds(bounds: WorkZoneBounds): WorkZoneCentroid {
  return {
    lng: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  };
}

/**
 * Calculate appropriate zoom level to fit bounds in a given image size
 */
function calculateZoom(bounds: WorkZoneBounds, width: number, height: number): number {
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;

  // Approximate zoom calculation based on span
  // Mapbox uses Web Mercator projection, these are rough approximations
  const WORLD_SIZE = 512; // Mapbox tile size at zoom 0
  
  // Calculate zoom needed to fit width and height
  const zoomX = Math.log2((WORLD_SIZE * width) / (lngSpan * 256 * 360)) - 1;
  const zoomY = Math.log2((WORLD_SIZE * height) / (latSpan * 256 * 180)) - 1;
  
  // Use the smaller zoom to ensure both dimensions fit, with some padding
  const zoom = Math.min(zoomX, zoomY) - 0.5;
  
  // Clamp to reasonable range
  return Math.max(10, Math.min(18, Math.floor(zoom)));
}

/**
 * Build a Mapbox Static Images API URL with polygon overlay
 * 
 * @param mapToken - Mapbox access token
 * @param ring - Polygon ring as array of [lng, lat] coordinates
 * @param bounds - Pre-computed bounds
 * @param centroid - Pre-computed centroid
 * @param options - Image options (width, height)
 */
export function buildStaticMapUrl(
  mapToken: string,
  ring: number[][],
  bounds: WorkZoneBounds,
  centroid: WorkZoneCentroid,
  options: { width?: number; height?: number } = {}
): string {
  const { width = 400, height = 250 } = options;

  // Safety Amber theme colors (with URL encoding)
  const strokeColor = "FFB300"; // Amber stroke
  const fillColor = "FFB30040"; // Amber fill with 25% opacity
  const strokeWidth = 3;

  // Build GeoJSON path overlay
  // Format: path-{strokeWidth}+{strokeColor}-{fillOpacity}+{fillColor}(coordinates)
  // Coordinates are encoded as lng,lat pairs separated by commas
  
  // Close the polygon by adding the first point at the end
  const closedRing = [...ring, ring[0]];
  const coordString = closedRing.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(",");
  
  // Build path overlay with polyline encoding
  const pathOverlay = `path-${strokeWidth}+${strokeColor}-0.25+${fillColor}(${encodeURIComponent(coordString)})`;

  // Calculate zoom to fit bounds
  const zoom = calculateZoom(bounds, width, height);

  // Mapbox Static Images API URL
  // Format: /styles/v1/{username}/{style_id}/static/{overlay}/{lon},{lat},{zoom},{bearing},{pitch}/{width}x{height}
  const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pathOverlay}/${centroid.lng.toFixed(5)},${centroid.lat.toFixed(5)},${zoom},0/${width}x${height}@2x?access_token=${mapToken}`;

  return url;
}

/**
 * Build a simpler static map URL using auto-fit bounds (recommended)
 * This uses Mapbox's auto-fit feature which is more reliable
 */
export function buildAutoFitStaticMapUrl(
  mapToken: string,
  ring: number[][],
  options: { width?: number; height?: number } = {}
): string {
  const { width = 400, height = 250 } = options;

  // Safety Amber theme colors
  const strokeColor = "FFB300"; // Amber stroke
  const fillColor = "FFB300"; // Amber fill (opacity handled separately)
  const strokeWidth = 3;
  const fillOpacity = 0.25;

  // Close the polygon by adding the first point at the end if not already closed
  let closedRing = ring;
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    closedRing = [...ring, ring[0]];
  }
  
  // Build coordinate string
  const coordString = closedRing.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(",");
  
  // Build path overlay
  const pathOverlay = `path-${strokeWidth}+${strokeColor}-${fillOpacity}+${fillColor}(${encodeURIComponent(coordString)})`;

  // Use "auto" for automatic bounds fitting with padding
  const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pathOverlay}/auto/${width}x${height}@2x?padding=40&access_token=${mapToken}`;

  return url;
}

/**
 * Compute all work zone metadata from geometry
 */
export function computeWorkZoneMetadata(
  geometry: { type: "bbox"; bbox: [number, number, number, number] } | { type: "polygon"; polygon: number[][][] } | null
): WorkZoneMetadata | null {
  if (!geometry) return null;

  if (geometry.type === "bbox") {
    const bounds = boundsFromBbox(geometry.bbox);
    const centroid = centroidFromBounds(bounds);
    return {
      bounds,
      centroid,
      vertexCount: 4, // Rectangle
    };
  }

  // Polygon type
  const ring = geometry.polygon[0]; // First (outer) ring
  if (!ring || ring.length < 3) return null;

  const bounds = computeBounds(ring);
  const centroid = computeCentroid(ring);

  return {
    bounds,
    centroid,
    vertexCount: ring.length,
  };
}

/**
 * Get the polygon ring from geometry (for building static map URL)
 */
export function getPolygonRing(
  geometry: { type: "bbox"; bbox: [number, number, number, number] } | { type: "polygon"; polygon: number[][][] } | null
): number[][] | null {
  if (!geometry) return null;

  if (geometry.type === "bbox") {
    // Convert bbox to polygon ring [SW, SE, NE, NW]
    const [west, south, east, north] = geometry.bbox;
    return [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ];
  }

  return geometry.polygon[0] || null;
}

