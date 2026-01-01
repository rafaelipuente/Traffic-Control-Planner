/**
 * TCP Rules Resolver
 * 
 * Resolves traffic control placement rules from the extracted PDF rules pack
 * into concrete numeric values for auto-layout.
 * 
 * This is the SINGLE SOURCE OF TRUTH for all sign, cone, and taper spacing.
 * The Map Mockup should use these values instead of heuristic/AI guessing.
 */

import rulesPack from "./tcpRulesPack.v1.json";
import { SourceCitation, SignCode } from "./rulesTypes";

// =============================================================================
// TYPES
// =============================================================================

export interface ResolvedTcpRules {
  /** Distance between warning signs in feet */
  signSpacingFt: number;
  /** Length of the taper in feet */
  taperLengthFt: number;
  /** Spacing between cones in feet */
  coneSpacingFt: number;
  /** Required signs for this operation (upstream → downstream order) */
  requiredSigns: string[];
  /** Buffer length after taper in feet */
  bufferLengthFt: number;
  /** Whether drums are required (vs cones) */
  drumsRequired: boolean;
  /** Number of flaggers required for this operation */
  flaggerCount: number;
  /** Where flaggers should be positioned */
  flaggerPositions: Array<{ location: string; purpose: string }>;
  /** Citations for each resolved value */
  citations: Record<string, {
    sourcePdf: string;
    page?: string | number;
    sectionTitle?: string;
    notes?: string;
  }>;
}

export type OperationType = "lane_closure" | "lane_shift" | "flagging" | "shoulder_work" | "full_closure";
export type TimeOfDay = "day" | "night";

