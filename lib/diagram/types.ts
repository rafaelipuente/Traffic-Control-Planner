/**
 * Diagram Type Definitions
 * 
 * Core interfaces for the dynamic TCP diagram preview system.
 * Supports linear (normal road) and intersection layout modes.
 */

// Layout mode - explicit only, no auto-detection
export type LayoutMode = "linear" | "intersection";

// Orientation derived from bbox analysis
export type DiagramOrientation = "vertical" | "horizontal";

// Sign spacing entry
export interface SignSpacing {
  label: "A" | "B" | "C";
  distanceFt: number;
}

// Device counts
export interface Devices {
  cones: number;
  signs: number;
  arrowBoard: boolean;
  flaggers: number;
}

// TCP Plan data (subset needed for diagram)
export interface DiagramPlanData {
  signSpacing: SignSpacing[];
  taperLengthFt: number;
  bufferLengthFt: number;
  devices: Devices;
  recommendedLayout?: string;
}

// Job input data
export interface DiagramJobData {
  roadType: "2_lane_undivided" | "multilane_divided" | "intersection";
  workType: "shoulder_work" | "lane_closure" | "one_lane_two_way_flaggers";
  workLengthFt: number;
  postedSpeedMph: number;
  isNight: boolean;
}

// Bbox geometry [west, south, east, north]
export type Bbox = [number, number, number, number];

// Polygon ring (unclosed)
export type PolygonRing = [number, number][];

// Geometry input
export interface DiagramGeometry {
  type: "bbox" | "polygon";
  bbox?: Bbox;
  polygon?: PolygonRing[];
}

// Analysis result from geometry
export interface GeometryAnalysis {
  orientation: DiagramOrientation;
  bboxWidthDeg: number;
  bboxHeightDeg: number;
  aspectRatio: number; // height / width
}

// Zone proportions for rendering
export interface ZoneProportions {
  advanceWarningPx: number;
  taperPx: number;
  bufferPx: number;
  workZonePx: number;
  totalHeightPx: number;
  // Footage values for labels
  advanceWarningFt: number;
  taperFt: number;
  bufferFt: number;
  workZoneFt: number;
}

// Diagram configuration
export interface DiagramConfig {
  width: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  laneWidth: number;
  minZoneHeight: number; // Minimum height per zone (default 40px, floor 24px)
}

// Diagram state
export type DiagramState = "empty" | "geometry-only" | "full";

// Complete diagram input
export interface DiagramInput {
  state: DiagramState;
  layoutMode: LayoutMode;
  geometry?: DiagramGeometry;
  job?: DiagramJobData;
  plan?: DiagramPlanData;
}

// Accessibility description data
export interface DiagramAccessibility {
  title: string;
  description: string;
}

// Default configuration
export const DEFAULT_DIAGRAM_CONFIG: DiagramConfig = {
  width: 800,
  height: 500,
  paddingTop: 40,
  paddingBottom: 50,
  paddingLeft: 120,
  paddingRight: 120,
  laneWidth: 80,
  minZoneHeight: 40,
};

// Minimum zone height floor (absolute minimum)
export const MIN_ZONE_HEIGHT_FLOOR = 24;

// Number of zones to account for in height calculations
export const ZONE_COUNT = 4; // AWA, Taper, Buffer, Work Zone

