/**
 * Deterministic Rules Engine for TCP (TypeScript version)
 * 
 * Mirrors the Python backend engine for client-side use.
 * ALL numeric values come from tables, never from LLM.
 * 
 * SCOPE (Phase 1): MUTCD Figure 6P-10 / OTTCH Diagram 320
 * Two-lane two-way flagger closure only.
 */

import {
  MUTCD_6B_1,
  MUTCD_6B_2,
  OTTCH_2_4_BUFFER,
  OTTCH_2_4_SIGN_SPACING,
  TWO_FLAGGER_CONDITIONS,
  MAX_W20_7_SPACING_MI,
  ONE_LANE_TWO_WAY_TAPER_SPACING_FT,
  ONE_LANE_TWO_WAY_TAPER_CONES_MIN,
  ONE_LANE_TWO_WAY_TAPER_CONES_MAX,
} from "./tables";

export interface Citation {
  source_doc: string;
  source_ref: string;
  source_url: string;
  notes?: string;
}

export interface ComputedValue {
  value: number | string;
  unit: string | null;
  formula: string | null;
  citation: Citation;
}

export interface SignSpec {
  mutcd_code: string;
  name: string;
  sequence_order: number;
  purpose: string;
  required: boolean;
  citation: Citation;
}

export interface SiteFacts {
  posted_or_statutory_speed_mph: number;
  speed_basis?: "posted" | "off_peak_85th" | "anticipated";
  road_context?: "urban_low_speed" | "urban_high_speed" | "rural" | "expressway_freeway";
  lane_count?: number;
  opposing_directions?: boolean;
  lane_width_ft?: number;
  shoulder_width_ft?: number | null;
  work_length_ft?: number;
  duration_days?: number;
  is_night?: boolean;
  sight_distance_ft?: number | null;
  adt?: number | null;
  control_method?: "flaggers" | "afad" | "pilot_car" | "self_regulating" | "signal";
  approach_count?: number;
  rail_crossing_within_influence?: boolean;
  jurisdiction?: string;
  uses_ottch_short_term?: boolean;
}

export interface Computation {
  layout_family: string;
  rules_pack_version: string;
  sign_sequence: SignSpec[];
  spacing_A_ft: ComputedValue;
  spacing_B_ft: ComputedValue;
  spacing_C_ft: ComputedValue;
  taper_type: string;
  taper_length_ft: ComputedValue;
  downstream_taper_length_ft: ComputedValue;
  taper_device_spacing_ft: ComputedValue;
  tangent_device_spacing_ft: ComputedValue;
  buffer_length_ft: ComputedValue;
  mutcd_ssd_ft: ComputedValue;
  flagger_count: ComputedValue;
  flagger_station_notes: string[];
  cones_per_taper: ComputedValue;
  cones_tangent: ComputedValue;
  signs_count: number;
  arrow_board_required: boolean;
  arrow_board_mode: string | null;
  refused_reasons: string[];
}

const RULES_PACK_VERSION = "mutcd11e+ottch2026.1";

export class RulesEngine {
  readonly LAYOUT_FAMILY = "ottch_320_mutcd_ta10";
  readonly version = RULES_PACK_VERSION;

  compute(facts: SiteFacts): Computation {
    const refused = this.checkScope(facts);
    if (refused.length > 0) {
      return this.createRefusedComputation(refused);
    }

    const spacing = this.getSignSpacing(facts);
    const buffer = this.getBufferLength(facts);
    const mutcd_ssd = this.getMUTCDSSD(facts.posted_or_statutory_speed_mph);
    const taper = this.getOneLaneTwoWayTaper();
    const taper_spacing = this.getTaperDeviceSpacing();
    const tangent_spacing = this.getTangentDeviceSpacing(facts);
    const [flagger_count, flagger_notes] = this.getFlaggerRequirements(facts);
    const cones_taper = this.getTaperConeCount();
    const cones_tangent = this.getTangentConeCount(facts, buffer);
    const sign_sequence = this.getSignSequence(facts);

    return {
      layout_family: this.LAYOUT_FAMILY,
      rules_pack_version: this.version,
      sign_sequence,
      spacing_A_ft: spacing.A,
      spacing_B_ft: spacing.B,
      spacing_C_ft: spacing.C,
      taper_type: "one_lane_two_way",
      taper_length_ft: taper,
      downstream_taper_length_ft: taper,
      taper_device_spacing_ft: taper_spacing,
      tangent_device_spacing_ft: tangent_spacing,
      buffer_length_ft: buffer,
      mutcd_ssd_ft: mutcd_ssd,
      flagger_count,
      flagger_station_notes: flagger_notes,
      cones_per_taper: cones_taper,
      cones_tangent,
      signs_count: sign_sequence.filter(s => s.required).length,
      arrow_board_required: false,
      arrow_board_mode: facts.posted_or_statutory_speed_mph >= 45 ? "caution" : null,
      refused_reasons: [],
    };
  }

