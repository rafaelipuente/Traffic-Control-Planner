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

export interface MapSelectorProps {
  mapToken: string;
  onGeometryChange: (
    geometry: GeometryOutput | null,
    locationLabel: string
  ) => void;
}

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

export default function MapSelector({ mapToken, onGeometryChange }: MapSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const locationLabelRef = useRef<string>("");

  const [locationLabel, setLocationLabel] = useState<string>("");
  const [isDrawing, setIsDrawing] = useState(false);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    locationLabelRef.current = locationLabel;
  }, [locationLabel]);

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

  const handleDrawPolygon = () => {
    if (!drawRef.current || !mapRef.current) return;
    drawRef.current.deleteAll();
    drawRef.current.changeMode("draw_polygon");
    setIsDrawing(true);
    onGeometryChange(null, locationLabelRef.current);
  };

  const handleClear = () => {
    if (!drawRef.current || !mapRef.current) return;
    drawRef.current.deleteAll();
    setIsDrawing(false);
    mapRef.current.getCanvas().style.cursor = "";
    onGeometryChange(null, locationLabelRef.current);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Draw controls */}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleDrawPolygon}
          className={`px-4 py-2 text-sm font-medium rounded-md border transition-colors ${
            isDrawing
              ? "bg-orange-500 text-white border-orange-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Define Work Zone
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
        <p className="text-sm text-orange-600 bg-orange-50 px-3 py-2 rounded-md">
          Click on the map to define work zone boundaries. Double-click to finish.
        </p>
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
