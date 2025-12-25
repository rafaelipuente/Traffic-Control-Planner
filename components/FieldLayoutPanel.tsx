"use client";

/**
 * FieldLayoutPanel - Map Mockup with editable device overlay
 * 
 * EDIT MODE REGRESSION CHECKLIST:
 * - [ ] Add Cone: Click map with 🔶 tool → creates cone, increments cone count
 * - [ ] Add Sign: Click map with ⚠️ tool → creates sign, increments sign count  
 * - [ ] Delete: Click device with 🗑️ tool → removes device, updates counts
 * - [ ] Drag: With ✋ tool, drag device → device moves, map does NOT pan
 * - [ ] Pan: With add/delete tools, drag map → map pans normally
 * - [ ] Exit: Exit edit mode → map returns to non-interactive state
 */

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

// DEV-ONLY: Set to true to show edit debug overlay
const DEBUG_EDIT_MODE = false;

// DEV-ONLY: Validate layout state integrity after edits
function validateLayoutState(layout: FieldLayout, context: string): void {
  if (!DEBUG_EDIT_MODE) return;
  
  // Check all devices have valid types
  const validTypes: DeviceType[] = ["cone", "sign", "arrowBoard", "flagger", "drum", "barricade"];
  const invalidDevices = layout.devices.filter(d => !validTypes.includes(d.type));
  if (invalidDevices.length > 0) {
    console.error(`[INVARIANT VIOLATION] ${context}: Invalid device types found:`, invalidDevices);
  }
  
  // Check all devices have unique IDs
  const ids = layout.devices.map(d => d.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    console.error(`[INVARIANT VIOLATION] ${context}: Duplicate device IDs found`);
  }
  
  // Count devices by type
  const counts: Record<string, number> = {};
  layout.devices.forEach(d => {
    counts[d.type] = (counts[d.type] || 0) + 1;
  });
  console.log(`[Layout Validation] ${context}: devices=${layout.devices.length}, counts=`, counts);
}

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

