/**
 * TCP Rules Pack Type Definitions
 * 
 * These types define the structure for the TCP placement rules
 * extracted from MUTCD, TTCM Portland, and best practice guidelines.
 */

// =============================================================================
// SIGN TYPES
// =============================================================================

export type SignCode = 
  | "ROAD_WORK_AHEAD"     // W20-1
  | "BE_PREPARED_TO_STOP" // W3-4
  | "FLAGGER_AHEAD"       // W20-7a / CW23-2
  | "RIGHT_LANE_CLOSED"   // W20-5R
  | "LEFT_LANE_CLOSED"    // W20-5L
  | "ONE_LANE_ROAD"       // W20-4
  | "WORKERS_AHEAD"       // W21-1
  | "END_ROAD_WORK"       // G20-2
  | "DETOUR"              // M4-8
  | "ROAD_CLOSED"         // R11-2
  ;

export interface SignDefinition {
  code: SignCode;
  mutcdCode: string;
  label: string;
  category: "warning" | "regulatory" | "guide";
  sizesInches: number[]; // Available sizes (e.g., 36, 48)
  description: string;
}

// =============================================================================
// WORK ZONE TYPES
// =============================================================================

export type WorkZoneType = 
  | "ROAD_SEGMENT"   // Standard road segment work
  | "INTERSECTION"   // Work at or near intersection
  | "LANE_CLOSURE"   // Single lane closure on multilane road
  | "FULL_CLOSURE"   // Complete road closure
  | "SHOULDER_WORK"  // Work on shoulder only
  | "MOBILE"         // Moving work zone (≤60 min)
  ;

export type WorkType = 
  | "UTILITY"
  | "CONSTRUCTION"
  | "MAINTENANCE"
  | "EMERGENCY"
  | "SPECIAL_EVENT"
  ;

// =============================================================================
// SPACING AND DISTANCE RULES
// =============================================================================

export interface SpacingBySpeed {
  speedMph: number;
  signSpacing_ft: number;
  coneSpacing_ft: number;
  taperLength_ft: number;
  bufferLength_ft: number;
  source: SourceCitation;
}

export interface TaperRule {
  formula: string;           // e.g., "L = WS" or "L = W * S²/60"
  formulaDescription: string;
  bySpeedMph: Record<number, {
    length_ft: number;
    coneSpacing_ft: number;
    drumRequired: boolean;
    source: SourceCitation;
  }>;
}

// =============================================================================
// PLACEMENT CONSTRAINTS
// =============================================================================

export interface PlacementConstraint {
  id: string;
  description: string;
  requirement: "SHALL" | "SHOULD" | "MAY";
  enforcementLevel: "hard" | "soft" | "recommendation";
  validationRule?: string; // Optional code reference for validation
  source: SourceCitation;
}

export interface SignPlacementRule {
  signCode: SignCode;
  position: "upstream" | "downstream" | "at_work_zone";
  offsetFromWorkZone_ft: {
    min: number;
    max: number;
    typical: number;
  };
  lateralPosition: "right_shoulder" | "left_shoulder" | "both" | "median";
  constraints: string[];
  source: SourceCitation;
}

// =============================================================================
// SOURCE CITATIONS
// =============================================================================

export interface SourceCitation {
  sourcePdf: string;
  page?: number | string;
  sectionTitle?: string;
  mutcdSection?: string;
  effectiveDate?: string;
  notes?: string;
}

// =============================================================================
// WORK ZONE CONFIGURATION
// =============================================================================

export interface WorkZoneConfiguration {
  workZoneType: WorkZoneType;
  requiredSigns: SignCode[];
  optionalSigns: SignCode[];
  signOrder: SignCode[];  // Upstream to downstream
  minAdvanceWarningDistance_ft: number;
  requiresFlaggers: boolean;
  requiresArrowBoard: boolean;
  specialConditions: string[];
  source: SourceCitation;
}

// =============================================================================
// DEVICE REQUIREMENTS
// =============================================================================

export interface ConeRequirements {
  minHeight_in: number;
  reflective: boolean;
  weightedBase: boolean;
  conditions: string;
  source: SourceCitation;
}

export interface DrumRequirements {
  required: boolean;
  conditions: string;
  source: SourceCitation;
}

// =============================================================================
// MAIN RULES PACK STRUCTURE
// =============================================================================

export interface TcpRulesPack {
  version: string;
  generatedAt: string;
  sources: {
    primary: string[];
    supplemental: string[];
  };
  
  signs: {
    definitions: Record<SignCode, SignDefinition>;
  };
  
  workZoneConfigurations: Record<WorkZoneType, WorkZoneConfiguration>;
  
  spacing: {
    formula: {
      signSpacing: string;
      coneSpacing: string;
      taperLength: string;
    };
    bySpeedMph: Record<number, SpacingBySpeed>;
  };
  
  taper: {
    laneClosure: TaperRule;
    laneShift: TaperRule;
    merging: TaperRule;
  };
  
  devices: {
    cones: Record<string, ConeRequirements>;
    drums: DrumRequirements;
  };
  
  constraints: PlacementConstraint[];
  
  signPlacement: SignPlacementRule[];
  
  nightOperations: {
    additionalRequirements: string[];
    reflectivityRequired: boolean;
    minVisibilityDistance_ft: number;
    source: SourceCitation;
  };
  
  validation: {
    enabled: boolean;
    rules: string[];
  };
}

