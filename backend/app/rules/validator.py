"""
TCP Layout Validator

Validates AI-generated layouts against MUTCD 11th Edition Part 6 and OTTCH 2026 tables.
Uses the same table data as the rules engine (no duplication).

Each violation is a structured object with:
- rule_id: unique identifier for the rule
- severity: "error" or "warning"
- field_path: JSON path to the violated field
- expected: what the rule requires
- actual: what the layout specified
- citation: source citation (table/section reference)
"""
from dataclasses import dataclass, field, asdict
from decimal import Decimal
from typing import Dict, List, Optional, Any, Literal
from enum import Enum

from app.rules.tables import (
    MUTCD_6B_1, MUTCD_6B_1_CITATION,
    MUTCD_6B_2, MUTCD_6B_2_CITATION,
    MUTCD_6B_3, MUTCD_6B_3_CITATION,
    MUTCD_6B_4_CITATION,
    MUTCD_6K_01_CITATION,
    OTTCH_2_2, OTTCH_2_2_CITATION,
    OTTCH_2_3_12FT, OTTCH_2_3_CITATION,
    OTTCH_2_4_BUFFER, OTTCH_2_4_SIGN_SPACING, OTTCH_2_4_CITATION,
    OTTCH_320_WARRANTS_CITATION,
    OTTCH_DEVICE_SPACING_CITATION,
    TWO_FLAGGER_CONDITIONS,
    MAX_W20_7_SPACING_MI,
    ONE_LANE_TWO_WAY_TAPER_SPACING_FT,
    ONE_LANE_TWO_WAY_TAPER_CONES_MIN,
    ONE_LANE_TWO_WAY_TAPER_CONES_MAX,
    compute_merging_taper_L,
    get_one_lane_two_way_taper_length,
)


class Severity(str, Enum):
    error = "error"
    warning = "warning"


@dataclass
class Violation:
    """A validation rule violation."""
    rule_id: str
    severity: Severity
    field_path: str
    expected: str
    actual: str
    citation: str
    message: str
    
    def to_dict(self) -> Dict:
        return {
            "rule_id": self.rule_id,
            "severity": self.severity.value,
            "field_path": self.field_path,
            "expected": self.expected,
            "actual": self.actual,
            "citation": self.citation,
            "message": self.message,
        }


@dataclass
class ValidationResult:
    """Result of layout validation."""
    passed: bool
    violations: List[Violation] = field(default_factory=list)
    error_count: int = 0
    warning_count: int = 0
    
    def to_dict(self) -> Dict:
        return {
            "passed": self.passed,
            "violations": [v.to_dict() for v in self.violations],
            "error_count": self.error_count,
            "warning_count": self.warning_count,
        }


@dataclass
class LayoutInput:
    """Structured input representing an AI-generated TCP layout."""
    # Sign spacing
    spacing_A_ft: int
    spacing_B_ft: int
    spacing_C_ft: int
    
    # Taper
    taper_type: str  # "one_lane_two_way", "merging", "shifting", "shoulder", "downstream"
    taper_length_ft: int
    downstream_taper_length_ft: int
    taper_device_spacing_ft: int
    
    # Buffer and tangent
    buffer_length_ft: int
    tangent_device_spacing_ft: int
    
    # Flaggers
    flagger_count: int
    flagger_station_positions: List[str]
    
    # Devices
    sign_sequence: List[Dict[str, Any]]  # List of sign specs
    cone_count: int
    drum_count: int
    arrow_board_present: bool
    arrow_board_mode: Optional[str]  # "caution", "flashing", "sequential"
    
    # Assumptions the AI made
    assumptions: List[str] = field(default_factory=list)


@dataclass
class SiteContext:
    """Site facts needed for validation."""
    posted_speed_mph: int
    road_context: str  # "urban_low_speed", "urban_high_speed", "rural", "expressway_freeway"
    lane_count: int
    lane_width_ft: Decimal
    work_length_ft: Decimal
    is_night: bool
    sight_distance_ft: Optional[int]
    adt: Optional[int]
    uses_ottch_short_term: bool
    jurisdiction: str
    control_method: str  # "flaggers", "afad", "pilot_car"