export interface ResolveTcpRulesInput {
  speedMph: number;
  laneWidthFt?: number; // default = 12
  operation: OperationType;
  timeOfDay: TimeOfDay;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_LANE_WIDTH_FT = 12;

// Speed buckets for lookup - we'll use the closest lower speed
const SPEED_BUCKETS = [25, 30, 35, 40, 45, 50, 55];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find the closest speed bucket at or below the given speed
 */
function findSpeedBucket(speedMph: number): number {
  const clamped = Math.max(25, Math.min(55, speedMph));
  for (let i = SPEED_BUCKETS.length - 1; i >= 0; i--) {
    if (SPEED_BUCKETS[i] <= clamped) {
      return SPEED_BUCKETS[i];
    }
  }
  return SPEED_BUCKETS[0];
}

/**
 * Calculate taper length using MUTCD formula
 * - For speeds ≤ 40 mph: L = W × S
 * - For speeds > 40 mph: L = W × S² / 60
 * 
 * Where:
 *   L = taper length in feet
 *   W = lane width (typically 12 ft)
 *   S = speed limit in mph
 */
function calculateTaperLengthByFormula(speedMph: number, laneWidthFt: number): number {
  if (speedMph <= 40) {
    return laneWidthFt * speedMph;
  } else {
    return (laneWidthFt * speedMph * speedMph) / 60;
  }
}

/**
 * Get sign spacing from rules pack table
 * 
 * RULES (from extracted PDF):
 * - 25-30 mph → 100 ft
 * - 35-40 mph → 200-350 ft (use minimum 200 ft)
 * - 45-55 mph → 350-500 ft (use minimum 350 ft)
 */
function getSignSpacing(speedMph: number): { spacingFt: number; source: SourceCitation } {
  const bucket = findSpeedBucket(speedMph);
  const spacingData = rulesPack.spacing.bySpeedMph[bucket.toString() as keyof typeof rulesPack.spacing.bySpeedMph];
  
  if (spacingData) {
    return {
      spacingFt: spacingData.signSpacing_ft,
      source: spacingData.source as SourceCitation
    };
  }
  
  // Fallback: use formula-based spacing
  if (speedMph <= 30) {
    return { spacingFt: 100, source: { sourcePdf: "fallback", notes: "Using minimum spacing for low speed" } };
  } else if (speedMph <= 40) {
    return { spacingFt: 200, source: { sourcePdf: "fallback", notes: "Using minimum for 35-40mph range" } };
  } else {
    return { spacingFt: 350, source: { sourcePdf: "fallback", notes: "Using minimum for high speed" } };
  }
}

/**
 * Get taper length from rules pack table, falling back to formula if not available
 */
function getTaperLength(speedMph: number, laneWidthFt: number): { lengthFt: number; source: SourceCitation } {
  const bucket = findSpeedBucket(speedMph);
  const taperData = rulesPack.taper.laneClosure.bySpeedMph[bucket.toString() as keyof typeof rulesPack.taper.laneClosure.bySpeedMph];
  
  if (taperData && taperData.length_ft) {
    return {
      lengthFt: taperData.length_ft,
      source: taperData.source as SourceCitation
    };
  }
  
  // Use MUTCD formula
  const calculatedLength = calculateTaperLengthByFormula(speedMph, laneWidthFt);
  return {
    lengthFt: Math.round(calculatedLength),
    source: {
      sourcePdf: "mutcd11thedition.pdf",
      sectionTitle: "6C.08",
      notes: speedMph <= 40 
        ? `Calculated using L = W × S formula (${laneWidthFt} × ${speedMph} = ${calculatedLength})`
        : `Calculated using L = W × S²/60 formula (${laneWidthFt} × ${speedMph}² / 60 = ${calculatedLength})`
    }
  };
}

/**
 * Get cone spacing from rules pack
 * Default rule: coneSpacingFt = speedMph (with half-spacing stub for future)
 */
function getConeSpacing(speedMph: number): { spacingFt: number; source: SourceCitation } {
  const bucket = findSpeedBucket(speedMph);
  const spacingData = rulesPack.spacing.bySpeedMph[bucket.toString() as keyof typeof rulesPack.spacing.bySpeedMph];
  
  if (spacingData && spacingData.coneSpacing_ft) {
    return {
      spacingFt: spacingData.coneSpacing_ft,
      source: spacingData.source as SourceCitation
    };
  }
  
  // Fallback: use speed as spacing (S feet rule)
  return {
    spacingFt: speedMph,
    source: {
      sourcePdf: "2025-TTCM_portland.pdf",
      sectionTitle: "2.3 Channelizing Devices",
      notes: "Default S feet spacing rule (future: ½S when conflicting with pavement markings)"
    }
  };
}

/**
 * Get buffer length from rules pack
 */
function getBufferLength(speedMph: number): { lengthFt: number; source: SourceCitation } {
  const bucket = findSpeedBucket(speedMph);
  const spacingData = rulesPack.spacing.bySpeedMph[bucket.toString() as keyof typeof rulesPack.spacing.bySpeedMph];
  
  if (spacingData && spacingData.bufferLength_ft) {
    return {
      lengthFt: spacingData.bufferLength_ft,
      source: spacingData.source as SourceCitation
    };
  }
  
  // Fallback: estimate buffer as speed × 2
  return {
    lengthFt: speedMph * 2,
    source: { sourcePdf: "fallback", notes: "Estimated buffer length" }
  };
}

/**
 * Determine if drums are required instead of cones
 */
function getDrumsRequired(speedMph: number, timeOfDay: TimeOfDay): { required: boolean; source: SourceCitation } {
  const bucket = findSpeedBucket(speedMph);
  const taperData = rulesPack.taper.laneClosure.bySpeedMph[bucket.toString() as keyof typeof rulesPack.taper.laneClosure.bySpeedMph];
  
  // Drums required for:
  // 1. Merge tapers on high-speed streets (35mph+)
  // 2. Overnight lane closures at 30mph+
  const isHighSpeed = speedMph >= 35;
  const isNightHighSpeed = timeOfDay === "night" && speedMph >= 30;
  
  if (taperData && taperData.drumRequired) {
    return {
      required: true,
      source: taperData.source as SourceCitation
    };
  }
  
  if (isHighSpeed || isNightHighSpeed) {
    return {
      required: true,
      source: {
        sourcePdf: "2025-TTCM_portland.pdf",
        page: "17",
        sectionTitle: "2.3.3 Plastic Drums",
        notes: isNightHighSpeed 
          ? "Drums required for overnight closures at 30mph+" 
          : "Drums required for high-speed streets (35mph+)"
      }
    };
  }
  
  return {
    required: false,
    source: {
      sourcePdf: "2025-TTCM_portland.pdf",
      sectionTitle: "2.3 Channelizing Devices"
    }
  };
}

/**
 * Get required signs based on operation type
 * Returns signs in upstream → downstream order
 */
function getRequiredSigns(operation: OperationType): { signs: string[]; source: SourceCitation } {
  switch (operation) {
    case "lane_closure":
      return {
        signs: ["ROAD_WORK_AHEAD", "BE_PREPARED_TO_STOP"],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          sectionTitle: "4.7 Lane Closures",
          notes: "Standard lane closure signs"
        }
      };
    
    case "flagging":
      return {
        signs: ["ROAD_WORK_AHEAD", "BE_PREPARED_TO_STOP", "FLAGGER_AHEAD"],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          page: "28",
          sectionTitle: "3.5 Flagging Signs & Equipment",
          notes: "FLAGGER_AHEAD only when flagging operation is active"
        }
      };
    
