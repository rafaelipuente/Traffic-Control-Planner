"use client";

import { useRef, useEffect, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

/**
 * Future: Mockup device for placing TCP elements on the map
 * This is scaffolding for future "Mockup Mode" functionality
 */
export interface MockupDevice {
  id: string;
  type: "cone" | "sign" | "arrow_board" | "flagger" | "drum" | "barricade";
  lngLat: [number, number];
  rotation?: number; // degrees, 0 = north
  label?: string;
}

export interface WorkZoneSnapshotMapProps {
  /** Mapbox access token */
  mapToken: string;
  /** Polygon ring as array of [lng, lat] coordinates */
  polygonRing: number[][];
  /** Height of the map container */
  height?: number;
  /** Location label from geocoder (optional) */
  locationLabel?: string;
  /** Center point of the work zone */
  centroid: { lng: number; lat: number };
  /** Number of vertices in the polygon */
  vertexCount: number;
  /**
   * Future: Devices to overlay on the map for TCP mockup
   * Currently a placeholder - full implementation in future update
   */
  mockupDevices?: MockupDevice[];
  /**
   * Future: Callback when user clicks to add a device
   * Currently not implemented - scaffold for Mockup Mode
   */
  onDeviceAdd?: (lngLat: [number, number]) => void;
}

// Safety Amber theme colors
const AMBER_FILL = "#FFB300";
const AMBER_STROKE = "#D97706";
const AMBER_FILL_OPACITY = 0.15;
const AMBER_STROKE_WIDTH = 2;

/**
 * Compute bounding box from a polygon ring
 */
function computeBbox(ring: number[][]): [[number, number], [number, number]] {
  if (ring.length === 0) {
    return [[0, 0], [0, 0]];
  }
  
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  
  return [
    [Math.min(...lngs), Math.min(...lats)], // SW corner
    [Math.max(...lngs), Math.max(...lats)], // NE corner
  ];
}

/**
 * Convert polygon ring to GeoJSON Polygon feature
 */
function ringToGeoJSON(ring: number[][]): GeoJSON.Feature<GeoJSON.Polygon> {
  // Close the ring if not already closed
  let closedRing = ring;
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    closedRing = [...ring, ring[0]];
  }
  
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [closedRing],
    },
  };
}

/**
 * WorkZoneSnapshotMap - Embedded Mapbox mini-map showing the work zone polygon
 * 
 * This component provides a real map context with street labels and the work zone
 * polygon overlay. It's designed to be the foundation for future "Mockup Mode"
 * where users can place TCP devices on the map.
 */
