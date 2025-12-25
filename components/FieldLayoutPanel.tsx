"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  FieldLayout,
  FieldDevice,
  DeviceType,
  DEVICE_ICONS,
  generateDeviceId,
  cloneLayout,
  RoadPolyline,
} from "@/lib/layoutTypes";
import { normalizeRoadFeatures } from "@/lib/layout/suggestFieldLayout";
import DiagramPreview from "./DiagramPreview";
import { DiagramGeometry, DiagramJobData, DiagramPlanData } from "@/lib/diagram/types";

// Road layers to query for centerlines
const ROAD_LAYERS = [
  "road-primary",
  "road-secondary",
  "road-tertiary",
  "road-street",
  "road-minor",
  "road-residential",
  "road-service",
  "road-path",
  // Fallback generic layers
  "road",
  "road-label",
];

// Safety Amber theme colors
const AMBER_FILL = "#FFB300";
const AMBER_STROKE = "#D97706";
const AMBER_FILL_OPACITY = 0.12;
const AMBER_STROKE_WIDTH = 2;

export type LayoutStatus = "empty" | "captured" | "editing" | "locked";

export interface FieldLayoutPanelProps {
  /** Mapbox access token */
  mapToken: string;
  /** Polygon ring as array of [lng, lat] coordinates */
  polygonRing: number[][] | null;
  /** Center point of the work zone */
  centroid: { lng: number; lat: number } | null;
  /** Current field layout */
  layout: FieldLayout | null;
  /** Callback when layout changes (user edits) */
  onLayoutChange: (layout: FieldLayout) => void;
  /** Whether layout is locked (confirmed) */
  isLocked: boolean;
  /** Callback to lock/unlock layout */
  onLockChange: (locked: boolean) => void;
  /** Location label from geocoder */
  locationLabel?: string;
  /** Height of the map */
  height?: number;
  /** Geometry for schematic tab */
  geometry?: DiagramGeometry | null;
  /** Job data for schematic tab */
  diagramJob?: DiagramJobData | null;
  /** Plan data for schematic tab (after generation) */
  diagramPlan?: DiagramPlanData | null;
  /** Callback when road features are extracted from map (for street-aware layout) */
  onRoadFeaturesExtracted?: (roads: RoadPolyline[]) => void;
  /** Whether we have a generated plan */
  hasGeneratedPlan?: boolean;
}

type ActiveTab = "mockup" | "schematic";
type EditTool = "select" | "addCone" | "addSign" | "delete";

/**
 * Compute bounding box from a polygon ring
 */
function computeBbox(ring: number[][]): [[number, number], [number, number]] {
  if (ring.length === 0) return [[0, 0], [0, 0]];
  const lngs = ring.map(p => p[0]);
  const lats = ring.map(p => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/**
 * Convert polygon ring to GeoJSON
 */
function ringToGeoJSON(ring: number[][]): GeoJSON.Feature<GeoJSON.Polygon> {
  let closedRing = ring;
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    closedRing = [...ring, ring[0]];
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [closedRing] },
  };
}

/**
 * FieldLayoutPanel - Map Mockup with editable device overlay
 */