    case "lane_shift":
      return {
        signs: ["ROAD_WORK_AHEAD"],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          sectionTitle: "4.1 General Design Considerations"
        }
      };
    
    case "shoulder_work":
      return {
        signs: ["ROAD_WORK_AHEAD"],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          sectionTitle: "4.1 General Design Considerations"
        }
      };
    
    case "full_closure":
      return {
        signs: ["ROAD_WORK_AHEAD", "ROAD_CLOSED", "DETOUR"],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          page: "42",
          sectionTitle: "4.7 Lane Closures and Detours"
        }
      };
    
    default:
      return {
        signs: ["ROAD_WORK_AHEAD"],
        source: { sourcePdf: "fallback", notes: "Default sign set" }
      };
  }
}

/**
 * Determine flagger requirements based on operation type
 * Returns count and positioning guidance
 */
function getFlaggerRequirements(operation: OperationType, speedMph: number): { 
  count: number; 
  positions: Array<{ location: string; purpose: string }>;
  source: SourceCitation;
} {
  switch (operation) {
    case "flagging":
      // One-lane two-way operations require 2 flaggers (one each end)
      return {
        count: 2,
        positions: [
          { location: "upstream_approach", purpose: "Control traffic entering work zone" },
          { location: "downstream_approach", purpose: "Control traffic from opposite direction" }
        ],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          page: "28",
          sectionTitle: "3.5 Flagging Signs & Equipment",
          notes: "One flagger per approach recommended for one-lane two-way operations"
        }
      };
    
    case "lane_closure":
      // Lane closures on higher speed roads may need flaggers for traffic control
      if (speedMph >= 40) {
        return {
          count: 1,
          positions: [
            { location: "taper_upstream", purpose: "Guide traffic through lane merge" }
          ],
          source: {
            sourcePdf: "2025-TTCM_portland.pdf",
            sectionTitle: "4.7 Lane Closures",
            notes: "Flagger recommended for high-speed lane closures to assist merging traffic"
          }
        };
      }
      // Lower speed lane closures may not need flaggers
      return {
        count: 0,
        positions: [],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          sectionTitle: "4.7 Lane Closures",
          notes: "Flaggers optional for low-speed lane closures with clear signage"
        }
      };
    
    case "full_closure":
      // Full closures typically need flaggers to direct detour traffic
      return {
        count: 1,
        positions: [
          { location: "closure_point", purpose: "Direct traffic to detour route" }
        ],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          page: "42",
          sectionTitle: "4.7 Lane Closures and Detours",
          notes: "Flagger recommended at closure point to direct detour traffic"
        }
      };
    
    case "shoulder_work":
    case "lane_shift":
    default:
      // These operations typically don't require flaggers
      return {
        count: 0,
        positions: [],
        source: {
          sourcePdf: "2025-TTCM_portland.pdf",
          sectionTitle: "4.1 General Design Considerations",
          notes: "Flaggers not typically required for this operation type"
        }
      };
  }
}

// =============================================================================
// MAIN RESOLVER
// =============================================================================

/**
 * Resolve TCP rules from the rules pack based on job inputs.
 * This is the SINGLE SOURCE OF TRUTH for placement values.
 * 
 * @param input - Job parameters (speed, lane width, operation type, time of day)
 * @returns Resolved numeric values with citations
 * 
 * @example
 * ```ts
 * const rules = resolveTcpRules({
 *   speedMph: 35,
 *   laneWidthFt: 12,
 *   operation: "lane_closure",
 *   timeOfDay: "day"
 * });
 * // rules.signSpacingFt = 200
 * // rules.taperLengthFt = 180
 * // rules.coneSpacingFt = 35
 * ```
 */
