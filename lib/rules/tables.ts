/**
 * MUTCD 11th Edition and OTTCH 2026 table data.
 * 
 * All values are quoted directly from official sources.
 * Source citations are included for each table.
 */

export const RULES_PACK_VERSION = "mutcd11e+ottch2026.1";

// =============================================================================
// MUTCD 11th Edition Tables
// =============================================================================

// Table 6B-1: Recommended Advance Warning Sign Minimum Spacing
export const MUTCD_6B_1: Record<string, { A: number; B: number; C: number }> = {
  urban_low_speed: { A: 100, B: 100, C: 100 },
  urban_high_speed: { A: 350, B: 350, C: 350 },
  rural: { A: 500, B: 500, C: 500 },
  expressway_freeway: { A: 1000, B: 1500, C: 2640 },
};

// Table 6B-2: Stopping Sight Distance as a Function of Speed
export const MUTCD_6B_2: Record<number, number> = {
  20: 115,
  25: 155,
  30: 200,
  35: 250,
  40: 305,
  45: 360,
  50: 425,
  55: 495,
  60: 570,
  65: 645,
  70: 730,
  75: 820,
};

// Table 6B-3: One-lane two-way taper (50-100 ft, not L formula)
export const ONE_LANE_TWO_WAY_TAPER = { min_ft: 50, max_ft: 100 };

// =============================================================================
// OTTCH 2026 Tables
// =============================================================================

// Table 2-4: Buffer space by speed
export const OTTCH_2_4_BUFFER: Record<number, number> = {
  20: 50,
  25: 75,
  30: 100,
  35: 125,
  40: 150,
  45: 180,
  50: 210,
  55: 250,
  60: 285,
  65: 325,
  70: 365,
};

// Table 2-4: Sign spacing by road context
export const OTTCH_2_4_SIGN_SPACING: Record<string, { A: number; B: number; C: number }> = {
  urban_low_speed: { A: 100, B: 100, C: 100 },
  urban_high_speed: { A: 350, B: 350, C: 350 },
  rural: { A: 500, B: 500, C: 500 },
  expressway_freeway: { A: 1000, B: 1500, C: 2640 },
};

// Table 2-3: Merging taper lengths at 12ft lane width (for reference, not used in one-lane two-way)
export const OTTCH_2_3_12FT: Record<number, { merging_L_ft: number; shifting_L_2_ft: number }> = {
  20: { merging_L_ft: 80, shifting_L_2_ft: 40 },
  25: { merging_L_ft: 125, shifting_L_2_ft: 65 },
  30: { merging_L_ft: 180, shifting_L_2_ft: 90 },
  35: { merging_L_ft: 245, shifting_L_2_ft: 125 },
  40: { merging_L_ft: 320, shifting_L_2_ft: 160 },
  45: { merging_L_ft: 540, shifting_L_2_ft: 270 },
  50: { merging_L_ft: 600, shifting_L_2_ft: 300 },
  55: { merging_L_ft: 660, shifting_L_2_ft: 330 },
  60: { merging_L_ft: 720, shifting_L_2_ft: 360 },
  65: { merging_L_ft: 780, shifting_L_2_ft: 390 },
  70: { merging_L_ft: 840, shifting_L_2_ft: 420 },
};

// =============================================================================
// Diagram 320 Warrants
// =============================================================================

export const TWO_FLAGGER_CONDITIONS = {
  is_night: true,
  work_space_over_ft: 200,
  sight_distance_less_than_ft: 750,
  adt_greater_than: 400,
};

export const MAX_W20_7_SPACING_MI = 1.0;

// =============================================================================
// Device Spacing
// =============================================================================

export const ONE_LANE_TWO_WAY_TAPER_SPACING_FT = 20;
export const ONE_LANE_TWO_WAY_TAPER_CONES_MIN = 4;
export const ONE_LANE_TWO_WAY_TAPER_CONES_MAX = 6;

/**
 * Compute merging taper length L using MUTCD Table 6B-4 / OTTCH Table 2-1.
 * 
 * CORRECT FORMULAS:
 * - 40 mph or less: L = W × S² / 60
 * - 45 mph or more: L = W × S
 */
export function computeMergingTaperL(speedMph: number, laneWidthFt: number): number {
  if (speedMph <= 40) {
    return (laneWidthFt * speedMph * speedMph) / 60;
  } else {
    return laneWidthFt * speedMph;
  }
}
