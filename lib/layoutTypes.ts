/**
 * Field Layout Types
 * 
 * Types for the Map Mockup overlay system. This is a visual layout model
 * for placing TCP devices on the map. It is separate from the compliance
 * plan calculations in tcpTypes.ts.
 */

/**
 * Device types that can be placed on the map mockup
 */
export type DeviceType = "cone" | "sign" | "arrowBoard" | "flagger" | "drum" | "barricade";

/**
 * A single device placed on the map
 */
export interface FieldDevice {
  /** Unique identifier for this device */
  id: string;
  /** Type of TCP device */
  type: DeviceType;
  /** Position as [longitude, latitude] */
  lngLat: [number, number];
  /** Optional label (e.g., "A", "B", "C" for signs) */
  label?: string;
  /** Rotation in degrees (0 = north, clockwise) */
  rotation?: number;
  /** Additional metadata for future use */
  meta?: Record<string, unknown>;
}

/**
 * Cardinal direction for approach/traffic flow
 */
export type ApproachDirection = "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW";

/**
 * The complete field layout for a work zone
 */
export interface FieldLayout {
  /** Schema version for future migrations */
  version: 1;
  /** ISO timestamp when layout was created */
  createdAt: string;
  /** ISO timestamp when layout was last modified */
  updatedAt: string;
  /** Inferred or user-set approach direction */
  direction?: ApproachDirection;
  /** All devices in the layout */
  devices: FieldDevice[];
  /** Source of the layout */
  source: "ai_suggested" | "user_created" | "user_modified";
}

/**
 * A road centerline polyline extracted from map data
 */
export type RoadPolyline = Array<[number, number]>; // Array of [lng, lat]

/**
 * Input parameters for generating a suggested layout
 */
export interface LayoutSuggestionInput {
  /** Polygon ring as array of [lng, lat] coordinates */
  polygonRing: number[][];
  /** Center point of the work zone */
  centroid: { lng: number; lat: number };
  /** Road type */
  roadType: "2_lane_undivided" | "multilane_divided" | "intersection";
  /** Posted speed in mph */
  postedSpeedMph: number;
  /** Type of work operation */
  workType: "shoulder_work" | "lane_closure" | "one_lane_two_way_flaggers";
  /** Length of work zone in feet */
  workLengthFt: number;
  /** 
   * Optional: Road centerlines extracted from map via queryRenderedFeatures.
   * If provided, layout will align to actual streets.
   */
  roadCenterlines?: RoadPolyline[];
}

/**
 * Device icon configurations for rendering
 */
export const DEVICE_ICONS: Record<DeviceType, { emoji: string; color: string; label: string }> = {
  cone: { emoji: "🔶", color: "#FF6B00", label: "Cone" },
  sign: { emoji: "⚠️", color: "#FFB300", label: "Sign" },
  arrowBoard: { emoji: "➡️", color: "#FFB300", label: "Arrow Board" },
  flagger: { emoji: "🚧", color: "#EF4444", label: "Flagger" },
  drum: { emoji: "🛢️", color: "#FF6B00", label: "Drum" },
  barricade: { emoji: "🚧", color: "#FFB300", label: "Barricade" },
};

/**
 * Sign labels for advance warning sequence
 */
export const SIGN_LABELS = ["A", "B", "C", "D", "E"] as const;

/**
 * Generate a unique ID for a device
 */
export function generateDeviceId(): string {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;
}

/**
 * Create a new empty field layout
 */
export function createEmptyLayout(): FieldLayout {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    devices: [],
    source: "user_created",
  };
}

/**
 * Clone a layout with updated timestamp
 */
export function cloneLayout(layout: FieldLayout, source?: FieldLayout["source"]): FieldLayout {
  return {
    ...layout,
    updatedAt: new Date().toISOString(),
    devices: layout.devices.map(d => ({ ...d })),
    source: source ?? layout.source,
  };
}