export function resolveTcpRules(input: ResolveTcpRulesInput): ResolvedTcpRules {
  const { speedMph, operation, timeOfDay } = input;
  const laneWidthFt = input.laneWidthFt ?? DEFAULT_LANE_WIDTH_FT;
  
  // Resolve each value from rules pack
  const signSpacing = getSignSpacing(speedMph);
  const taperLength = getTaperLength(speedMph, laneWidthFt);
  const coneSpacing = getConeSpacing(speedMph);
  const bufferLength = getBufferLength(speedMph);
  const drumsRequired = getDrumsRequired(speedMph, timeOfDay);
  const requiredSigns = getRequiredSigns(operation);
  const flaggerRequirements = getFlaggerRequirements(operation, speedMph);
  
  const resolved: ResolvedTcpRules = {
    signSpacingFt: signSpacing.spacingFt,
    taperLengthFt: taperLength.lengthFt,
    coneSpacingFt: coneSpacing.spacingFt,
    bufferLengthFt: bufferLength.lengthFt,
    drumsRequired: drumsRequired.required,
    requiredSigns: requiredSigns.signs,
    flaggerCount: flaggerRequirements.count,
    flaggerPositions: flaggerRequirements.positions,
    citations: {
      signSpacing: signSpacing.source,
      taperLength: taperLength.source,
      coneSpacing: coneSpacing.source,
      bufferLength: bufferLength.source,
      drumsRequired: drumsRequired.source,
      requiredSigns: requiredSigns.source,
      flaggers: flaggerRequirements.source,
    }
  };
  
  // DEV-ONLY: Log resolved rules
  console.log(
    `[RULES_USED] signSpacing=${resolved.signSpacingFt}ft ` +
    `taperLength=${resolved.taperLengthFt}ft ` +
    `coneSpacing=${resolved.coneSpacingFt}ft ` +
    `buffer=${resolved.bufferLengthFt}ft ` +
    `drums=${resolved.drumsRequired} ` +
    `flaggers=${resolved.flaggerCount}`
  );
  
  // DEV-ONLY: Expose globally for QA
  if (typeof window !== "undefined") {
    (window as unknown as { __tcpRulesDebug: ResolvedTcpRules }).__tcpRulesDebug = resolved;
  }
  
  return resolved;
}

// =============================================================================
// VALIDATION / TEST HELPERS
// =============================================================================

/**
 * Validate that resolved rules match expected values.
 * These are inline assertions for development QA.
 */
export function validateRulesResolution(): { passed: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Case A: speed = 35 mph, laneWidth = 12 → Expected taperLength = 180 ft (table override)
  const caseA = resolveTcpRules({ speedMph: 35, laneWidthFt: 12, operation: "lane_closure", timeOfDay: "day" });
  if (caseA.taperLengthFt !== 180) {
    errors.push(`Case A: Expected taperLength=180, got ${caseA.taperLengthFt}`);
  }
  if (caseA.signSpacingFt !== 200) {
    errors.push(`Case A: Expected signSpacing=200, got ${caseA.signSpacingFt}`);
  }
  
  // Case B: speed = 25 mph → Expected signSpacing = 100 ft
  const caseB = resolveTcpRules({ speedMph: 25, operation: "lane_closure", timeOfDay: "day" });
  if (caseB.signSpacingFt !== 100) {
    errors.push(`Case B: Expected signSpacing=100, got ${caseB.signSpacingFt}`);
  }
  
  // Case C: speed = 45 mph → Expected taperLength uses table (405) OR S²/60 formula
  const caseC = resolveTcpRules({ speedMph: 45, laneWidthFt: 12, operation: "lane_closure", timeOfDay: "day" });
  // Table value is 405, formula would be 12 * 45² / 60 = 405 (they match!)
  if (caseC.taperLengthFt !== 405) {
    errors.push(`Case C: Expected taperLength=405, got ${caseC.taperLengthFt}`);
  }
  if (caseC.signSpacingFt !== 350) {
    errors.push(`Case C: Expected signSpacing=350, got ${caseC.signSpacingFt}`);
  }
  
  // Case D: flagging operation should include FLAGGER_AHEAD
  const caseD = resolveTcpRules({ speedMph: 35, operation: "flagging", timeOfDay: "day" });
  if (!caseD.requiredSigns.includes("FLAGGER_AHEAD")) {
    errors.push(`Case D: Expected FLAGGER_AHEAD in requiredSigns, got ${caseD.requiredSigns.join(",")}`);
  }
  
  // Case E: night + 30mph should require drums
  const caseE = resolveTcpRules({ speedMph: 30, operation: "lane_closure", timeOfDay: "night" });
  if (!caseE.drumsRequired) {
    errors.push(`Case E: Expected drumsRequired=true for night ops at 30mph`);
  }
  
  const passed = errors.length === 0;
  
  if (passed) {
    console.log("[RULES_VALIDATION] ✅ All test cases passed");
  } else {
    console.error("[RULES_VALIDATION] ❌ Validation failed:", errors);
  }
  
  return { passed, errors };
}

/**
 * Get the speed bucket used for a given speed (for debugging)
 */
export function getSpeedBucketForDebug(speedMph: number): number {
  return findSpeedBucket(speedMph);
}

// =============================================================================
// DEV-ONLY: RUN VALIDATION ON MODULE LOAD
// =============================================================================

// Run validation in development mode
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  // Delay validation slightly to not block initial render
  setTimeout(() => {
    console.log("[TCP_RULES] Running rules validation...");
    validateRulesResolution();
  }, 1000);
}