export default function FieldLayoutPanel({
  mapToken,
  polygonRing,
  centroid,
  layout,
  onLayoutChange,
  isLocked,
  onLockChange,
  locationLabel,
  height = 350,
  geometry,
  diagramJob,
  diagramPlan,
  onRoadFeaturesExtracted,
  hasGeneratedPlan = false,
}: FieldLayoutPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("mockup");
  const [isEditMode, setIsEditMode] = useState(false);
  const [activeTool, setActiveTool] = useState<EditTool>("select");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // Compute bbox for viewport fitting
  const bbox = useMemo(() => {
    if (!polygonRing || polygonRing.length === 0) return null;
    return computeBbox(polygonRing);
  }, [polygonRing]);

  // Determine layout status
  const layoutStatus: LayoutStatus = useMemo(() => {
    if (!polygonRing) return "empty";
    if (isLocked) return "locked";
    if (isEditMode) return "editing";
    return "captured";
  }, [polygonRing, isLocked, isEditMode]);

  // Status badge styling
  const statusConfig = useMemo(() => {
    switch (layoutStatus) {
      case "empty":
        return { label: "Awaiting Work Zone", color: "bg-slate-100 text-slate-500" };
      case "captured":
        return { label: "Captured", color: "bg-emerald-100 text-emerald-700" };
      case "editing":
        return { label: "Editing", color: "bg-amber-100 text-amber-700" };
      case "locked":
        return { label: "Confirmed", color: "bg-blue-100 text-blue-700" };
    }
  }, [layoutStatus]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !polygonRing || activeTab !== "mockup") return;

    mapboxgl.accessToken = mapToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: centroid ? [centroid.lng, centroid.lat] : [-122.4194, 37.7749],
      zoom: 15,
      interactive: isEditMode,
      attributionControl: false,
      logoPosition: "bottom-right",
    });

    mapRef.current = map;

    // Add controls
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 80, unit: "imperial" }), "bottom-left");
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: false }), "top-right");

    map.on("load", () => {
      // Add polygon source
      if (polygonRing) {
        map.addSource("work-zone", {
          type: "geojson",
          data: ringToGeoJSON(polygonRing),
        });

        map.addLayer({
          id: "work-zone-fill",
          type: "fill",
          source: "work-zone",
          paint: { "fill-color": AMBER_FILL, "fill-opacity": AMBER_FILL_OPACITY },
        });

        map.addLayer({
          id: "work-zone-halo",
          type: "line",
          source: "work-zone",
          paint: { "line-color": "#1f2937", "line-width": 4, "line-blur": 2, "line-opacity": 0.3 },
        });

        map.addLayer({
          id: "work-zone-outline",
          type: "line",
          source: "work-zone",
          paint: { "line-color": AMBER_STROKE, "line-width": AMBER_STROKE_WIDTH },
        });

        // Fit to bounds
        if (bbox) {
          map.fitBounds(bbox, { padding: 60, duration: 0, maxZoom: 17 });
        }

        // Extract road features for street-aware layout (after a short delay for tiles to load)
        if (onRoadFeaturesExtracted && bbox) {
          setTimeout(() => {
            try {
              // Expand bbox slightly to capture nearby roads
              const padding = 0.002; // ~200m padding
              const expandedBbox: [mapboxgl.LngLatLike, mapboxgl.LngLatLike] = [
                [bbox[0][0] - padding, bbox[0][1] - padding],
                [bbox[1][0] + padding, bbox[1][1] + padding],
              ];
              
              // Query rendered features for road layers
              const features = map.queryRenderedFeatures(
                [
                  map.project(expandedBbox[0] as [number, number]),
                  map.project(expandedBbox[1] as [number, number]),
                ],
                { layers: ROAD_LAYERS.filter(layer => map.getLayer(layer)) }
              );
              
              // Normalize to polylines
              const polylines = normalizeRoadFeatures(features as unknown as GeoJSON.Feature[]);
              
              if (polylines.length > 0) {
                onRoadFeaturesExtracted(polylines);
              }
            } catch (err) {
              // Silently fail - road extraction is optional enhancement
              console.debug("[FieldLayoutPanel] Road feature extraction failed:", err);
            }
          }, 500); // Wait for tiles to render
        }
      }
    });

    // Handle map click for adding devices
    map.on("click", (e) => {
      if (!isEditMode) return;
      
      if (activeTool === "addCone" || activeTool === "addSign") {
        const deviceType: DeviceType = activeTool === "addCone" ? "cone" : "sign";
        const newDevice: FieldDevice = {
          id: generateDeviceId(),
          type: deviceType,
          lngLat: [e.lngLat.lng, e.lngLat.lat],
          label: deviceType === "sign" ? getNextSignLabel() : undefined,
        };
        
        if (layout) {
          const newLayout = cloneLayout(layout, "user_modified");
          newLayout.devices.push(newDevice);
          onLayoutChange(newLayout);
        }
        
        // Reset to select tool after adding
        setActiveTool("select");
      }
    });

    return () => {
      // Clean up markers
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [mapToken, polygonRing, activeTab]);

  // Helper to get next sign label
  const getNextSignLabel = useCallback(() => {
    if (!layout) return "A";
    const existingSigns = layout.devices.filter(d => d.type === "sign" && d.label);
    const usedLabels = new Set(existingSigns.map(d => d.label));
    const labels = ["A", "B", "C", "D", "E", "F", "G", "H"];
    return labels.find(l => !usedLabels.has(l)) || `S${existingSigns.length + 1}`;
  }, [layout]);

  // Update map interactivity when edit mode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    
    if (isEditMode) {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
    } else {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
    }
  }, [isEditMode]);

  // Render device markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layout) return;

    // Remove old markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.clear();

    // Add new markers
    layout.devices.forEach(device => {
      const iconConfig = DEVICE_ICONS[device.type];
      
      const el = document.createElement("div");
      el.className = "device-marker";
      el.style.cssText = `
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        cursor: ${isEditMode ? "grab" : "default"};
        border-radius: 50%;
        background: ${selectedDeviceId === device.id ? "#FFB300" : "white"};
        border: 2px solid ${selectedDeviceId === device.id ? "#D97706" : iconConfig.color};
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        transition: all 0.15s ease;
      `;
      el.innerHTML = iconConfig.emoji;
      
      // Add label badge if exists
      if (device.label) {
        const labelEl = document.createElement("span");
        labelEl.style.cssText = `
          position: absolute;
          top: -8px;
          right: -8px;
          background: ${iconConfig.color};
          color: white;
          font-size: 9px;
          font-weight: bold;
          padding: 1px 4px;
          border-radius: 4px;
          font-family: monospace;
        `;
        labelEl.textContent = device.label;
        el.appendChild(labelEl);
      }
      
      // Click to select
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isEditMode) {
          if (activeTool === "delete") {
            // Delete this device
            const newLayout = cloneLayout(layout, "user_modified");
            newLayout.devices = newLayout.devices.filter(d => d.id !== device.id);
            onLayoutChange(newLayout);
            setSelectedDeviceId(null);
          } else {
            setSelectedDeviceId(device.id === selectedDeviceId ? null : device.id);
          }
        }
      });

      const marker = new mapboxgl.Marker({
        element: el,
        anchor: "center",
        draggable: isEditMode && activeTool === "select",
      })
        .setLngLat(device.lngLat)
        .addTo(map);

      // Handle drag end
      marker.on("dragend", () => {
        const newPos = marker.getLngLat();
        const newLayout = cloneLayout(layout, "user_modified");
        const deviceIndex = newLayout.devices.findIndex(d => d.id === device.id);
        if (deviceIndex >= 0) {
          newLayout.devices[deviceIndex].lngLat = [newPos.lng, newPos.lat];
          onLayoutChange(newLayout);
        }
      });

      markersRef.current.set(device.id, marker);
    });
  }, [layout, isEditMode, activeTool, selectedDeviceId, onLayoutChange]);

  // Toggle edit mode
  const handleToggleEditMode = useCallback(() => {
    if (isLocked) {
      // Unlock first
      onLockChange(false);
    }
    setIsEditMode(!isEditMode);
    setActiveTool("select");
    setSelectedDeviceId(null);
  }, [isEditMode, isLocked, onLockChange]);

  // Confirm layout
  const handleConfirmLayout = useCallback(() => {
    onLockChange(true);
    setIsEditMode(false);
    setActiveTool("select");
    setSelectedDeviceId(null);
  }, [onLockChange]);

  // Delete selected device
  const handleDeleteSelected = useCallback(() => {
    if (!selectedDeviceId || !layout) return;
    const newLayout = cloneLayout(layout, "user_modified");
    newLayout.devices = newLayout.devices.filter(d => d.id !== selectedDeviceId);
    onLayoutChange(newLayout);
    setSelectedDeviceId(null);
  }, [selectedDeviceId, layout, onLayoutChange]);

  // Device counts for validation display
  const deviceCounts = useMemo(() => {
    if (!layout) return { cones: 0, signs: 0, flaggers: 0, arrowBoards: 0, total: 0 };
    const counts = { cones: 0, signs: 0, flaggers: 0, arrowBoards: 0, total: 0 };
    layout.devices.forEach(d => {
      counts.total++;
      if (d.type === "cone") counts.cones++;
      else if (d.type === "sign") counts.signs++;
      else if (d.type === "flagger") counts.flaggers++;
      else if (d.type === "arrowBoard") counts.arrowBoards++;
    });
    return counts;
  }, [layout]);

  // Empty state
  if (!polygonRing) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-300 rounded-sm p-8 text-center" style={{ minHeight: height }}>
        <div className="text-slate-400 mb-2">
          <svg className="w-12 h-12 mx-auto opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-500">No Work Zone Defined</p>
        <p className="text-xs text-slate-400 mt-1">Draw a work zone on the map to see the mockup</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#FFB300]"></div>
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
            Field Layout
          </h3>
        </div>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${statusConfig.color}`}>
          {statusConfig.label}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100">
        <button
          type="button"
          onClick={() => setActiveTab("mockup")}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === "mockup"
              ? "text-slate-900 border-b-2 border-[#FFB300] bg-white"
              : "text-slate-500 hover:text-slate-700 bg-slate-50"
          }`}
        >
          Map Mockup
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("schematic")}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === "schematic"
              ? "text-slate-900 border-b-2 border-[#FFB300] bg-white"
              : "text-slate-500 hover:text-slate-700 bg-slate-50"
          }`}
        >
          Schematic
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "mockup" ? (
        <div>
          {/* Edit Toolbar */}
          <div className="px-3 py-2 bg-slate-900 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleToggleEditMode}
                className={`px-2 py-1 text-[10px] font-bold uppercase rounded transition-colors ${
                  isEditMode
                    ? "bg-amber-500 text-slate-900"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
              >
                {isEditMode ? "Exit Edit" : "Edit Mode"}
              </button>
              
              {isEditMode && (
                <>
                  <div className="w-px h-4 bg-slate-700 mx-1"></div>
                  <button
                    type="button"
                    onClick={() => setActiveTool("select")}
                    className={`px-2 py-1 text-[10px] rounded ${
                      activeTool === "select" ? "bg-slate-600 text-white" : "text-slate-400 hover:bg-slate-700"
                    }`}
                    title="Select/Move"
                  >
                    ✋
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool("addCone")}
                    className={`px-2 py-1 text-[10px] rounded ${
                      activeTool === "addCone" ? "bg-slate-600 text-white" : "text-slate-400 hover:bg-slate-700"
                    }`}
                    title="Add Cone"
                  >
                    🔶
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool("addSign")}
                    className={`px-2 py-1 text-[10px] rounded ${
                      activeTool === "addSign" ? "bg-slate-600 text-white" : "text-slate-400 hover:bg-slate-700"
                    }`}
                    title="Add Sign"
                  >
                    ⚠️
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTool("delete")}
                    className={`px-2 py-1 text-[10px] rounded ${
                      activeTool === "delete" ? "bg-red-600 text-white" : "text-slate-400 hover:bg-slate-700"
                    }`}
                    title="Delete Mode"
                  >
                    🗑️
                  </button>
                  {selectedDeviceId && (
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      className="px-2 py-1 text-[10px] bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Delete Selected
                    </button>
                  )}
                </>
              )}
            </div>
            
            {isEditMode && !isLocked && (
              <button
                type="button"
                onClick={handleConfirmLayout}
                className="px-3 py-1 text-[10px] font-bold uppercase bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors"
              >
                ✓ Confirm Layout
              </button>
            )}
          </div>

          {/* Warning for generated plan */}
          {hasGeneratedPlan && isEditMode && (
            <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-[10px] text-amber-700">
              ⚠️ Edits require regeneration to update compliance calculations.
            </div>
          )}

          {/* Map Container */}
          <div
            ref={containerRef}
            style={{ height }}
            className="w-full"
            aria-label={`Work zone mockup${locationLabel ? ` near ${locationLabel}` : ""}`}
          />

          {/* Device Counts / Validation */}
          <div className="px-3 py-2 bg-slate-900 flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-3 text-slate-400">
              <span>🔶 <span className="text-white font-bold">{deviceCounts.cones}</span> cones</span>
              <span>⚠️ <span className="text-white font-bold">{deviceCounts.signs}</span> signs</span>
              {deviceCounts.flaggers > 0 && (
                <span>🚧 <span className="text-white font-bold">{deviceCounts.flaggers}</span> flaggers</span>
              )}
              {deviceCounts.arrowBoards > 0 && (
                <span>➡️ <span className="text-white font-bold">{deviceCounts.arrowBoards}</span> arrow boards</span>
              )}
            </div>
            <span className="text-slate-500 italic">Mockup is illustrative</span>
          </div>

          {/* Location Label */}
          {locationLabel && (
            <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-600 truncate">
              📍 {locationLabel}
            </div>
          )}
        </div>
      ) : (
        /* Schematic Tab */
        <div className="p-1">
          {geometry ? (
            <DiagramPreview
              geometry={geometry}
              job={diagramJob ?? null}
              plan={diagramPlan ?? null}
              height={height}
            />
          ) : (
            <div className="flex items-center justify-center text-slate-400 text-sm" style={{ height }}>
              No geometry available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