// Debug state for edit mode (dev-only)
interface EditDebugState {
  activeTool: EditTool;
  lastAction: string;
  lastAddedType: DeviceType | null;
  draggingDeviceId: string | null;
  mapDragPanEnabled: boolean;
}

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
  const [draggingDeviceId, setDraggingDeviceId] = useState<string | null>(null);
  
  // Debug state (dev-only)
  const [debugState, setDebugState] = useState<EditDebugState>({
    activeTool: "select",
    lastAction: "none",
    lastAddedType: null,
    draggingDeviceId: null,
    mapDragPanEnabled: false,
  });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  
  // Refs to track current state/callback values for use in event handlers
  // This fixes the stale closure issue where map.on("click") captures old values
  const activeToolRef = useRef<EditTool>(activeTool);
  const isEditModeRef = useRef<boolean>(isEditMode);
  const layoutRef = useRef<FieldLayout | null>(layout);
  const onLayoutChangeRef = useRef<(layout: FieldLayout) => void>(onLayoutChange);
  
  // Keep refs in sync with state/props
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { isEditModeRef.current = isEditMode; }, [isEditMode]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { onLayoutChangeRef.current = onLayoutChange; }, [onLayoutChange]);

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
    // IMPORTANT: Use refs to access current state values (fixes stale closure issue)
    map.on("click", (e) => {
      const currentTool = activeToolRef.current;
      const currentEditMode = isEditModeRef.current;
      const currentLayout = layoutRef.current;
      
      if (!currentEditMode) return;
      
      if (currentTool === "addCone" || currentTool === "addSign") {
        // CRITICAL: Map tool name to correct device type
        // addCone → "cone", addSign → "sign"
        const deviceType: DeviceType = currentTool === "addCone" ? "cone" : "sign";
        
        // Debug logging - ALWAYS log this for QA traceability
        console.log(`[EditMode Add] tool="${currentTool}" → type="${deviceType}" at [${e.lngLat.lng.toFixed(6)}, ${e.lngLat.lat.toFixed(6)}]`);
        
        // INVARIANT: Verify the mapping is correct
        if (currentTool === "addSign" && deviceType !== "sign") {
          console.error("[INVARIANT VIOLATION] addSign tool should create sign, got:", deviceType);
        }
        if (currentTool === "addCone" && deviceType !== "cone") {
          console.error("[INVARIANT VIOLATION] addCone tool should create cone, got:", deviceType);
        }
        
        const newDevice: FieldDevice = {
          id: generateDeviceId(),
          type: deviceType,
          lngLat: [e.lngLat.lng, e.lngLat.lat],
          label: deviceType === "sign" ? getNextSignLabel() : undefined,
        };
        
        // Verify device was created with correct type
        console.log(`[EditMode Add] Created device: id="${newDevice.id}", type="${newDevice.type}"`);
        
        if (currentLayout) {
          const newLayout = cloneLayout(currentLayout, "user_modified");
          newLayout.devices.push(newDevice);
          
          // Validate before dispatching
          if (DEBUG_EDIT_MODE) {
            validateLayoutState(newLayout, `after add_${deviceType}`);
          }
          
          // CRITICAL: Use ref to get latest callback (fixes stale closure)
          const currentOnLayoutChange = onLayoutChangeRef.current;
          currentOnLayoutChange(newLayout);
          
          // Log the final counts for verification
          const coneCount = newLayout.devices.filter(d => d.type === "cone").length;
          const signCount = newLayout.devices.filter(d => d.type === "sign").length;
          console.log(`[EditMode Add] Layout updated: cones=${coneCount}, signs=${signCount}, total=${newLayout.devices.length}`);
          
          // Update debug state
          if (DEBUG_EDIT_MODE) {
            setDebugState(prev => ({
              ...prev,
              lastAction: `add_${deviceType}`,
              lastAddedType: deviceType,
            }));
          }
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

  // Update map interactivity when edit mode or tool changes
  // CRITICAL: Disable dragPan in "select" tool so markers can be dragged
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    
    if (isEditMode) {
      // In select tool, disable map panning so marker drag works
      // In other tools (add/delete), enable panning for navigation
      const shouldEnableDragPan = activeTool !== "select";
      
      if (shouldEnableDragPan) {
        map.dragPan.enable();
      } else {
        map.dragPan.disable();
      }
      
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
      
      // Debug logging
      if (DEBUG_EDIT_MODE) {
        console.log(`[EditMode] Tool: ${activeTool}, dragPan: ${shouldEnableDragPan}`);
        setDebugState(prev => ({
          ...prev,
          activeTool,
          mapDragPanEnabled: shouldEnableDragPan,
        }));
      }
    } else {
      // Outside edit mode, disable all interactions
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
    }
  }, [isEditMode, activeTool]);

  // Render device markers
  // This effect MUST run whenever layout changes to sync markers with state
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layout) return;

    // Log when marker sync runs
    console.log(`[Markers Sync] Rendering ${layout.devices.length} devices. Types: ${layout.devices.map(d => d.type).join(", ")}`);

    // Remove old markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.clear();

    // Determine if dragging should be enabled
    // CRITICAL: Only enable drag in select tool mode
    const canDrag = isEditMode && activeTool === "select";

    // Validate layout state before rendering markers
    if (DEBUG_EDIT_MODE) {
      validateLayoutState(layout, "renderMarkers");
    }

    // Add new markers
    layout.devices.forEach(device => {
      // CRITICAL: Validate device type before rendering
      const iconConfig = DEVICE_ICONS[device.type];
      if (!iconConfig) {
        console.error(`[Marker Error] Unknown device type: "${device.type}" for device ${device.id}`);
        // Use a fallback visual to make the error visible
        const errorEl = document.createElement("div");
        errorEl.style.cssText = `
          width: 28px; height: 28px; background: red; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; color: white; font-weight: bold;
        `;
        errorEl.textContent = "?";
        const errorMarker = new mapboxgl.Marker({ element: errorEl, anchor: "center" })
          .setLngLat(device.lngLat)
          .addTo(map);
        markersRef.current.set(device.id, errorMarker);
        return; // Skip this device
      }
      
      // Debug: Log each marker creation
      if (DEBUG_EDIT_MODE) {
        console.log(`[Marker] Creating: id=${device.id}, type=${device.type}, emoji=${iconConfig.emoji}`);
      }
      
      const el = document.createElement("div");
      el.className = "device-marker";
      el.setAttribute("data-device-type", device.type); // For debugging in DevTools
      el.setAttribute("data-device-id", device.id);
      el.style.cssText = `
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        cursor: ${canDrag ? "grab" : (isEditMode ? "pointer" : "default")};
        border-radius: 50%;
        background: ${selectedDeviceId === device.id ? "#FFB300" : "white"};
        border: 2px solid ${selectedDeviceId === device.id ? "#D97706" : iconConfig.color};
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        transition: all 0.15s ease;
        pointer-events: auto;
        z-index: 10;
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
      
      // Click to select or delete
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        
        // Use refs for current state values
        const currentEditMode = isEditModeRef.current;
        const currentTool = activeToolRef.current;
        const currentLayout = layoutRef.current;
        
        if (!currentEditMode || !currentLayout) return;
        
        if (currentTool === "delete") {
          // Delete this device
          console.log(`[EditMode Delete] Removing device: id="${device.id}", type="${device.type}"`);
          
          const newLayout = cloneLayout(currentLayout, "user_modified");
          newLayout.devices = newLayout.devices.filter(d => d.id !== device.id);
          
          // Log the final counts for verification
          const coneCount = newLayout.devices.filter(d => d.type === "cone").length;
          const signCount = newLayout.devices.filter(d => d.type === "sign").length;
          console.log(`[EditMode Delete] Layout updated: cones=${coneCount}, signs=${signCount}, total=${newLayout.devices.length}`);
          
          // CRITICAL: Use ref to get latest callback (fixes stale closure)
          onLayoutChangeRef.current(newLayout);
          setSelectedDeviceId(null);
          
          if (DEBUG_EDIT_MODE) {
            setDebugState(prev => ({ ...prev, lastAction: `delete_${device.type}` }));
          }
        } else {
          // Toggle selection
          setSelectedDeviceId(device.id === selectedDeviceId ? null : device.id);
        }
      });

      const marker = new mapboxgl.Marker({
        element: el,
        anchor: "center",
        draggable: canDrag,
      })
        .setLngLat(device.lngLat)
        .addTo(map);

      // Handle drag start
      marker.on("dragstart", () => {
        setDraggingDeviceId(device.id);
        if (DEBUG_EDIT_MODE) {
          console.log(`[EditMode] Drag start: ${device.id}`);
          setDebugState(prev => ({ ...prev, draggingDeviceId: device.id }));
        }
        // Update cursor while dragging
        el.style.cursor = "grabbing";
      });

      // Handle drag end
      marker.on("dragend", () => {
        const newPos = marker.getLngLat();
        const currentLayout = layoutRef.current;
        
        console.log(`[EditMode Drag] Device ${device.id} moved to [${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}]`);
        
        if (DEBUG_EDIT_MODE) {
          setDebugState(prev => ({ ...prev, draggingDeviceId: null, lastAction: "drag" }));
        }
        
        if (currentLayout) {
          const newLayout = cloneLayout(currentLayout, "user_modified");
          const deviceIndex = newLayout.devices.findIndex(d => d.id === device.id);
          if (deviceIndex >= 0) {
            newLayout.devices[deviceIndex].lngLat = [newPos.lng, newPos.lat];
            // CRITICAL: Use ref to get latest callback (fixes stale closure)
            onLayoutChangeRef.current(newLayout);
          }
        }
        
        setDraggingDeviceId(null);
        // Reset cursor
        el.style.cursor = canDrag ? "grab" : "pointer";
      });

      markersRef.current.set(device.id, marker);
    });
    
    // DEV INVARIANT: Verify DOM marker count matches layout
    const domMarkerCount = markersRef.current.size;
    const layoutDeviceCount = layout.devices.length;
    const coneCount = layout.devices.filter(d => d.type === "cone").length;
    const signCount = layout.devices.filter(d => d.type === "sign").length;
    
    console.log(`[INV] layout: total=${layoutDeviceCount} cones=${coneCount} signs=${signCount}`);
    console.log(`[INV] domMarkers=${domMarkerCount} ${domMarkerCount === layoutDeviceCount ? "✅" : "❌ MISMATCH"}`);
    
    if (domMarkerCount !== layoutDeviceCount) {
      console.error(`[INVARIANT VIOLATION] DOM markers (${domMarkerCount}) != layout devices (${layoutDeviceCount})`);
    }
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
  // CRITICAL: This must match what markers are rendered
  const deviceCounts = useMemo(() => {
    if (!layout) return { cones: 0, signs: 0, flaggers: 0, arrowBoards: 0, total: 0 };
    const counts = { cones: 0, signs: 0, flaggers: 0, arrowBoards: 0, total: 0 };
    layout.devices.forEach(d => {
      counts.total++;
      if (d.type === "cone") counts.cones++;
      else if (d.type === "sign") counts.signs++;
      else if (d.type === "flagger") counts.flaggers++;
      else if (d.type === "arrowBoard") counts.arrowBoards++;
      else {
        console.error(`[Counts Error] Unknown device type: "${d.type}" for device ${d.id}`);
      }
    });
    
    // Debug: Log counts whenever they change
    if (DEBUG_EDIT_MODE) {
      console.log(`[Counts] cones=${counts.cones}, signs=${counts.signs}, total=${counts.total}`);
    }
    
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
            className="w-full relative"
            aria-label={`Work zone mockup${locationLabel ? ` near ${locationLabel}` : ""}`}
          />
          
          {/* DEV-ONLY: Edit Debug Overlay */}
          {DEBUG_EDIT_MODE && isEditMode && (
            <div className="absolute top-2 left-2 bg-black/80 text-green-400 text-[9px] font-mono p-2 rounded z-50 pointer-events-none">
              <div>tool: <span className="text-yellow-400">{activeTool}</span></div>
              <div>lastAction: <span className="text-cyan-400">{debugState.lastAction}</span></div>
              <div>lastAdded: <span className="text-orange-400">{debugState.lastAddedType || "—"}</span></div>
              <div>dragging: <span className="text-pink-400">{draggingDeviceId || "—"}</span></div>
              <div>dragPan: <span className={activeTool !== "select" ? "text-green-400" : "text-red-400"}>
                {activeTool !== "select" ? "enabled" : "disabled"}
              </span></div>
              <div>selected: <span className="text-purple-400">{selectedDeviceId || "—"}</span></div>
            </div>
          )}

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

