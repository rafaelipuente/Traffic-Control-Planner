/**
 * Zone Proportion Calculator
 * 
 * Computes pixel heights for each TCP zone with:
 * - Minimum height guarantee per zone (adjustable floor)
 * - Proportional allocation of remaining space based on footage
 */

import {
  DiagramConfig,
  DiagramPlanData,
  DiagramJobData,
  ZoneProportions,
  SignSpacing,
  DEFAULT_DIAGRAM_CONFIG,
  MIN_ZONE_HEIGHT_FLOOR,
  ZONE_COUNT,
} from "./types";

/**
 * Calculate the total advance warning footage from sign spacing.
 * Sum of A + B + C distances.
 */
function calcAdvanceWarningFt(signSpacing: SignSpacing[]): number {
  return signSpacing.reduce((sum, s) => sum + s.distanceFt, 0);
}

/**
 * Compute zone proportions from plan and job data.
 * 
 * Algorithm:
 * 1. Reserve padding from total height
 * 2. Calculate effective minZoneHeight that fits all zones
 * 3. Allocate minHeight to each zone
 * 4. Distribute remaining height proportionally based on footage
 */
export function computeZoneProportions(
  plan: DiagramPlanData | undefined,
  job: DiagramJobData | undefined,
  config: DiagramConfig = DEFAULT_DIAGRAM_CONFIG
): ZoneProportions {
  // Available height after padding
  const availableHeight = config.height - config.paddingTop - config.paddingBottom;

  // Get footage values (use defaults for geometry-only state)
  const advanceWarningFt = plan 
    ? calcAdvanceWarningFt(plan.signSpacing) 
    : 600; // Default placeholder
  
  const taperFt = plan?.taperLengthFt ?? 180; // Default placeholder
  const bufferFt = plan?.bufferLengthFt ?? 100; // Default placeholder
  const workZoneFt = job?.workLengthFt ?? 500; // Default placeholder

  const totalFt = advanceWarningFt + taperFt + bufferFt + workZoneFt;

  // Calculate effective minZoneHeight
  // If minZoneHeight * zoneCount > availableHeight, reduce it (floor at MIN_ZONE_HEIGHT_FLOOR)
  let effectiveMinHeight = config.minZoneHeight;
  const requiredMinHeight = effectiveMinHeight * ZONE_COUNT;
  
  if (requiredMinHeight > availableHeight) {
    effectiveMinHeight = Math.max(
      Math.floor(availableHeight / ZONE_COUNT),
      MIN_ZONE_HEIGHT_FLOOR
    );
  }

  // Calculate minimum allocation
  const totalMinAllocation = effectiveMinHeight * ZONE_COUNT;
  
  // Remaining height to distribute proportionally
  const remainingHeight = Math.max(0, availableHeight - totalMinAllocation);

  // Calculate proportional additions based on footage
  const proportions = totalFt > 0
    ? {
        awa: advanceWarningFt / totalFt,
        taper: taperFt / totalFt,
        buffer: bufferFt / totalFt,
        workZone: workZoneFt / totalFt,
      }
    : {
        awa: 0.4,
        taper: 0.15,
        buffer: 0.15,
        workZone: 0.3,
      };

  // Final pixel heights = min + proportional
  const advanceWarningPx = Math.round(effectiveMinHeight + remainingHeight * proportions.awa);
  const taperPx = Math.round(effectiveMinHeight + remainingHeight * proportions.taper);
  const bufferPx = Math.round(effectiveMinHeight + remainingHeight * proportions.buffer);
  const workZonePx = Math.round(effectiveMinHeight + remainingHeight * proportions.workZone);

  // Ensure total matches available (handle rounding)
  const calculatedTotal = advanceWarningPx + taperPx + bufferPx + workZonePx;
  const adjustedWorkZonePx = workZonePx + (availableHeight - calculatedTotal);

  return {
    advanceWarningPx,
    taperPx,
    bufferPx,
    workZonePx: adjustedWorkZonePx,
    totalHeightPx: availableHeight,
    // Footage for labels
    advanceWarningFt,
    taperFt,
    bufferFt,
    workZoneFt,
  };
}

/**
 * Compute placeholder proportions for geometry-only state.
 * Uses equal distribution with generic footage values.
 */
export function computePlaceholderProportions(
  config: DiagramConfig = DEFAULT_DIAGRAM_CONFIG
): ZoneProportions {
  return computeZoneProportions(undefined, undefined, config);
}

/**
 * Get sign positions within the advance warning area.
 * Returns Y positions (from top of AWA) for signs A, B, C.
 */
export function getSignPositions(
  signSpacing: SignSpacing[],
  advanceWarningPx: number,
  advanceWarningFt: number
): { label: string; yOffset: number; distanceFt: number }[] {
  if (advanceWarningFt <= 0) return [];

  const scale = advanceWarningPx / advanceWarningFt;
  const positions: { label: string; yOffset: number; distanceFt: number }[] = [];
  
  // Sort by label to ensure consistent order (A, B, C from upstream to downstream)
  const sorted = [...signSpacing].sort((a, b) => a.label.localeCompare(b.label));
  
  let cumulative = 0;
  for (const sign of sorted) {
    // Position from top of AWA (upstream)
    const yOffset = cumulative * scale;
    positions.push({
      label: sign.label,
      yOffset,
      distanceFt: sign.distanceFt,
    });
    cumulative += sign.distanceFt;
  }

  return positions;
}

