"""Tests for TCP layout validator.

These tests verify that the validator correctly checks AI-generated layouts
against MUTCD 11th Edition and OTTCH 2026 rules.

CRITICAL: The taper formula tests catch the INVERTED FORMULA BUG where
≤40 mph and ≥45 mph formulas were swapped.
"""
import pytest
from decimal import Decimal
from app.rules.validator import (
    LayoutValidator, LayoutInput, SiteContext, ValidationResult,
    Violation, Severity,
)
from app.rules.tables import compute_merging_taper_L


@pytest.fixture
def validator():
    return LayoutValidator()


@pytest.fixture
def base_site_context():
    """Base site context for tests."""
    return SiteContext(
        posted_speed_mph=35,
        road_context="rural",
        lane_count=2,
        lane_width_ft=Decimal("12"),
        work_length_ft=Decimal("150"),
        is_night=False,
        sight_distance_ft=600,
        adt=1500,
        uses_ottch_short_term=True,
        jurisdiction="OR",
        control_method="flaggers",
    )


@pytest.fixture
def valid_one_lane_layout():
    """A valid one-lane two-way layout."""
    return LayoutInput(
        spacing_A_ft=500,
        spacing_B_ft=500,
        spacing_C_ft=500,
        taper_type="one_lane_two_way",
        taper_length_ft=75,  # Must be 50-100, NOT L formula
        downstream_taper_length_ft=75,
        taper_device_spacing_ft=20,  # Fixed 20 ft for one-lane
        buffer_length_ft=125,  # OTTCH 2-4: 125 ft at 35 mph
        tangent_device_spacing_ft=70,  # 2×S = 70 at 35 mph
        flagger_count=2,  # OTTCH 320: 2 flaggers needed for ADT > 400 or sight < 750
        flagger_station_positions=["upstream_approach", "downstream_approach"],
        sign_sequence=[
            {"mutcd_code": "W20-1", "position": "advance", "required": True},
            {"mutcd_code": "W20-7", "position": "advance", "required": True},
        ],
        cone_count=30,
        drum_count=0,
        arrow_board_present=False,
        arrow_board_mode=None,
    )


class TestTaperFormulas:
    """Tests for taper length validation - catches the INVERTED formula bug."""
    
    def test_low_speed_formula_is_ws_squared_over_60(self, validator):
        """CORRECT: ≤40 mph uses L = W × S² / 60."""
        # At 35 mph with 12 ft lane: L = 12 × 35² / 60 = 245 ft
        L = compute_merging_taper_L(35, Decimal("12"))
        assert L == Decimal("245"), f"35 mph should give L=245, got {L}"
        
    def test_high_speed_formula_is_ws(self, validator):
        """CORRECT: ≥45 mph uses L = W × S."""
        # At 45 mph with 12 ft lane: L = 12 × 45 = 540 ft
        L = compute_merging_taper_L(45, Decimal("12"))
        assert L == Decimal("540"), f"45 mph should give L=540, got {L}"
        
    def test_inverted_formula_bug_detection(self, validator):
        """
        This test FAILS if the formulas are inverted (the original bug).
        
        BUG: Code had ≤40 mph using W×S and ≥45 mph using W×S²/60
        CORRECT: ≤40 mph uses W×S²/60 and ≥45 mph uses W×S
        """
        # At 35 mph, the CORRECT formula gives 245 ft
        # The BUGGY (inverted) formula would give 12 × 35 = 420 ft
        L_correct = compute_merging_taper_L(35, Decimal("12"))
        L_buggy = Decimal("12") * Decimal("35")  # W × S (wrong for low speed)
        
        assert L_correct == Decimal("245"), "Low-speed formula should be W×S²/60"
        assert L_correct != L_buggy, "Formula appears to be inverted!"
        
    def test_merging_taper_too_short_at_35mph(self, validator, base_site_context):
        """Merging taper at 35 mph that's too short should fail."""
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="merging",
            taper_length_ft=150,  # Too short - should be 245 ft at 35 mph
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=35,
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        # Should fail with taper length error
        assert not result.passed
        taper_violations = [v for v in result.violations if "MERGING" in v.rule_id]
        assert len(taper_violations) > 0, "Should have merging taper violation"
        
    def test_merging_taper_correct_at_35mph(self, validator, base_site_context):
        """Merging taper at 35 mph with correct length should pass."""
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="merging",
            taper_length_ft=250,  # Correct - L = 245 at 35 mph
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=35,
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        # Should not have taper formula violations
        taper_violations = [v for v in result.violations if "MERGING" in v.rule_id]
        assert len(taper_violations) == 0, f"Should have no merging taper violations, got: {taper_violations}"


class TestOneLaneTwoWayTaper:
    """Tests for one-lane two-way taper validation."""
    
    def test_one_lane_taper_must_be_50_to_100_ft(self, validator, base_site_context):
        """One-lane two-way tapers must be 50-100 ft, NOT L formula."""
        # Invalid: 200 ft (outside 50-100 range)
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=200,  # Wrong - should be 50-100
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        assert not result.passed
        range_violations = [v for v in result.violations if "ONE-LANE-RANGE" in v.rule_id]
        assert len(range_violations) > 0
        
    def test_valid_one_lane_taper_at_75ft(self, validator, base_site_context, valid_one_lane_layout):
        """Valid one-lane taper at 75 ft should pass taper validation."""
        result = validator.validate(valid_one_lane_layout, base_site_context)
        
        # Should not have taper range violations
        range_violations = [v for v in result.violations if "ONE-LANE-RANGE" in v.rule_id]
        assert len(range_violations) == 0


