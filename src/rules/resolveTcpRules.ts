/**
 * TCP Rules Resolver
 * 
 * DEPRECATED: This file is superseded by lib/rules/engine.ts
 * 
 * The new rules engine uses correct MUTCD 11th Edition / OTTCH 2026 formulas.
 * 
 * CRITICAL: The old formulas were INVERTED:
 *   - OLD (WRONG): L = W × S for ≤40 mph, L = W × S²/60 for >40 mph
 *   - CORRECT: L = W × S²/60 for ≤40 mph, L = W × S for ≥45 mph
 * 
 * All new code should use RulesEngine from lib/rules/engine.ts
 */

// Re-export from new location for backward compatibility
export { RulesEngine } from "@/lib/rules/engine";
export type { SiteFacts, Computation, ComputedValue } from "@/lib/rules/engine";

// Legacy types kept for backward compatibility with any code that imports them
import type { SourceCitation } from "./rulesTypes";
export type { SourceCitation } from "./rulesTypes";

export interface ResolvedTcpRules {
  signSpacingFt: number;
  taperLengthFt: number;
  coneSpacingFt: number;
  requiredSigns: string[];
  bufferLengthFt: number;
  drumsRequired: boolean;
  flaggerCount: number;
  flaggerPositions: Array<{ location: string; purpose: string }>;
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
  laneWidthFt?: number;
  operation: OperationType;
  timeOfDay: TimeOfDay;
}

/**
 * @deprecated Use RulesEngine from lib/rules/engine.ts instead.
 * This function uses the OLD INCORRECT formulas.
 */
export function resolveTcpRules(_input: ResolveTcpRulesInput): ResolvedTcpRules {
  console.warn(
    "[DEPRECATED] resolveTcpRules() uses incorrect formulas. " +
    "Use RulesEngine from lib/rules/engine.ts instead."
  );
  
  throw new Error(
    "resolveTcpRules() is deprecated. The old taper formulas were INVERTED. " +
    "Use RulesEngine from lib/rules/engine.ts which has the correct MUTCD 11th Edition formulas."
  );
}