class LayoutValidator:
    """
    Validates AI-generated TCP layouts against MUTCD and OTTCH rules.
    
    Each validation rule is a separate method for testability.
    """
    
    def validate(self, layout: LayoutInput, context: SiteContext) -> ValidationResult:
        """
        Validate a layout against all applicable rules.
        
        Returns ValidationResult with all violations found.
        """
        violations = []
        
        # Run all validation rules
        violations.extend(self._validate_taper_formula(layout, context))
        violations.extend(self._validate_taper_length_range(layout, context))
        violations.extend(self._validate_sign_spacing(layout, context))
        violations.extend(self._validate_buffer_length(layout, context))
        violations.extend(self._validate_channelizer_spacing(layout, context))
        violations.extend(self._validate_flagger_requirements(layout, context))
        violations.extend(self._validate_required_signs(layout, context))
        violations.extend(self._validate_device_counts(layout, context))
        violations.extend(self._validate_arrow_board(layout, context))
        violations.extend(self._validate_internal_consistency(layout, context))
        
        error_count = sum(1 for v in violations if v.severity == Severity.error)
        warning_count = sum(1 for v in violations if v.severity == Severity.warning)
        
        return ValidationResult(
            passed=error_count == 0,
            violations=violations,
            error_count=error_count,
            warning_count=warning_count,
        )
    
    def _validate_taper_formula(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """
        Validate taper length against MUTCD Table 6B-4 formulas.
        
        CORRECT FORMULAS:
        - 40 mph or less: L = W × S² / 60
        - 45 mph or more: L = W × S
        
        CRITICAL: The OLD code had these INVERTED. This test catches that bug.
        """
        violations = []
        
        # One-lane two-way tapers don't use the L formula
        if layout.taper_type in ("one_lane_two_way", "downstream"):
            return violations
        
        speed = context.posted_speed_mph
        W = context.lane_width_ft
        
        # Compute expected L using CORRECT formula
        expected_L = compute_merging_taper_L(speed, W)
        
        # Tolerance: 5% or 10 ft, whichever is larger
        tolerance = max(float(expected_L) * 0.05, 10)
        
        if layout.taper_type == "merging":
            # Merging taper must be at least L
            if layout.taper_length_ft < float(expected_L) - tolerance:
                violations.append(Violation(
                    rule_id="MUTCD-6B4-MERGING-MIN",
                    severity=Severity.error,
                    field_path="taper_length_ft",
                    expected=f">= {int(expected_L)} ft (L formula: {'WS²/60' if speed <= 40 else 'WS'})",
                    actual=f"{layout.taper_length_ft} ft",
                    citation=f"{MUTCD_6B_4_CITATION.source_doc} {MUTCD_6B_4_CITATION.source_ref}",
                    message=f"Merging taper at {speed} mph must be at least {int(expected_L)} ft",
                ))
        
        elif layout.taper_type == "shifting":
            # Shifting taper must be at least L/2
            expected_half = expected_L / 2
            if layout.taper_length_ft < float(expected_half) - tolerance:
                violations.append(Violation(
                    rule_id="MUTCD-6B3-SHIFTING-MIN",
                    severity=Severity.error,
                    field_path="taper_length_ft",
                    expected=f">= {int(expected_half)} ft (L/2)",
                    actual=f"{layout.taper_length_ft} ft",
                    citation=f"{MUTCD_6B_3_CITATION.source_doc} {MUTCD_6B_3_CITATION.source_ref}",
                    message=f"Shifting taper at {speed} mph must be at least {int(expected_half)} ft",
                ))
        
        elif layout.taper_type == "shoulder":
            # Shoulder taper must be at least L/3
            expected_third = expected_L / 3
            if layout.taper_length_ft < float(expected_third) - tolerance:
                violations.append(Violation(
                    rule_id="MUTCD-6B3-SHOULDER-MIN",
                    severity=Severity.error,
                    field_path="taper_length_ft",
                    expected=f">= {int(expected_third)} ft (L/3)",
                    actual=f"{layout.taper_length_ft} ft",
                    citation=f"{MUTCD_6B_3_CITATION.source_doc} {MUTCD_6B_3_CITATION.source_ref}",
                    message=f"Shoulder taper at {speed} mph must be at least {int(expected_third)} ft",
                ))
        
        return violations
    
    def _validate_taper_length_range(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Validate one-lane two-way and downstream tapers are in 50-100 ft range."""
        violations = []
        
        taper_range = get_one_lane_two_way_taper_length()
        min_ft, max_ft = taper_range["min_ft"], taper_range["max_ft"]
        
        if layout.taper_type == "one_lane_two_way":
            if layout.taper_length_ft < min_ft or layout.taper_length_ft > max_ft:
                violations.append(Violation(
                    rule_id="MUTCD-6B3-ONE-LANE-RANGE",
                    severity=Severity.error,
                    field_path="taper_length_ft",
                    expected=f"{min_ft}-{max_ft} ft",
                    actual=f"{layout.taper_length_ft} ft",
                    citation=f"{MUTCD_6B_3_CITATION.source_doc} {MUTCD_6B_3_CITATION.source_ref}",
                    message=f"One-lane two-way taper must be {min_ft}-{max_ft} ft, not L formula",
                ))
        
        if layout.taper_type in ("one_lane_two_way", "downstream"):
            if layout.downstream_taper_length_ft < min_ft or layout.downstream_taper_length_ft > max_ft:
                violations.append(Violation(
                    rule_id="MUTCD-6B3-DOWNSTREAM-RANGE",
                    severity=Severity.error,
                    field_path="downstream_taper_length_ft",
                    expected=f"{min_ft}-{max_ft} ft",
                    actual=f"{layout.downstream_taper_length_ft} ft",
                    citation=f"{MUTCD_6B_3_CITATION.source_doc} {MUTCD_6B_3_CITATION.source_ref}",
                    message=f"Downstream taper must be {min_ft}-{max_ft} ft",
                ))
        
        return violations
    
    def _validate_sign_spacing(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Validate A/B/C sign spacing against MUTCD 6B-1 / OTTCH 2-4."""
        violations = []
        
        # Get expected spacing from table
        if context.uses_ottch_short_term and context.jurisdiction == "OR":
            spacing_table = OTTCH_2_4_SIGN_SPACING.get(context.road_context)
            citation = f"{OTTCH_2_4_CITATION.source_doc} {OTTCH_2_4_CITATION.source_ref}"
        else:
            spacing_table = MUTCD_6B_1.get(context.road_context)
            citation = f"{MUTCD_6B_1_CITATION.source_doc} {MUTCD_6B_1_CITATION.source_ref}"
        
        if not spacing_table:
            spacing_table = MUTCD_6B_1.get("rural")
            citation = f"{MUTCD_6B_1_CITATION.source_doc} {MUTCD_6B_1_CITATION.source_ref}"
        
        # Spacing must be at least the minimum
        for label, expected_min, actual in [
            ("A", spacing_table["A"], layout.spacing_A_ft),
            ("B", spacing_table["B"], layout.spacing_B_ft),
            ("C", spacing_table["C"], layout.spacing_C_ft),
        ]:
            if actual < expected_min:
                violations.append(Violation(
                    rule_id=f"SIGN-SPACING-{label}-MIN",
                    severity=Severity.error,
                    field_path=f"spacing_{label}_ft",
                    expected=f">= {expected_min} ft",
                    actual=f"{actual} ft",
                    citation=citation,
                    message=f"Sign spacing {label} must be at least {expected_min} ft for {context.road_context}",
                ))
        
        return violations
    
    def _validate_buffer_length(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Validate buffer length against OTTCH Table 2-4."""
        violations = []
        
        speed = context.posted_speed_mph
        available_speeds = sorted(OTTCH_2_4_BUFFER.keys())
        
        # Find expected buffer
        if speed in OTTCH_2_4_BUFFER:
            expected_buffer = OTTCH_2_4_BUFFER[speed]
        else:
            # Use closest higher speed (conservative)
            higher_speeds = [s for s in available_speeds if s >= speed]
            if higher_speeds:
                expected_buffer = OTTCH_2_4_BUFFER[min(higher_speeds)]
            else:
                expected_buffer = OTTCH_2_4_BUFFER[max(available_speeds)]
        
        if layout.buffer_length_ft < expected_buffer:
            violations.append(Violation(
                rule_id="OTTCH-2-4-BUFFER-MIN",
                severity=Severity.error,
                field_path="buffer_length_ft",
                expected=f">= {expected_buffer} ft",
                actual=f"{layout.buffer_length_ft} ft",
                citation=f"{OTTCH_2_4_CITATION.source_doc} {OTTCH_2_4_CITATION.source_ref}",
                message=f"Buffer at {speed} mph must be at least {expected_buffer} ft",
            ))
        
        return violations
    
    def _validate_channelizer_spacing(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Validate channelizer (cone/drum) spacing against MUTCD 6K.01."""
        violations = []
        speed = context.posted_speed_mph
        
        # Taper spacing rules
        if layout.taper_type in ("one_lane_two_way", "downstream"):
            # One-lane two-way: 20 ft spacing
            expected_taper_spacing = ONE_LANE_TWO_WAY_TAPER_SPACING_FT
            if layout.taper_device_spacing_ft != expected_taper_spacing:
                violations.append(Violation(
                    rule_id="OTTCH-2-3-ONE-LANE-TAPER-SPACING",
                    severity=Severity.error if abs(layout.taper_device_spacing_ft - expected_taper_spacing) > 5 else Severity.warning,
                    field_path="taper_device_spacing_ft",
                    expected=f"{expected_taper_spacing} ft",
                    actual=f"{layout.taper_device_spacing_ft} ft",
                    citation=f"{OTTCH_DEVICE_SPACING_CITATION.source_doc} {OTTCH_DEVICE_SPACING_CITATION.source_ref}",
                    message=f"One-lane two-way taper spacing should be {expected_taper_spacing} ft",
                ))
        else:
            # Other tapers: spacing ≤ 1×S
            max_taper_spacing = speed
            if layout.taper_device_spacing_ft > max_taper_spacing:
                violations.append(Violation(
                    rule_id="MUTCD-6K01-TAPER-SPACING-MAX",
                    severity=Severity.error,
                    field_path="taper_device_spacing_ft",
                    expected=f"<= {max_taper_spacing} ft (1×S)",
                    actual=f"{layout.taper_device_spacing_ft} ft",
                    citation=f"{MUTCD_6K_01_CITATION.source_doc} {MUTCD_6K_01_CITATION.source_ref}",
                    message=f"Taper device spacing must be <= {max_taper_spacing} ft at {speed} mph",
                ))
        
        # Tangent spacing: ≤ 2×S
        max_tangent_spacing = speed * 2
        if layout.tangent_device_spacing_ft > max_tangent_spacing:
            violations.append(Violation(
                rule_id="MUTCD-6K01-TANGENT-SPACING-MAX",
                severity=Severity.error,
                field_path="tangent_device_spacing_ft",
                expected=f"<= {max_tangent_spacing} ft (2×S)",
                actual=f"{layout.tangent_device_spacing_ft} ft",
                citation=f"{MUTCD_6K_01_CITATION.source_doc} {MUTCD_6K_01_CITATION.source_ref}",
                message=f"Tangent device spacing must be <= {max_tangent_spacing} ft at {speed} mph",
            ))
        
        return violations
    
    def _validate_flagger_requirements(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """
        Validate flagger count against OTTCH Diagram 320 note 4.
        
        Two-approach flagging required if ANY of:
        - Night operations
        - Work space > 200 ft
        - Sight distance < 750 ft from each approach
        - Traffic > 400 ADT
        """
        violations = []
        
        if context.control_method != "flaggers":
            return violations
        
        # Check conditions requiring two flaggers (from TWO_FLAGGER_CONDITIONS)
        needs_two_flaggers = False
        reasons = []
        
        if context.is_night:
            needs_two_flaggers = True
            reasons.append("night operations")
        
        if float(context.work_length_ft) > TWO_FLAGGER_CONDITIONS["work_space_over_ft"]:
            needs_two_flaggers = True
            reasons.append(f"work space > {TWO_FLAGGER_CONDITIONS['work_space_over_ft']} ft")
        
        if context.sight_distance_ft is not None:
            if context.sight_distance_ft < TWO_FLAGGER_CONDITIONS["sight_distance_less_than_ft"]:
                needs_two_flaggers = True
                reasons.append(f"sight distance < {TWO_FLAGGER_CONDITIONS['sight_distance_less_than_ft']} ft")
        
        if context.adt is not None and context.adt > TWO_FLAGGER_CONDITIONS["adt_greater_than"]:
            needs_two_flaggers = True
            reasons.append(f"ADT > {TWO_FLAGGER_CONDITIONS['adt_greater_than']}")
        
        expected_count = 2 if needs_two_flaggers else 1
        
        if layout.flagger_count < expected_count:
            violations.append(Violation(
                rule_id="OTTCH-320-FLAGGER-COUNT",
                severity=Severity.error,
                field_path="flagger_count",
                expected=f">= {expected_count}",
                actual=f"{layout.flagger_count}",
                citation=f"{OTTCH_320_WARRANTS_CITATION.source_doc} {OTTCH_320_WARRANTS_CITATION.source_ref}",
                message=f"Two flaggers required: {', '.join(reasons)}" if needs_two_flaggers else "At least one flagger required",
            ))
        
        return violations
    
    def _validate_required_signs(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Validate required signs are present for TA-10 flagger closure."""
        violations = []
        
        # Required signs for Figure 6P-10 / Diagram 320
        required_codes = ["W20-1", "W20-7"]  # ROAD WORK and FLAGGER
        
        present_codes = {s.get("mutcd_code") for s in layout.sign_sequence if s.get("required", True)}
        
        for code in required_codes:
            if code not in present_codes:
                violations.append(Violation(
                    rule_id=f"MUTCD-6P10-REQUIRED-SIGN-{code}",
                    severity=Severity.error,
                    field_path="sign_sequence",
                    expected=f"{code} present",
                    actual="missing",
                    citation="MUTCD 11th Edition Figure 6P-10",
                    message=f"Required sign {code} missing from sequence",
                ))
        
        return violations
    
    def _validate_device_counts(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Validate device counts are consistent with lengths and spacing."""
        violations = []
        
        # One-lane two-way taper cones
        if layout.taper_type == "one_lane_two_way":
            min_cones = ONE_LANE_TWO_WAY_TAPER_CONES_MIN
            max_cones = ONE_LANE_TWO_WAY_TAPER_CONES_MAX
            
            # Check if cone count is reasonable for 2 tapers
            expected_per_taper = (layout.taper_length_ft // layout.taper_device_spacing_ft) + 1
            
            if expected_per_taper < min_cones:
                expected_per_taper = min_cones
            if expected_per_taper > max_cones:
                expected_per_taper = max_cones
            
            # Total cones should cover tapers + tangent
            tangent_cones = (int(context.work_length_ft) + layout.buffer_length_ft) // layout.tangent_device_spacing_ft + 1
            min_total = expected_per_taper * 2 + tangent_cones - 2  # Some overlap expected
            
            if layout.cone_count < min_total * 0.8:  # 20% tolerance
                violations.append(Violation(
                    rule_id="DEVICE-COUNT-CONES-LOW",
                    severity=Severity.warning,
                    field_path="cone_count",
                    expected=f">= ~{min_total}",
                    actual=f"{layout.cone_count}",
                    citation=f"{OTTCH_DEVICE_SPACING_CITATION.source_doc} {OTTCH_DEVICE_SPACING_CITATION.source_ref}",
                    message="Cone count seems low for the specified lengths and spacing",
                ))
        
        return violations
    
    def _validate_arrow_board(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Validate arrow board presence and mode for two-lane two-way."""
        violations = []
        
        # Arrow board NOT required for two-lane two-way per OTTCH 4.3
        # But if present, must be in caution mode (not arrow mode)
        if layout.arrow_board_present and layout.taper_type == "one_lane_two_way":
            if layout.arrow_board_mode and layout.arrow_board_mode != "caution":
                violations.append(Violation(
                    rule_id="OTTCH-4-3-ARROW-BOARD-MODE",
                    severity=Severity.error,
                    field_path="arrow_board_mode",
                    expected="caution (or not present)",
                    actual=f"{layout.arrow_board_mode}",
                    citation="OTTCH 2026 Section 4.3",
                    message="Arrow board on two-lane two-way must use caution mode, not arrow mode",
                ))
        
        return violations
    
    def _validate_internal_consistency(self, layout: LayoutInput, context: SiteContext) -> List[Violation]:
        """Check for internal conflicts/overlaps in the layout."""
        violations = []
        
        # Signs should be in order (A before B before C from upstream)
        if layout.spacing_A_ft < layout.spacing_B_ft or layout.spacing_B_ft < layout.spacing_C_ft:
            # This is actually expected - A should be farthest (first sign from upstream)
            pass  # spacing_A > spacing_B > spacing_C is the distance FROM work zone
        
        # Buffer should be less than total work zone approach
        total_approach = layout.spacing_A_ft + layout.spacing_B_ft + layout.spacing_C_ft
        if layout.buffer_length_ft > total_approach:
            violations.append(Violation(
                rule_id="INTERNAL-BUFFER-TOO-LONG",
                severity=Severity.warning,
                field_path="buffer_length_ft",
                expected=f"< {total_approach} ft (total sign spacing)",
                actual=f"{layout.buffer_length_ft} ft",
                citation="Layout consistency",
                message="Buffer length exceeds total approach distance - check layout",
            ))
        
        # Downstream taper should match approach taper type
        if layout.taper_type == "one_lane_two_way":
            if layout.taper_length_ft != layout.downstream_taper_length_ft:
                violations.append(Violation(
                    rule_id="INTERNAL-TAPER-SYMMETRY",
                    severity=Severity.warning,
                    field_path="downstream_taper_length_ft",
                    expected=f"~{layout.taper_length_ft} ft (symmetric)",
                    actual=f"{layout.downstream_taper_length_ft} ft",
                    citation="Layout consistency",
                    message="Approach and downstream tapers should typically be symmetric",
                ))
        
        return violations