  private checkScope(facts: SiteFacts): string[] {
    const refused: string[] = [];
    const speed = facts.posted_or_statutory_speed_mph;

    if ((facts.lane_count ?? 2) !== 2 || facts.opposing_directions === false) {
      refused.push("Phase 1 only supports two-lane, two-way roads");
    }

    if (facts.control_method && facts.control_method !== "flaggers") {
      refused.push(`Phase 1 only supports flagger control (got ${facts.control_method})`);
    }

    if (facts.uses_ottch_short_term === false) {
      refused.push("Phase 1 only supports OTTCH short-term (3 days or less)");
    }

    if ((facts.duration_days ?? 1) > 3) {
      refused.push(`Duration ${facts.duration_days} days exceeds 3-day OTTCH limit`);
    }

    if (facts.road_context === "expressway_freeway") {
      refused.push("Freeway/expressway not supported in Phase 1");
    }

    if (facts.rail_crossing_within_influence) {
      refused.push("Rail crossing within influence zone requires special handling");
    }

    if ((facts.work_length_ft ?? 0) > MAX_W20_7_SPACING_MI * 5280) {
      refused.push(
        `Work length ${facts.work_length_ft} ft exceeds 1-mile W20-7 limit; use Diagram 340 (pilot car)`
      );
    }

    if (speed < 20 || speed > 70) {
      refused.push(`Speed ${speed} mph outside supported range (20-70)`);
    }

    if (speed >= 41 && speed <= 44) {
      refused.push(
        `Speed ${speed} mph is between formula thresholds (40 or less / 45 or more); use the posted/statutory value`
      );
    }

    return refused;
  }

  private getSignSpacing(facts: SiteFacts): { A: ComputedValue; B: ComputedValue; C: ComputedValue } {
    const roadCtx = facts.road_context ?? "rural";
    const usesOttch = facts.uses_ottch_short_term !== false && (facts.jurisdiction ?? "OR") === "OR";

    let spacingTable: { A: number; B: number; C: number };
    let citation: Citation;

    if (usesOttch && OTTCH_2_4_SIGN_SPACING[roadCtx]) {
      spacingTable = OTTCH_2_4_SIGN_SPACING[roadCtx];
      citation = {
        source_doc: "OTTCH 2026",
        source_ref: "Table 2-4",
        source_url: "https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
        notes: `Sign spacing for ${roadCtx}`,
      };
    } else {
      spacingTable = MUTCD_6B_1[roadCtx] || MUTCD_6B_1.rural;
      citation = {
        source_doc: "MUTCD 11th Edition",
        source_ref: "Table 6B-1",
        source_url: "https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
        notes: `Sign spacing for ${roadCtx}`,
      };
    }

    return {
      A: { value: spacingTable.A, unit: "ft", formula: null, citation },
      B: { value: spacingTable.B, unit: "ft", formula: null, citation },
      C: { value: spacingTable.C, unit: "ft", formula: null, citation },
    };
  }