class TestSignSpacing:
    """Tests for sign spacing validation."""
    
    def test_rural_sign_spacing_minimum_500ft(self, validator, base_site_context, valid_one_lane_layout):
        """Rural roads require 500 ft minimum A/B/C spacing."""
        result = validator.validate(valid_one_lane_layout, base_site_context)
        
        spacing_violations = [v for v in result.violations if "SIGN-SPACING" in v.rule_id]
        assert len(spacing_violations) == 0
        
    def test_sign_spacing_too_short_fails(self, validator, base_site_context):
        """Sign spacing below minimum should fail."""
        layout = LayoutInput(
            spacing_A_ft=300,  # Too short for rural (needs 500)
            spacing_B_ft=300,
            spacing_C_ft=300,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        spacing_violations = [v for v in result.violations if "SIGN-SPACING" in v.rule_id]
        assert len(spacing_violations) == 3  # A, B, and C all too short


class TestBufferLength:
    """Tests for buffer length validation."""
    
    def test_buffer_at_35mph_needs_125ft(self, validator, base_site_context, valid_one_lane_layout):
        """Buffer at 35 mph needs 125 ft per OTTCH Table 2-4."""
        result = validator.validate(valid_one_lane_layout, base_site_context)
        
        buffer_violations = [v for v in result.violations if "BUFFER" in v.rule_id]
        assert len(buffer_violations) == 0
        
    def test_buffer_too_short_fails(self, validator, base_site_context):
        """Buffer below minimum should fail."""
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=100,  # Too short at 35 mph (needs 125)
            tangent_device_spacing_ft=70,
            flagger_count=2,
            flagger_station_positions=["upstream_approach", "downstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        buffer_violations = [v for v in result.violations if "BUFFER" in v.rule_id]
        assert len(buffer_violations) > 0


class TestFlaggerRequirements:
    """Tests for flagger count validation.
    
    OTTCH Diagram 320 Note 4: Two flaggers required when ANY of:
    - Night operations
    - Work space > 200 ft
    - Sight distance < 750 ft
    - ADT > 400
    """
    
    def test_low_traffic_good_sight_one_flagger_ok(self, validator, valid_one_lane_layout):
        """Day operation with low traffic and good sight can use one flagger."""
        # Context with low ADT and good sight distance - one flagger OK
        context = SiteContext(
            posted_speed_mph=35,
            road_context="rural",
            lane_count=2,
            lane_width_ft=Decimal("12"),
            work_length_ft=Decimal("150"),  # Under 200 ft threshold
            is_night=False,
            sight_distance_ft=800,  # Above 750 ft threshold
            adt=300,  # Below 400 threshold
            uses_ottch_short_term=True,
            jurisdiction="OR",
            control_method="flaggers",
        )
        
        one_flagger_layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=125,
            tangent_device_spacing_ft=70,
            flagger_count=1,  # One flagger OK with low ADT, good sight
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(one_flagger_layout, context)
        
        flagger_violations = [v for v in result.violations if "FLAGGER" in v.rule_id]
        assert len(flagger_violations) == 0
        
    def test_night_operation_needs_two_flaggers(self, validator):
        """Night operation requires two flaggers."""
        context = SiteContext(
            posted_speed_mph=35,
            road_context="rural",
            lane_count=2,
            lane_width_ft=Decimal("12"),
            work_length_ft=Decimal("150"),
            is_night=True,  # Night work - requires 2 flaggers
            sight_distance_ft=800,
            adt=300,
            uses_ottch_short_term=True,
            jurisdiction="OR",
            control_method="flaggers",
        )
        
        # Layout with only 1 flagger
        one_flagger_layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=125,
            tangent_device_spacing_ft=70,
            flagger_count=1,  # Only 1 flagger, but night requires 2
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(one_flagger_layout, context)
        
        flagger_violations = [v for v in result.violations if "FLAGGER" in v.rule_id]
        assert len(flagger_violations) > 0
        assert "night" in flagger_violations[0].message.lower()
        
    def test_poor_sight_distance_needs_two_flaggers(self, validator):
        """Poor sight distance (<750 ft per OTTCH) requires two flaggers."""
        context = SiteContext(
            posted_speed_mph=35,
            road_context="rural",
            lane_count=2,
            lane_width_ft=Decimal("12"),
            work_length_ft=Decimal("150"),
            is_night=False,
            sight_distance_ft=600,  # Less than 750 ft threshold - requires 2 flaggers
            adt=300,  # Under threshold
            uses_ottch_short_term=True,
            jurisdiction="OR",
            control_method="flaggers",
        )
        
        # Layout with only 1 flagger
        one_flagger_layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=125,
            tangent_device_spacing_ft=70,
            flagger_count=1,  # Only 1 flagger, but sight distance requires 2
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(one_flagger_layout, context)
        
        flagger_violations = [v for v in result.violations if "FLAGGER" in v.rule_id]
        assert len(flagger_violations) > 0
        
    def test_high_adt_needs_two_flaggers(self, validator):
        """High ADT (>400 per OTTCH) requires two flaggers."""
        context = SiteContext(
            posted_speed_mph=35,
            road_context="rural",
            lane_count=2,
            lane_width_ft=Decimal("12"),
            work_length_ft=Decimal("150"),
            is_night=False,
            sight_distance_ft=800,  # Good sight
            adt=500,  # Greater than 400 threshold - requires 2 flaggers
            uses_ottch_short_term=True,
            jurisdiction="OR",
            control_method="flaggers",
        )
        
        # Layout with only 1 flagger
        one_flagger_layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=125,
            tangent_device_spacing_ft=70,
            flagger_count=1,  # Only 1 flagger, but ADT requires 2
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(one_flagger_layout, context)
        
        flagger_violations = [v for v in result.violations if "FLAGGER" in v.rule_id]
        assert len(flagger_violations) > 0


class TestRequiredSigns:
    """Tests for required sign validation."""
    
    def test_missing_w20_1_fails(self, validator, base_site_context):
        """Missing W20-1 (ROAD WORK) should fail."""
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                # Missing W20-1!
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        sign_violations = [v for v in result.violations if "REQUIRED-SIGN-W20-1" in v.rule_id]
        assert len(sign_violations) > 0


class TestChannelizerSpacing:
    """Tests for channelizer spacing validation."""
    
    def test_taper_spacing_within_1x_speed(self, validator, base_site_context):
        """Taper spacing must be ≤ 1×S."""
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="merging",
            taper_length_ft=250,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=50,  # > 35 (1×S) - should fail
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        spacing_violations = [v for v in result.violations if "TAPER-SPACING-MAX" in v.rule_id]
        assert len(spacing_violations) > 0
        
    def test_tangent_spacing_within_2x_speed(self, validator, base_site_context):
        """Tangent spacing must be ≤ 2×S."""
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="merging",
            taper_length_ft=250,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=35,
            buffer_length_ft=100,
            tangent_device_spacing_ft=100,  # > 70 (2×S) at 35 mph - should fail
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        spacing_violations = [v for v in result.violations if "TANGENT-SPACING-MAX" in v.rule_id]
        assert len(spacing_violations) > 0


class TestArrowBoard:
    """Tests for arrow board validation."""
    
    def test_one_lane_arrow_mode_not_allowed(self, validator, base_site_context):
        """One-lane two-way cannot use arrow mode (must use caution)."""
        layout = LayoutInput(
            spacing_A_ft=500,
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=True,
            arrow_board_mode="sequential",  # Wrong - must be caution
        )
        
        result = validator.validate(layout, base_site_context)
        
        arrow_violations = [v for v in result.violations if "ARROW-BOARD" in v.rule_id]
        assert len(arrow_violations) > 0


class TestValidationResult:
    """Tests for validation result structure."""
    
    def test_validation_result_counts(self, validator, base_site_context):
        """Validation result should have correct error/warning counts."""
        layout = LayoutInput(
            spacing_A_ft=300,  # Error: too short
            spacing_B_ft=300,  # Error: too short
            spacing_C_ft=300,  # Error: too short
            taper_type="one_lane_two_way",
            taper_length_ft=200,  # Error: outside 50-100 range
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=50,  # Error: too short
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        assert not result.passed
        assert result.error_count >= 5  # At least sign spacing + taper + buffer
        assert isinstance(result.violations, list)
        
    def test_violation_has_required_fields(self, validator, base_site_context):
        """Violations should have all required fields."""
        layout = LayoutInput(
            spacing_A_ft=100,  # Too short
            spacing_B_ft=500,
            spacing_C_ft=500,
            taper_type="one_lane_two_way",
            taper_length_ft=75,
            downstream_taper_length_ft=75,
            taper_device_spacing_ft=20,
            buffer_length_ft=100,
            tangent_device_spacing_ft=70,
            flagger_count=1,
            flagger_station_positions=["upstream_approach"],
            sign_sequence=[
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            cone_count=30,
            drum_count=0,
            arrow_board_present=False,
            arrow_board_mode=None,
        )
        
        result = validator.validate(layout, base_site_context)
        
        assert len(result.violations) > 0
        v = result.violations[0]
        assert v.rule_id is not None
        assert v.severity in (Severity.error, Severity.warning)
        assert v.field_path is not None
        assert v.expected is not None
        assert v.actual is not None
        assert v.citation is not None
        assert v.message is not None
        
    def test_valid_layout_passes(self, validator, base_site_context, valid_one_lane_layout):
        """A valid layout should pass validation with no errors."""
        result = validator.validate(valid_one_lane_layout, base_site_context)
        
        # Should have no errors (may have warnings)
        assert result.error_count == 0, f"Should have no errors, got: {[v.to_dict() for v in result.violations if v.severity == Severity.error]}"
        assert result.passed
