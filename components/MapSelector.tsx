"use client";

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
  const geocoderRef = useRef<MapboxGeocoder | null>(null);
  const locationLabelRef = useRef<string>("");
  const clickMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const previewPolygonRef = useRef<string | null>(null);
  const drawTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [locationLabel, setLocationLabel] = useState<string>("");
  const [isDrawing, setIsDrawing] = useState(false);
  const [workZoneMode, setWorkZoneMode] = useState<WorkZoneMode>("roadSegment");
  const [clickPoints, setClickPoints] = useState<[number, number][]>([]);
  const [drawingVertexCount, setDrawingVertexCount] = useState(0);
  const [drawingError, setDrawingError] = useState<string | null>(null);

  // DEV-ONLY: Debug state for polygon drawing diagnostics
  const [debugDrawMode, setDebugDrawMode] = useState<string>("simple_select");
  const [debugLastEvent, setDebugLastEvent] = useState<string>("none");
  const [debugInteractionsDisabled, setDebugInteractionsDisabled] = useState(false);
  const [debugReadyStatus, setDebugReadyStatus] = useState<string>("initializing");

  // Map/Draw readiness tracking to prevent race conditions after hard refresh
  const [isMapDrawReady, setIsMapDrawReady] = useState(false);
  const pendingStartDrawRef = useRef(false);
  const executeStartDrawingRef = useRef<(() => void) | null>(null);

  const IS_DEV = process.env.NODE_ENV !== "production";

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    locationLabelRef.current = locationLabel;
  }, [locationLabel]);

  /**
   * Disable map interactions during polygon drawing.
   * This prevents clicks from panning/zooming instead of placing vertices.
   * Map interactions interfere with MapboxDraw's draw_polygon mode.
   */
  const disableMapInteractions = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    
    console.log("[DRAW] Disabling map interactions to prevent click interference");
    map.dragPan.disable();
    map.dragRotate.disable();
    map.doubleClickZoom.disable();
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disable();
    
    setDebugInteractionsDisabled(true);
  }, []);

  /**
   * Re-enable map interactions after drawing completes or is cancelled.
   */
  const enableMapInteractions = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    
    console.log("[DRAW] Re-enabling map interactions");
    map.dragPan.enable();
    map.dragRotate.enable();
    map.doubleClickZoom.enable();
    map.scrollZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
    map.touchZoomRotate.enable();
    
    setDebugInteractionsDisabled(false);
  }, []);

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

    /**
     * READINESS GATING: Wait for map to be fully loaded before allowing draw operations.
     * This prevents race conditions after hard refresh where Force Draw Mode is clicked
     * before map/draw controls are initialized.
     */
    const checkAndSetReady = () => {
      const mapLoaded = map.isStyleLoaded();
      const drawExists = drawRef.current !== null;
      const drawCallable = drawExists && typeof drawRef.current?.getMode === "function";
      let drawMode = "unknown";
      
      try {
        if (drawCallable && drawRef.current) {
          drawMode = drawRef.current.getMode();
        }
      } catch {
        drawMode = "error";
      }
      
      console.log(`[DRAW_READY] mapLoaded=${mapLoaded}, drawExists=${drawExists}, drawCallable=${drawCallable}, drawMode=${drawMode}`);
      
      const isReady = mapLoaded && drawExists && drawCallable && drawMode !== "error";
      
      if (isReady) {
        setIsMapDrawReady(true);
        setDebugReadyStatus("ready");
        setDebugDrawMode(drawMode);
        
        // If there was a pending draw request, execute it now via ref
        if (pendingStartDrawRef.current) {
          console.log("[DRAW_READY] Executing pending start draw request");
          pendingStartDrawRef.current = false;
          // Small delay to ensure everything is settled, then call via ref
          setTimeout(() => {
            if (executeStartDrawingRef.current) {
              executeStartDrawingRef.current();
            } else {
              console.error("[DRAW_READY] executeStartDrawingRef.current is null");
            }
          }, 50);
        }
      }
      
      return isReady;
    };

    // Check on map load event
    map.on("load", () => {
      console.log("[DRAW_READY] map.on('load') fired");
      checkAndSetReady();
    });

    // Also check on style.load in case map.load already fired
    map.on("style.load", () => {
      console.log("[DRAW_READY] map.on('style.load') fired");
      checkAndSetReady();
    });

    // Fallback: check after a short delay in case events already fired
    // Always check - the function handles the case where we're already ready
    setTimeout(() => {
      console.log("[DRAW_READY] Fallback timeout check");
      checkAndSetReady();
    }, 500);

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

    geocoderRef.current = geocoder;
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

    // Comprehensive draw event logging and handling
    // These listeners are registered ONCE during map initialization
    
    map.on("draw.modechange", (e: { mode: string }) => {
      console.log(`[DRAW] draw.modechange mode=${e.mode}`);
      setDebugDrawMode(e.mode);
      setDebugLastEvent("modechange");
      
      if (e.mode === "draw_polygon") {
        setDrawingVertexCount(0);
        setDrawingError(null);
        
        // Start timeout to detect failed clicks
        if (drawTimeoutRef.current) clearTimeout(drawTimeoutRef.current);
        drawTimeoutRef.current = setTimeout(() => {
          const features = draw.getAll();
          const feature = features.features[0] as { geometry?: { coordinates?: number[][][] } } | undefined;
          const currentVertexCount = feature?.geometry?.coordinates?.[0]?.length || 0;
          
          if (currentVertexCount === 0) {
            console.warn("[DRAW] No vertices placed after 5 seconds - clicks may not be registering");
            setDrawingError("Clicks aren't registering. Try clicking again or zoom in.");
          }
        }, 5000);
      }
    });

    map.on("draw.selectionchange", (e: { features: { id?: string }[] }) => {
      console.log(`[DRAW] draw.selectionchange featureIds=[${e.features.map((f) => f.id).join(", ")}]`);
      setDebugLastEvent("selectionchange");
    });

    /**
     * draw.render fires on every MapboxDraw render cycle.
     * This is the ONLY reliable way to track vertex count during active polygon drawing,
     * because draw.update only fires when features are modified AFTER creation.
     * 
     * During draw_polygon mode, we query the current draw state to count vertices.
     */
    map.on("draw.render", () => {
      const mode = draw.getMode();
      if (mode === "draw_polygon") {
        const features = draw.getAll();
        if (features.features.length > 0) {
          const feature = features.features[0] as { geometry?: { type: string; coordinates?: number[][] | number[][][] } };
          
          // During drawing, the geometry might be a LineString (before closing) or Polygon
          let vertexCount = 0;
          if (feature.geometry?.type === "Polygon" && feature.geometry.coordinates) {
            // Polygon: coordinates[0] is the outer ring
            const ring = feature.geometry.coordinates[0] as number[][];
            // Exclude the closing point if it matches the first point
            vertexCount = ring.length;
            if (vertexCount > 1) {
              const first = ring[0];
              const last = ring[vertexCount - 1];
              if (first && last && first[0] === last[0] && first[1] === last[1]) {
                vertexCount -= 1; // Don't count the duplicate closing point
              }
            }
          } else if (feature.geometry?.type === "LineString" && feature.geometry.coordinates) {
            // LineString during active drawing
            vertexCount = (feature.geometry.coordinates as number[][]).length;
          }
          
          setDrawingVertexCount(vertexCount);
          
          // Clear 5-second timeout once we have vertices
          if (vertexCount > 0 && drawTimeoutRef.current) {
            clearTimeout(drawTimeoutRef.current);
            drawTimeoutRef.current = null;
            setDrawingError(null);
          }
        }
      }
    });

    map.on("draw.update", (e: { features: unknown[] }) => {
      const feature = e.features[0] as { geometry?: { coordinates?: number[][][] } };
      const points = feature?.geometry?.coordinates?.[0]?.length || 0;
      console.log(`[DRAW] draw.update points=${points}`);
      // Vertex count is now tracked by draw.render, but we still log for debugging
      setDrawingError(null);
      setDebugLastEvent("update");
      processGeometry();
    });

    map.on("draw.create", (e: { features: unknown[] }) => {
      const feature = e.features[0] as { id?: string; geometry?: { coordinates?: number[][][] } };
      const points = feature?.geometry?.coordinates?.[0]?.length || 0;
      console.log(`[DRAW] draw.create id=${feature.id} points=${points}`);
      setDebugLastEvent("create");
      
      // Clear timeout
      if (drawTimeoutRef.current) {
        clearTimeout(drawTimeoutRef.current);
        drawTimeoutRef.current = null;
      }
      
      // Validate minimum points
      if (points < 4) { // 3 unique points + 1 closing point
        console.warn(`[DRAW] Polygon has insufficient points: ${points}`);
        setDrawingError("Need at least 3 points to create a polygon.");
        draw.deleteAll();
        return;
      }
      
      setIsDrawing(false);
      setDrawingVertexCount(0);
      setDrawingError(null);
      enableMapInteractions();
      processGeometry();
    });

    map.on("draw.delete", (e: { features: unknown[] }) => {
      console.log(`[DRAW] draw.delete count=${e.features.length}`);
      setDebugLastEvent("delete");
      processGeometry();
    });

    return () => {
      if (drawTimeoutRef.current) {
        clearTimeout(drawTimeoutRef.current);
      }
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      geocoderRef.current = null;
    };
  }, [mapToken, processGeometry, enableMapInteractions]);

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

  /**
   * EXECUTE START DRAWING - The actual implementation that enters draw mode.
   * This should only be called when map and draw are confirmed ready.
   * Separated from handleStartDrawing to enable queuing when not ready.
   */
  const executeStartDrawing = useCallback(() => {
    console.log("[START_DRAW] Executing start drawing sequence");
    
    const map = mapRef.current;
    const draw = drawRef.current;
    
    if (!map) {
      console.error("[START_DRAW] mapRef.current is null");
      setDrawingError("Map not initialized. Please refresh the page.");
      return;
    }
    
    if (!draw) {
      console.error("[START_DRAW] drawRef.current is null");
      setDrawingError("Draw control not initialized. Please refresh the page.");
      return;
    }
    
    // Clear any existing geometry
    try {
      draw.deleteAll();
    } catch (err) {
      console.warn("[START_DRAW] draw.deleteAll() failed:", err);
    }
    
    clearClickMarkers();
    clearPreviewPolygon();
    setClickPoints([]);
    setDrawingVertexCount(0);
    setDrawingError(null);
    
    // Dismiss geocoder overlay to prevent it from blocking map clicks
    if (geocoderRef.current) {
      geocoderRef.current.clear();
      const geocoderContainer = document.querySelector(".mapboxgl-ctrl-geocoder");
      if (geocoderContainer) {
        const input = geocoderContainer.querySelector("input");
        if (input) {
          (input as HTMLInputElement).blur();
        }
      }
    }
    
    // Step 1: Disable map interactions FIRST
    console.log("[START_DRAW] Step 1: disableInteractions");
    disableMapInteractions();
    
    // Step 2: Change draw mode to draw_polygon
    console.log("[START_DRAW] Step 2: changeMode('draw_polygon')");
    try {
      draw.changeMode("draw_polygon");
    } catch (err) {
      console.error("[START_DRAW] draw.changeMode('draw_polygon') failed:", err);
      setDrawingError("Failed to enter draw mode. Please try again.");
      enableMapInteractions();
      return;
    }
    
    // Step 3: Confirm the mode change by reading back
    setTimeout(() => {
      const confirmedMode = draw.getMode();
      console.log(`[START_DRAW] Step 3: confirmedMode=${confirmedMode}`);
      setDebugDrawMode(confirmedMode);
      setDebugLastEvent("start_draw");
      
      if (confirmedMode !== "draw_polygon") {
        console.error(`[START_DRAW] Mode change failed! Expected 'draw_polygon' but got '${confirmedMode}'`);
        setDrawingError(`Draw mode failed: got ${confirmedMode}`);
      }
    }, 50);
    
    setIsDrawing(true);
    onGeometryChange(null, locationLabelRef.current);
  }, [clearClickMarkers, clearPreviewPolygon, disableMapInteractions, enableMapInteractions, onGeometryChange]);

  // Keep ref in sync with executeStartDrawing for use in map load callback
  useEffect(() => {
    executeStartDrawingRef.current = executeStartDrawing;
  }, [executeStartDrawing]);

  /**
   * HANDLE START DRAWING - Entry point with readiness gating.
   * If map/draw not ready (race condition after hard refresh), queues the request.
   */
  const handleStartDrawing = useCallback(() => {
    console.log(`[FORCE_DRAW_CLICK] ready=${isMapDrawReady}, queued=${pendingStartDrawRef.current}`);
    
    // Always set workZoneMode to area for polygon drawing
    if (workZoneMode !== "area") {
      setWorkZoneMode("area");
    }
    
    if (!isMapDrawReady) {
      // Map not ready yet - queue the request
      console.log("[FORCE_DRAW_CLICK] Map not ready, queuing start draw request");
      pendingStartDrawRef.current = true;
      setDebugLastEvent("queued");
      setDrawingError("Initializing map... please wait.");
      return;
    }
    
    // Map is ready - execute immediately
    executeStartDrawing();
  }, [isMapDrawReady, workZoneMode, executeStartDrawing]);

  const handleClear = () => {
    console.log("[DRAW] clear requested");
    
    if (drawRef.current) {
      drawRef.current.deleteAll();
      drawRef.current.changeMode("simple_select");
    }
    clearClickMarkers();
    clearPreviewPolygon();
    setClickPoints([]);
    setIsDrawing(false);
    setDrawingVertexCount(0);
    setDrawingError(null);
    setDebugDrawMode("simple_select");
    setDebugLastEvent("clear");
    
    // Clear any pending timeout
    if (drawTimeoutRef.current) {
      clearTimeout(drawTimeoutRef.current);
      drawTimeoutRef.current = null;
    }
    
    if (mapRef.current) {
      mapRef.current.getCanvas().style.cursor = "";
    }
    
    // Re-enable map interactions when exiting draw mode
    enableMapInteractions();
    
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
      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          onClick={handleStartDrawing}
          disabled={isDrawing}
          className={`px-4 py-2 text-sm font-medium rounded-md border transition-colors ${
            isDrawing
              ? "bg-orange-500 text-white border-orange-600 cursor-not-allowed"
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
        
        {/*
          FINISH AREA BUTTON — The canonical, reliable way to complete polygon drawing.
          
          WHY THIS BUTTON EXISTS (instead of relying on double-click):
          - Double-click is unreliable across browsers and touch devices
          - Double-click can be intercepted by map zoom handlers
          - Users often don't discover double-click is needed
          - This button provides explicit, visible, reliable completion
          
          The button appears once >= 3 vertices are placed (minimum for valid polygon).
          Clicking it: validates the polygon, changes mode to simple_select, and triggers
          geometry processing.
        */}
        {isDrawing && workZoneMode === "area" && drawingVertexCount >= 3 && (
          <button
            type="button"
            onClick={() => {
              console.log("[DRAW] Finish Area button clicked");
              if (!drawRef.current) {
                console.error("[DRAW] drawRef is null, cannot finish");
                return;
              }
              
              // Get the current feature being drawn
              const features = drawRef.current.getAll();
              if (features.features.length === 0) {
                console.warn("[DRAW] No features found to finish");
                setDrawingError("No polygon to finish. Please draw at least 3 points.");
                return;
              }
              
              const feature = features.features[0] as { 
                geometry?: { type: string; coordinates?: number[][] | number[][][] } 
              };
              
              // Validate we have enough points
              let vertexCount = 0;
              if (feature.geometry?.type === "Polygon" && feature.geometry.coordinates) {
                vertexCount = (feature.geometry.coordinates[0] as number[][]).length;
                // Adjust for closing point
                if (vertexCount > 1) {
                  const ring = feature.geometry.coordinates[0] as number[][];
                  const first = ring[0];
                  const last = ring[vertexCount - 1];
                  if (first && last && first[0] === last[0] && first[1] === last[1]) {
                    vertexCount -= 1;
                  }
                }
              } else if (feature.geometry?.type === "LineString" && feature.geometry.coordinates) {
                vertexCount = (feature.geometry.coordinates as number[][]).length;
              }
              
              if (vertexCount < 3) {
                console.warn(`[DRAW] Insufficient vertices: ${vertexCount}`);
                setDrawingError("Need at least 3 points to create a polygon.");
                return;
              }
              
              console.log(`[DRAW] Finishing polygon with ${vertexCount} vertices`);
              
              // Clear timeout if still active
              if (drawTimeoutRef.current) {
                clearTimeout(drawTimeoutRef.current);
                drawTimeoutRef.current = null;
              }
              
              // Change mode to simple_select to finalize the polygon
              // This triggers draw.create if the polygon is valid
              drawRef.current.changeMode("simple_select");
              
              // Update state
              setDebugDrawMode("simple_select");
              setDebugLastEvent("finish_button");
              setIsDrawing(false);
              setDrawingVertexCount(0);
              setDrawingError(null);
              
              // Re-enable map interactions
              enableMapInteractions();
              
              // Process the completed geometry
              processGeometry();
            }}
            className="px-4 py-2 text-sm font-bold rounded-md border-2 border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-sm animate-pulse"
          >
            ✓ Finish Area
          </button>
        )}
        
        {/* Vertex count indicator */}
        {isDrawing && workZoneMode === "area" && drawingVertexCount > 0 && (
          <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200">
            {drawingVertexCount} point{drawingVertexCount !== 1 ? "s" : ""}
          </span>
        )}
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
          {workZoneMode === "area" && !drawingError && (
            <p>
              🔷 Click to add points. 
              {drawingVertexCount < 3 && <> Need at least 3 points.</>}
              {drawingVertexCount >= 3 && <strong> Click "Finish Area" to complete.</strong>}
            </p>
          )}
        </div>
      )}
      
      {/* Error message */}
      {drawingError && (
        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md border border-red-200 flex items-start gap-2">
          <span className="text-lg">⚠️</span>
          <p>{drawingError}</p>
        </div>
      )}

      {/* Map container with DEV overlay */}
      <div className="relative w-full h-[400px] rounded-lg border border-gray-300 overflow-hidden">
        <div
          ref={containerRef}
          className="w-full h-full"
        />
        
        {/* DEV-ONLY: Debug overlay for polygon drawing diagnostics */}
        {IS_DEV && (
          <div className="absolute top-2 left-2 bg-black/80 text-white text-[10px] font-mono p-2 rounded shadow-lg z-50 space-y-1 pointer-events-auto">
            <div className="font-bold text-emerald-400 mb-1 border-b border-emerald-400/30 pb-1">
              🔧 DRAW DEBUG (DEV)
            </div>
            
            <div className="space-y-0.5">
              <div>
                <span className="text-slate-400">drawMode:</span>{" "}
                <span className={debugDrawMode === "draw_polygon" ? "text-yellow-300 font-bold" : "text-white"}>
                  {debugDrawMode}
                </span>
              </div>
              
              <div>
                <span className="text-slate-400">isDrawing:</span>{" "}
                <span className={isDrawing ? "text-emerald-300 font-bold" : "text-slate-400"}>
                  {isDrawing ? "true" : "false"}
                </span>
              </div>
              
              <div>
                <span className="text-slate-400">pointsPlaced:</span>{" "}
                <span className="text-white">{drawingVertexCount}</span>
              </div>
              
              <div>
                <span className="text-slate-400">lastEvent:</span>{" "}
                <span className="text-cyan-300">{debugLastEvent}</span>
              </div>
              
              <div>
                <span className="text-slate-400">interactionsDisabled:</span>{" "}
                <span className={debugInteractionsDisabled ? "text-emerald-300 font-bold" : "text-red-300"}>
                  {debugInteractionsDisabled ? "true" : "false"}
                </span>
              </div>
              
              <div>
                <span className="text-slate-400">geocoderOpen:</span>{" "}
                <span className="text-slate-500">
                  {(() => {
                    const geocoderInput = document.querySelector(".mapboxgl-ctrl-geocoder input");
                    if (!geocoderInput) return "unknown";
                    const isFocused = document.activeElement === geocoderInput;
                    const hasValue = (geocoderInput as HTMLInputElement).value.length > 0;
                    const isOpen = isFocused || hasValue;
                    return isOpen ? "true" : "false";
                  })()}
                </span>
              </div>
            </div>
            
            {/* Map/Draw Ready Status */}
            <div>
              <span className="text-slate-400">ready:</span>{" "}
              <span className={isMapDrawReady ? "text-emerald-300 font-bold" : "text-red-300"}>
                {isMapDrawReady ? "true" : "false"}
              </span>
              <span className="text-slate-500 text-[8px] ml-1">({debugReadyStatus})</span>
            </div>

            {/* Force Draw Mode button */}
            <button
              type="button"
              onClick={() => {
                console.log("[DRAW] force-start from debug overlay");
                handleStartDrawing();
              }}
              disabled={isDrawing}
              className={`w-full mt-2 px-2 py-1 font-bold text-[9px] rounded transition-colors ${
                isDrawing 
                  ? "bg-slate-500 text-slate-300 cursor-not-allowed"
                  : isMapDrawReady
                    ? "bg-yellow-500 hover:bg-yellow-600 text-black"
                    : "bg-orange-500 hover:bg-orange-600 text-white"
              }`}
            >
              {isDrawing 
                ? "Drawing..." 
                : isMapDrawReady 
                  ? "⚡ Force Draw Mode" 
                  : "⏳ Force Draw (queued)"
              }
            </button>
          </div>
        )}
      </div>

      {/* Location label */}
      {locationLabel && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">Location:</span> {locationLabel}
        </p>
      )}
    </div>
  );
}
