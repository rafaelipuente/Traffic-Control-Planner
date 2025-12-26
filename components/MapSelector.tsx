"use client";

/**
 * MapSelector Component - Work Zone Drawing
 * 
 * REVERTED TO LAST KNOWN WORKING VERSION (commit ec2c024)
 * Removed complexity that broke core drawing:
 * - DEV debug overlay
 * - Force Draw Mode button
 * - Finish Area button
 * - Readiness gating / queued execution
 * - Extra debug states
 * 
 * TEST CHECKLIST (manual verification):
 * [ ] Load planner page
 * [ ] Select "Area (Advanced)" mode
 * [ ] Click "Define Work Zone" button
 * [ ] Click 4 points on the map
 * [ ] Double-click to finish the polygon
 * [ ] Verify: Polygon appears with amber fill
 * [ ] Verify: "Selected Area / Work Zone: N points" shows
 * [ ] Verify: Preview/generation triggers reliably
 * [ ] Clear and repeat - should work consistently
 */

import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";

import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";

export type GeometryOutput =
  | { type: "bbox"; bbox: [number, number, number, number] }
  | { type: "polygon"; polygon: number[][][] };

export type WorkZoneMode = "roadSegment" | "intersection" | "area";

export interface MapSelectorProps {
  mapToken: string;
  onGeometryChange: (
    geometry: GeometryOutput | null,
    locationLabel: string
  ) => void;
}

// Constants for corridor generation
const DEFAULT_CORRIDOR_WIDTH_M = 12; // 12 meters (~40 ft) road corridor width
const INTERSECTION_BUFFER_M = 25; // 25 meters intersection buffer
const METERS_PER_DEGREE_LAT = 111320;

/**
 * Normalize any drawn shape to a single polygon ring (unclosed, [lng, lat]).
 */
function normalizeRing(coords: number[][]): number[][] {
  if (coords.length === 0) return [];

  // Remove closing point if it matches the first point
  const last = coords[coords.length - 1];
  const first = coords[0];
  if (last[0] === first[0] && last[1] === first[1]) {
    return coords.slice(0, -1);
  }
  return coords;
}

/**
 * Check if the polygon is axis-aligned (within tolerance), making it suitable for bbox output.
 */
function isAxisAligned(ring: number[][], tolerance = 0.0001): boolean {
  if (ring.length !== 4) return false;

  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  
  const uniqueLngs = new Set(lngs.map(lng => Math.round(lng / tolerance) * tolerance));
  const uniqueLats = new Set(lats.map(lat => Math.round(lat / tolerance) * tolerance));

  return uniqueLngs.size === 2 && uniqueLats.size === 2;
}

/**
 * Derive bbox [west, south, east, north] from a ring.
 */