export default function WorkZoneSnapshotMap({
  mapToken,
  polygonRing,
  height = 220,
  locationLabel,
  centroid,
  vertexCount,
  mockupDevices = [],
  onDeviceAdd,
}: WorkZoneSnapshotMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const centroidMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Compute bounding box for viewport fitting
  const bbox = useMemo(() => computeBbox(polygonRing), [polygonRing]);

  // Convert ring to GeoJSON
  const polygonGeoJSON = useMemo(() => ringToGeoJSON(polygonRing), [polygonRing]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = mapToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      // Streets-forward style with clear labels
      style: "mapbox://styles/mapbox/streets-v12",
      center: [centroid.lng, centroid.lat],
      zoom: 15,
      interactive: false, // Non-interactive for now (read-only preview)
      attributionControl: false,
      logoPosition: "bottom-right",
    });

    mapRef.current = map;

    // Add scale control
    map.addControl(
      new mapboxgl.ScaleControl({
        maxWidth: 80,
        unit: "imperial",
      }),
      "bottom-left"
    );

    // Add navigation control (compass only, no zoom buttons)
    map.addControl(
      new mapboxgl.NavigationControl({
        showCompass: true,
        showZoom: false,
        visualizePitch: false,
      }),
      "top-right"
    );

    map.on("load", () => {
      // Add polygon source
      map.addSource("work-zone", {
        type: "geojson",
        data: polygonGeoJSON,
      });

      // Add fill layer (amber with low opacity)
      map.addLayer({
        id: "work-zone-fill",
        type: "fill",
        source: "work-zone",
        paint: {
          "fill-color": AMBER_FILL,
          "fill-opacity": AMBER_FILL_OPACITY,
        },
      });

      // Add halo/glow layer for better visibility
      map.addLayer({
        id: "work-zone-halo",
        type: "line",
        source: "work-zone",
        paint: {
          "line-color": "#1f2937", // Dark halo for contrast
          "line-width": 4,
          "line-blur": 2,
          "line-opacity": 0.3,
        },
      });

      // Add outline layer (amber stroke)
      map.addLayer({
        id: "work-zone-outline",
        type: "line",
        source: "work-zone",
        paint: {
          "line-color": AMBER_STROKE,
          "line-width": AMBER_STROKE_WIDTH,
        },
      });

      // Fit bounds to polygon with padding
      map.fitBounds(bbox, {
        padding: 40,
        duration: 0, // Instant fit
        maxZoom: 18,
      });

      // Add centroid marker
      const markerEl = document.createElement("div");
      markerEl.className = "work-zone-centroid-marker";
      markerEl.innerHTML = `
        <div style="
          width: 12px;
          height: 12px;
          background: ${AMBER_FILL};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        "></div>
      `;

      const marker = new mapboxgl.Marker({
        element: markerEl,
        anchor: "center",
      })
        .setLngLat([centroid.lng, centroid.lat])
        .addTo(map);

      centroidMarkerRef.current = marker;
    });

    return () => {
      if (centroidMarkerRef.current) {
        centroidMarkerRef.current.remove();
        centroidMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [mapToken]); // Only re-create map if token changes

  // Update polygon when it changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const source = map.getSource("work-zone") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(polygonGeoJSON);
      
      // Refit bounds
      map.fitBounds(bbox, {
        padding: 40,
        duration: 300,
        maxZoom: 18,
      });
    }

    // Update centroid marker
    if (centroidMarkerRef.current) {
      centroidMarkerRef.current.setLngLat([centroid.lng, centroid.lat]);
    }
  }, [polygonGeoJSON, bbox, centroid]);

  // TODO: Future Mockup Mode - Add device markers
  // This is scaffolding for future implementation
  useEffect(() => {
    if (!mapRef.current || mockupDevices.length === 0) return;
    
    // Future: Add device markers to the map
    // mockupDevices.forEach(device => {
    //   const el = document.createElement("div");
    //   el.className = `mockup-device mockup-device-${device.type}`;
    //   // Add marker with drag support
    // });
  }, [mockupDevices]);

  // TODO: Future Mockup Mode - Handle click to add device
  // This is scaffolding for future implementation
  useEffect(() => {
    if (!mapRef.current || !onDeviceAdd) return;
    
    // Future: Enable clicking to add devices
    // map.on("click", (e) => {
    //   onDeviceAdd([e.lngLat.lng, e.lngLat.lat]);
    // });
  }, [onDeviceAdd]);

  return (
    <div className="relative">
      {/* Map Container */}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full rounded-sm overflow-hidden"
        aria-label={`Work zone map preview${locationLabel ? ` near ${locationLabel}` : ""}`}
        role="img"
      />

      {/* Location Overlay */}
      {locationLabel && (
        <div className="absolute bottom-8 left-2 right-2 bg-white/95 backdrop-blur-sm rounded-sm px-2 py-1 text-xs text-slate-700 truncate border border-slate-200 shadow-sm z-10">
          <span className="text-slate-400 mr-1">📍</span>
          {locationLabel}
        </div>
      )}

      {/* Metadata Footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-sm px-3 py-1.5 flex items-center justify-between text-[10px] z-10">
        <div className="flex items-center gap-3 text-slate-300">
          <span>
            <span className="font-bold text-white">{vertexCount}</span> vertices
          </span>
          <span className="text-slate-500">|</span>
          <span className="font-mono text-slate-400">
            {centroid.lat.toFixed(5)}, {centroid.lng.toFixed(5)}
          </span>
        </div>
        <span className="text-emerald-400 font-bold uppercase tracking-wider">
          ✓ Captured
        </span>
      </div>

      {/* Future: Mockup Mode Toggle (hidden for now) */}
      {/* 
      <div className="absolute top-2 left-2 z-10">
        <button className="px-2 py-1 bg-white/90 rounded-sm text-xs font-medium border border-slate-200 shadow-sm">
          + Add Device
        </button>
      </div>
      */}
    </div>
  );
}