  private getBufferLength(facts: SiteFacts): ComputedValue {
    const speed = facts.posted_or_statutory_speed_mph;
    const speeds = Object.keys(OTTCH_2_4_BUFFER).map(Number).sort((a, b) => a - b);
    
    let buffer: number;
    if (OTTCH_2_4_BUFFER[speed] !== undefined) {
      buffer = OTTCH_2_4_BUFFER[speed];
    } else {
      const lower = speeds.filter(s => s <= speed);
      const upper = speeds.filter(s => s >= speed);
      if (lower.length && upper.length) {
        const lo = Math.max(...lower);
        const hi = Math.min(...upper);
        const ratio = (speed - lo) / (hi - lo);
        buffer = Math.round(OTTCH_2_4_BUFFER[lo] + ratio * (OTTCH_2_4_BUFFER[hi] - OTTCH_2_4_BUFFER[lo]));
      } else {
        buffer = OTTCH_2_4_BUFFER[speeds[0]];
      }
    }

    return {
      value: buffer,
      unit: "ft",
      formula: null,
      citation: {
        source_doc: "OTTCH 2026",
        source_ref: "Table 2-4",
        source_url: "https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
        notes: `Buffer space at ${speed} mph`,
      },
    };
  }

  private getMUTCDSSD(speed: number): ComputedValue {
    const speeds = Object.keys(MUTCD_6B_2).map(Number);
    const closest = speeds.reduce((a, b) => Math.abs(b - speed) < Math.abs(a - speed) ? b : a);
    
    return {
      value: MUTCD_6B_2[closest],
      unit: "ft",
      formula: null,
      citation: {
        source_doc: "MUTCD 11th Edition",
        source_ref: "Table 6B-2",
        source_url: "https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
        notes: `Stopping sight distance at ${speed} mph (federal reference)`,
      },
    };
  }

  private getOneLaneTwoWayTaper(): ComputedValue {
    return {
      value: 75,
      unit: "ft",
      formula: "50-100 ft range (not L formula)",
      citation: {
        source_doc: "MUTCD 11th Edition",
        source_ref: "Table 6B-3, Section 6B.08 para 14",
        source_url: "https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
        notes: "One-lane two-way taper: 50 ft min, 100 ft max; 20 ft device spacing",
      },
    };
  }

  private getTaperDeviceSpacing(): ComputedValue {
    return {
      value: ONE_LANE_TWO_WAY_TAPER_SPACING_FT,
      unit: "ft",
      formula: null,
      citation: {
        source_doc: "OTTCH 2026",
        source_ref: "Section 2.3",
        source_url: "https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
        notes: "One-lane two-way taper: 20 ft spacing",
      },
    };
  }

  private getTangentDeviceSpacing(facts: SiteFacts): ComputedValue {
    const spacing = facts.posted_or_statutory_speed_mph * 2;
    return {
      value: spacing,
      unit: "ft",
      formula: `2 × ${facts.posted_or_statutory_speed_mph} mph`,
      citation: {
        source_doc: "MUTCD 11th Edition",
        source_ref: "Section 6K.01 para 04",
        source_url: "https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
        notes: "Tangent spacing ≤ 2×S",
      },
    };
  }

  private getFlaggerRequirements(facts: SiteFacts): [ComputedValue, string[]] {
    const notes: string[] = [];
    let twoFlaggers = false;

    if (facts.is_night) {
      twoFlaggers = true;
      notes.push("Night operations: two-approach flagging required");
    }

    if ((facts.work_length_ft ?? 0) > TWO_FLAGGER_CONDITIONS.work_space_over_ft) {
      twoFlaggers = true;
      notes.push(`Work space ${facts.work_length_ft} ft > 200 ft: two-approach flagging required`);
    }

    if (facts.sight_distance_ft !== null && facts.sight_distance_ft !== undefined) {
      if (facts.sight_distance_ft < TWO_FLAGGER_CONDITIONS.sight_distance_less_than_ft) {
        twoFlaggers = true;
        notes.push(`Sight distance ${facts.sight_distance_ft} ft < 750 ft: two-approach flagging required`);
      }
    }

    if (facts.adt !== null && facts.adt !== undefined && facts.adt > TWO_FLAGGER_CONDITIONS.adt_greater_than) {
      twoFlaggers = true;
      notes.push(`ADT ${facts.adt} > 400: two-approach flagging required`);
    }

    if (notes.length === 0) {
      notes.push("Single flagger permitted: daytime, work space ≤ 200 ft, sight distance ≥ 750 ft, ADT ≤ 400");
    }

    return [
      {
        value: twoFlaggers ? 2 : 1,
        unit: null,
        formula: null,
        citation: {
          source_doc: "OTTCH 2026",
          source_ref: "Diagram 320 notes",
          source_url: "https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
          notes: "Diagram 320 note 4 conditions",
        },
      },
      notes,
    ];
  }