function deriveBbox(ring: number[][]): [number, number, number, number] {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * Calculate distance in meters between two points
 */
function haversineDistance(p1: [number, number], p2: [number, number]): number {
  const R = 6371000; // Earth's radius in meters
  const lat1 = p1[1] * Math.PI / 180;
  const lat2 = p2[1] * Math.PI / 180;
  const deltaLat = (p2[1] - p1[1]) * Math.PI / 180;
  const deltaLng = (p2[0] - p1[0]) * Math.PI / 180;
  
  const a = Math.sin(deltaLat / 2) ** 2 + 
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

/**
 * Generate a corridor polygon from two points (road segment mode)
 */
function generateCorridorPolygon(
  point1: [number, number],
  point2: [number, number],
  widthMeters: number = DEFAULT_CORRIDOR_WIDTH_M
): number[][] {
  const halfWidthDeg = widthMeters / 2 / METERS_PER_DEGREE_LAT;
  
  // Calculate bearing from point1 to point2
  const dLng = point2[0] - point1[0];
  const dLat = point2[1] - point1[1];
  const bearing = Math.atan2(dLng, dLat);
  
  // Perpendicular bearing (90 degrees offset)
  const perpBearing = bearing + Math.PI / 2;
  
  // Calculate offset for width
  const offsetLng = Math.sin(perpBearing) * halfWidthDeg;
  const offsetLat = Math.cos(perpBearing) * halfWidthDeg;
  
  // Create corridor rectangle (4 corners)
  const polygon: number[][] = [
    [point1[0] - offsetLng, point1[1] - offsetLat], // Start left
    [point1[0] + offsetLng, point1[1] + offsetLat], // Start right
    [point2[0] + offsetLng, point2[1] + offsetLat], // End right
    [point2[0] - offsetLng, point2[1] - offsetLat], // End left
  ];
  
  return polygon;
}

/**
 * Generate an intersection buffer polygon from a single point
 */
function generateIntersectionPolygon(
  center: [number, number],
  bufferMeters: number = INTERSECTION_BUFFER_M
): number[][] {
  const bufferDegLat = bufferMeters / METERS_PER_DEGREE_LAT;
  const bufferDegLng = bufferMeters / (METERS_PER_DEGREE_LAT * Math.cos(center[1] * Math.PI / 180));
  
  // Create octagon for better intersection representation
  const polygon: number[][] = [];
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * 2 * Math.PI;
    polygon.push([
      center[0] + bufferDegLng * Math.cos(angle),
      center[1] + bufferDegLat * Math.sin(angle),
    ]);
  }
  
  return polygon;
}

// Road layers to query for snapping
const ROAD_LAYERS = [
  "road-primary",
  "road-secondary", 
  "road-tertiary",
  "road-street",
  "road-minor",
  "road-service",
];

export default function MapSelector({ mapToken, onGeometryChange }: MapSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const locationLabelRef = useRef<string>("");
  const clickMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const previewPolygonRef = useRef<string | null>(null);

  const [locationLabel, setLocationLabel] = useState<string>("");
  const [isDrawing, setIsDrawing] = useState(false);
  const [workZoneMode, setWorkZoneMode] = useState<WorkZoneMode>("roadSegment");
  const [clickPoints, setClickPoints] = useState<[number, number][]>([]);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    locationLabelRef.current = locationLabel;
  }, [locationLabel]);

  const clearClickMarkers = useCallback(() => {
    clickMarkersRef.current.forEach(m => m.remove());
    clickMarkersRef.current = [];
  }, []);

  const clearPreviewPolygon = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    
    if (previewPolygonRef.current) {
      if (map.getLayer("preview-polygon-fill")) {
        map.removeLayer("preview-polygon-fill");
      }
      if (map.getLayer("preview-polygon-outline")) {
        map.removeLayer("preview-polygon-outline");
      }
      if (map.getSource("preview-polygon")) {
        map.removeSource("preview-polygon");
      }
      previewPolygonRef.current = null;
    }
  }, []);

  const showPreviewPolygon = useCallback((ring: number[][]) => {
    const map = mapRef.current;
    if (!map) return;
    
    clearPreviewPolygon();
    
    const closedRing = [...ring, ring[0]];
    
    map.addSource("preview-polygon", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [closedRing],
        },
      },
    });
    
    map.addLayer({
      id: "preview-polygon-fill",
      type: "fill",
      source: "preview-polygon",
      paint: {
        "fill-color": "#FFB300",
        "fill-opacity": 0.15,
      },
    });
    
    map.addLayer({
      id: "preview-polygon-outline",
      type: "line",
      source: "preview-polygon",
      paint: {
        "line-color": "#FFB300",
        "line-width": 2,
        "line-dasharray": [2, 2],
      },
    });
    
    previewPolygonRef.current = "preview-polygon";
  }, [clearPreviewPolygon]);

  const processGeometry = useCallback(() => {
    if (!drawRef.current) return;

    const data = drawRef.current.getAll();
    const features = data.features;

    if (features.length === 0) {
      onGeometryChange(null, locationLabelRef.current);
      return;
    }

    // Take the last drawn feature
    const feature = features[features.length - 1];

    if (feature.geometry.type !== "Polygon") {
      onGeometryChange(null, locationLabelRef.current);
      return;
    }

    const rawRing = feature.geometry.coordinates[0] as number[][];
    const ring = normalizeRing(rawRing);

    if (ring.length < 3) {
      onGeometryChange(null, locationLabelRef.current);
      return;
    }

    // Determine if this is a rectangle (axis-aligned 4 vertices) for bbox output
    if (ring.length === 4 && isAxisAligned(ring)) {
      const bbox = deriveBbox(ring);
      onGeometryChange({ type: "bbox", bbox }, locationLabelRef.current);
    } else {
      // Polygon output: single unclosed ring
      onGeometryChange({ type: "polygon", polygon: [ring] }, locationLabelRef.current);
    }
  }, [onGeometryChange]);

  // Handle click for Road Segment or Intersection mode
  const handleMapClick = useCallback((e: mapboxgl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map || workZoneMode === "area") return;

    const clickedPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    
    // Try to snap to nearest road
    let snappedPoint = clickedPoint;
    try {
      const roadFeatures = map.queryRenderedFeatures(e.point, {
        layers: ROAD_LAYERS.filter(l => map.getLayer(l)),
      });
      
      if (roadFeatures.length > 0) {
        const roadGeom = roadFeatures[0].geometry;
        if (roadGeom.type === "LineString" || roadGeom.type === "MultiLineString") {
          // Find nearest point on road
          let coords: number[][] = [];
          if (roadGeom.type === "LineString") {
            coords = roadGeom.coordinates as number[][];
          } else {
            // MultiLineString - flatten
            coords = (roadGeom.coordinates as number[][][]).flat();
          }
          
          if (coords.length > 0) {
            let minDist = Infinity;
            let nearestPoint = clickedPoint;
            
            for (const coord of coords) {
              const dist = haversineDistance(clickedPoint, [coord[0], coord[1]]);
              if (dist < minDist) {
                minDist = dist;
                nearestPoint = [coord[0], coord[1]];
              }
            }
            
            // Only snap if within 50 meters
            if (minDist < 50) {
              snappedPoint = nearestPoint;
            }
          }
        }
      }
    } catch (err) {
      console.debug("Road snap failed:", err);
    }

    // Add marker at click point
    const marker = new mapboxgl.Marker({ color: "#FFB300" })
      .setLngLat(snappedPoint)
      .addTo(map);
    clickMarkersRef.current.push(marker);

    const newPoints = [...clickPoints, snappedPoint];
    setClickPoints(newPoints);

    if (workZoneMode === "intersection") {
      // Single click for intersection - generate polygon immediately
      const polygon = generateIntersectionPolygon(snappedPoint);
      showPreviewPolygon(polygon);
      
      // Finalize after a short delay to show preview
      setTimeout(() => {
        onGeometryChange({ type: "polygon", polygon: [polygon] }, locationLabelRef.current);
        clearClickMarkers();
        setClickPoints([]);
        setIsDrawing(false);
      }, 300);
    } else if (workZoneMode === "roadSegment" && newPoints.length === 2) {
      // Two clicks for road segment - generate corridor
      const polygon = generateCorridorPolygon(newPoints[0], newPoints[1]);
      showPreviewPolygon(polygon);
      
      // Finalize after a short delay to show preview
      setTimeout(() => {
        onGeometryChange({ type: "polygon", polygon: [polygon] }, locationLabelRef.current);
        clearClickMarkers();
        setClickPoints([]);
        setIsDrawing(false);
      }, 300);
    } else if (workZoneMode === "roadSegment" && newPoints.length === 1) {
      // First click - show instruction to click second point
      console.log("[MapSelector] First point captured, waiting for second point");
    }
  }, [workZoneMode, clickPoints, clearClickMarkers, showPreviewPolygon, onGeometryChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = mapToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-122.4194, 37.7749], // Default: San Francisco
      zoom: 12,
    });

    mapRef.current = map;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: "simple_select",
    });

    drawRef.current = draw;
    map.addControl(draw as unknown as mapboxgl.IControl, "top-right");

    const geocoder = new MapboxGeocoder({
      accessToken: mapToken,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mapboxgl: mapboxgl as any,
      marker: true,
      placeholder: "Search location...",
      flyTo: {
        speed: 1.5,
        curve: 1.42,
        easing: (t: number) => t,
      },
    });

    map.addControl(geocoder as unknown as mapboxgl.IControl, "top-left");

    // Handle geocoder result - fly to location
    geocoder.on("result", (e: { result: { place_name?: string; center?: [number, number]; bbox?: [number, number, number, number] } }) => {
      const placeName = e.result?.place_name || "";
      setLocationLabel(placeName);
      
      // Fly to the result location
      if (e.result?.bbox) {
        map.fitBounds(e.result.bbox as [number, number, number, number], {
          padding: 50,
          duration: 1500,
        });
      } else if (e.result?.center) {
        map.flyTo({
          center: e.result.center,
          zoom: 15,
          duration: 1500,
        });
      }
    });

    map.on("draw.create", () => {
      setIsDrawing(false);
      processGeometry();
    });
    map.on("draw.update", processGeometry);
    map.on("draw.delete", processGeometry);

    return () => {
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, [mapToken, processGeometry]);

  // Attach/detach click handler based on mode and drawing state
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (isDrawing && workZoneMode !== "area") {
      map.on("click", handleMapClick);
      map.getCanvas().style.cursor = "crosshair";
    } else {
      map.off("click", handleMapClick);
      if (!isDrawing) {
        map.getCanvas().style.cursor = "";
      }
    }

    return () => {
      map.off("click", handleMapClick);
    };
  }, [isDrawing, workZoneMode, handleMapClick]);

  const handleStartDrawing = () => {
    if (!mapRef.current) return;
    
    // Clear any existing geometry
    if (drawRef.current) {
      drawRef.current.deleteAll();
    }
    clearClickMarkers();
    clearPreviewPolygon();
    setClickPoints([]);
    
    if (workZoneMode === "area") {
      // Use MapboxDraw for polygon mode
      if (drawRef.current) {
        drawRef.current.changeMode("draw_polygon");
      }
    }
    // For roadSegment and intersection, we handle clicks manually
    
    setIsDrawing(true);
    onGeometryChange(null, locationLabelRef.current);
  };

  const handleClear = () => {
    if (drawRef.current) {
      drawRef.current.deleteAll();
    }
    clearClickMarkers();
    clearPreviewPolygon();
    setClickPoints([]);
    setIsDrawing(false);
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = "";
    }
    onGeometryChange(null, locationLabelRef.current);
  };

  // Mode descriptions
  const modeInfo = {
    roadSegment: {
      label: "Road Segment",
      icon: "🛣️",
      description: "Click 2 points along a road",
    },
    intersection: {
      label: "Intersection",
      icon: "✚",
      description: "Click at an intersection",
    },
    area: {
      label: "Area (Advanced)",
      icon: "🔷",
      description: "Draw a custom polygon",
    },
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Mode Selector */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
          Work Zone Type
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(modeInfo) as WorkZoneMode[]).map((mode) => {
            const info = modeInfo[mode];
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setWorkZoneMode(mode);
                  // Clear if switching modes
                  if (isDrawing) {
                    handleClear();
                  }
                }}
                className={`flex flex-col items-center p-2 rounded-sm border transition-all text-center ${
                  workZoneMode === mode
                    ? "bg-[#FFB300]/10 border-[#FFB300] shadow-sm"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <span className="text-lg">{info.icon}</span>
                <span className={`text-[10px] font-bold uppercase mt-1 ${
                  workZoneMode === mode ? "text-slate-900" : "text-slate-500"
                }`}>
                  {info.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Draw controls */}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleStartDrawing}
          className={`px-4 py-2 text-sm font-medium rounded-md border transition-colors ${
            isDrawing
              ? "bg-orange-500 text-white border-orange-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          {isDrawing ? "Drawing..." : "Define Work Zone"}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="px-4 py-2 text-sm font-medium rounded-md border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Instructions */}
      {isDrawing && (
        <div className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-md">
          {workZoneMode === "roadSegment" && clickPoints.length === 0 && (
            <p>🛣️ <strong>Click the start point</strong> of your road segment work zone</p>
          )}
          {workZoneMode === "roadSegment" && clickPoints.length === 1 && (
            <p>🛣️ <strong>Click the end point</strong> of your road segment work zone</p>
          )}
          {workZoneMode === "intersection" && (
            <p>✚ <strong>Click at the intersection</strong> center to define the work zone</p>
          )}
          {workZoneMode === "area" && (
            <p>🔷 Click to add points. <strong>Double-click to finish</strong></p>
          )}
        </div>
      )}

      {/* Map container */}
      <div
        ref={containerRef}
        className="w-full h-[400px] rounded-lg border border-gray-300 overflow-hidden"
      />

      {/* Location label */}
      {locationLabel && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">Location:</span> {locationLabel}
        </p>
      )}
    </div>
  );
}
