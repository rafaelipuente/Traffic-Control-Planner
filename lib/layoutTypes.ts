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
 * Sign subtypes for specific warning signs
 */
export type SignSubtype = 
  | "roadWorkAhead" 
  | "bePreparedToStop" 
  | "flaggerAhead" 
  | "rightLaneClosed"
  | "leftLaneClosed"
  | "oneLaneRoadAhead"
  | "generic";

/**
 * A single device placed on the map
 */
export interface FieldDevice {
  /** Unique identifier for this device */
  id: string;
  /** Type of TCP device */
  type: DeviceType;
  /** Subtype for signs (specific sign type) */
  subtype?: SignSubtype;
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
 * Note: emoji is kept for fallback, but SVG icons are preferred
 */
export interface DeviceIconConfig {
  emoji: string;
  color: string;
  label: string;
  /** SVG path data for the icon */
  svgPath?: string;
}

export const DEVICE_ICONS: Record<DeviceType, DeviceIconConfig> = {
  cone: { 
    emoji: "🔶", 
    color: "#FF6B00", 
    label: "Cone",
    svgPath: "M12 2L4 22h16L12 2zm0 4l5.5 14h-11L12 6z", // Traffic cone shape
  },
  sign: { 
    emoji: "⚠️", 
    color: "#FFB300", 
    label: "Sign",
    svgPath: "M12 2L2 20h20L12 2zm0 3l7.5 13h-15L12 5zm-1 5v4h2V10h-2zm0 6v2h2v-2h-2z", // Warning triangle
  },
  arrowBoard: { 
    emoji: "➡️", 
    color: "#FFB300", 
    label: "Arrow Board",
    svgPath: "M2 9h14l-4-4 1.4-1.4L20 10l-6.6 6.4L12 15l4-4H2V9z", // Arrow
  },
  flagger: { 
    emoji: "🚧", 
    color: "#EF4444", 
    label: "Flagger",
    svgPath: "M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-2 8v12h4v-4h2l-2-4V10h-4z", // Person
  },
  drum: { 
    emoji: "🛢️", 
    color: "#FF6B00", 
    label: "Drum",
    svgPath: "M6 4c0-1 2.7-2 6-2s6 1 6 2v2c0 1-2.7 2-6 2s-6-1-6-2V4zm0 4v4c0 1 2.7 2 6 2s6-1 6-2V8c-1.5 1-3.7 1.5-6 1.5S7.5 9 6 8zm0 6v4c0 1 2.7 2 6 2s6-1 6-2v-4c-1.5 1-3.7 1.5-6 1.5S7.5 15 6 14z", // Drum
  },
  barricade: { 
    emoji: "🚧", 
    color: "#FFB300", 
    label: "Barricade",
    svgPath: "M2 7h20v2H2V7zm2-2h16l-1-3H5l-1 3zm0 6h16v2L18 17H6l-2-4v-2zm2 6h12v2H6v-2z", // Barricade
  },
};

/**
 * Sign subtype configurations
 */
export interface SignSubtypeConfig {
  label: string;
  mutcdCode: string;
  color: string;
  backgroundColor: string;
  text: string[];
}

export const SIGN_SUBTYPES: Record<SignSubtype, SignSubtypeConfig> = {
  roadWorkAhead: {
    label: "Road Work Ahead",
    mutcdCode: "W20-1",
    color: "#000000",
    backgroundColor: "#FFB300",
    text: ["ROAD", "WORK", "AHEAD"],
  },
  bePreparedToStop: {
    label: "Be Prepared to Stop",
    mutcdCode: "W3-4",
    color: "#000000",
    backgroundColor: "#FFB300",
    text: ["BE PREPARED", "TO STOP"],
  },
  flaggerAhead: {
    label: "Flagger Ahead",
    mutcdCode: "W20-7a",
    color: "#000000",
    backgroundColor: "#FFB300",
    text: ["FLAGGER", "AHEAD"],
  },
  rightLaneClosed: {
    label: "Right Lane Closed",
    mutcdCode: "W20-5R",
    color: "#000000",
    backgroundColor: "#FFB300",
    text: ["RIGHT LANE", "CLOSED"],
  },
  leftLaneClosed: {
    label: "Left Lane Closed",
    mutcdCode: "W20-5L",
    color: "#000000",
    backgroundColor: "#FFB300",
    text: ["LEFT LANE", "CLOSED"],
  },
  oneLaneRoadAhead: {
    label: "One Lane Road Ahead",
    mutcdCode: "W20-4",
    color: "#000000",
    backgroundColor: "#FFB300",
    text: ["ONE LANE", "ROAD", "AHEAD"],
  },
  generic: {
    label: "Warning Sign",
    mutcdCode: "W-GENERIC",
    color: "#000000",
    backgroundColor: "#FFB300",
    text: ["⚠"],
  },
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