  private getTaperConeCount(): ComputedValue {
    return {
      value: 5,
      unit: null,
      formula: `${ONE_LANE_TWO_WAY_TAPER_CONES_MIN}-${ONE_LANE_TWO_WAY_TAPER_CONES_MAX} cones`,
      citation: {
        source_doc: "OTTCH 2026",
        source_ref: "Section 2.3",
        source_url: "https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
        notes: "One-lane two-way taper: 4-6 cones at 20 ft spacing",
      },
    };
  }

  private getTangentConeCount(facts: SiteFacts, buffer: ComputedValue): ComputedValue {
    const tangentLength = (buffer.value as number) + (facts.work_length_ft ?? 100);
    const spacing = facts.posted_or_statutory_speed_mph * 2;
    const count = Math.max(1, Math.floor(tangentLength / spacing) + 1);

    return {
      value: count,
      unit: null,
      formula: `(${buffer.value} + ${facts.work_length_ft ?? 100}) / ${spacing}`,
      citation: {
        source_doc: "MUTCD 11th Edition",
        source_ref: "Section 6K.01 para 04",
        source_url: "https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
        notes: "Tangent cones at 2×S spacing",
      },
    };
  }

  private getSignSequence(facts: SiteFacts): SignSpec[] {
    const baseCitation: Citation = {
      source_doc: "MUTCD 11th Edition",
      source_ref: "Figure 6P-10",
      source_url: "https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
      notes: "Lane Closure on Two-Lane Road Using Flaggers",
    };

    return [
      {
        mutcd_code: "W20-1",
        name: "ROAD WORK",
        sequence_order: 1,
        purpose: "Advance warning",
        required: true,
        citation: baseCitation,
      },
      {
        mutcd_code: "W20-4",
        name: "ONE LANE ROAD",
        sequence_order: 2,
        purpose: "Lane configuration warning",
        required: facts.posted_or_statutory_speed_mph >= 35 || (facts.adt ?? 0) > 400,
        citation: {
          source_doc: "OTTCH 2026",
          source_ref: "Section 3.6",
          source_url: "https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
          notes: "Optional; consider on high-volume or high-speed roads",
        },
      },
      {
        mutcd_code: "W20-7",
        name: "FLAGGER",
        sequence_order: 3,
        purpose: "Flagger station warning",
        required: true,
        citation: baseCitation,
      },
      {
        mutcd_code: "W3-4",
        name: "BE PREPARED TO STOP",
        sequence_order: 4,
        purpose: "Stopping warning",
        required: false,
        citation: {
          source_doc: "MUTCD 11th Edition",
          source_ref: "Figure 6P-10 notes",
          source_url: "https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
          notes: "May be added",
        },
      },
    ];
  }

  private createRefusedComputation(reasons: string[]): Computation {
    const nullValue: ComputedValue = {
      value: 0,
      unit: null,
      formula: null,
      citation: {
        source_doc: "N/A",
        source_ref: "N/A",
        source_url: "",
        notes: "Computation refused",
      },
    };

    return {
      layout_family: this.LAYOUT_FAMILY,
      rules_pack_version: this.version,
      sign_sequence: [],
      spacing_A_ft: nullValue,
      spacing_B_ft: nullValue,
      spacing_C_ft: nullValue,
      taper_type: "one_lane_two_way",
      taper_length_ft: nullValue,
      downstream_taper_length_ft: nullValue,
      taper_device_spacing_ft: nullValue,
      tangent_device_spacing_ft: nullValue,
      buffer_length_ft: nullValue,
      mutcd_ssd_ft: nullValue,
      flagger_count: nullValue,
      flagger_station_notes: [],
      cones_per_taper: nullValue,
      cones_tangent: nullValue,
      signs_count: 0,
      arrow_board_required: false,
      arrow_board_mode: null,
      refused_reasons: reasons,
    };
  }
}
