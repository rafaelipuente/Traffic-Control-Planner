"""
Tests for the deterministic rules engine.

Covers MUTCD 11th Edition and OTTCH 2026 formulas and table lookups.
Tests speed boundaries 25/35/40/45/55/65 as required.
"""
import pytest
from decimal import Decimal
from app.rules.engine import (
    RulesEngine,
    SiteFacts,
    RoadContext,
    ControlMethod,
    TaperType,
)
from app.rules.tables import (
    compute_merging_taper_L,
    MUTCD_6B_1,
    MUTCD_6B_2,
    OTTCH_2_4_BUFFER,
    OTTCH_2_3_12FT,
)


class TestMergingTaperFormulas:
    """
    Test the CORRECT taper formulas from MUTCD Table 6B-4 / OTTCH Table 2-1.
    
    CRITICAL: The formulas are:
    - 40 mph or less: L = W × S² / 60
    - 45 mph or more: L = W × S
    
    NOT the inverted formulas in the old client-side code.
    """
    
    def test_25mph_uses_quadratic_formula(self):
        """25 mph: L = 12 × 25² / 60 = 125 ft"""
        L = compute_merging_taper_L(25, Decimal("12"))
        assert L == Decimal("125"), f"Expected 125, got {L}"
    
    def test_30mph_uses_quadratic_formula(self):
        """30 mph: L = 12 × 30² / 60 = 180 ft"""
        L = compute_merging_taper_L(30, Decimal("12"))
        assert L == Decimal("180"), f"Expected 180, got {L}"
    
    def test_35mph_uses_quadratic_formula(self):
        """35 mph: L = 12 × 35² / 60 = 245 ft (matches OTTCH Table 2-3)"""
        L = compute_merging_taper_L(35, Decimal("12"))
        assert L == Decimal("245"), f"Expected 245, got {L}"
    
    def test_40mph_uses_quadratic_formula(self):
        """40 mph: L = 12 × 40² / 60 = 320 ft (boundary case, still quadratic)"""
        L = compute_merging_taper_L(40, Decimal("12"))
        assert L == Decimal("320"), f"Expected 320, got {L}"
    
    def test_45mph_uses_linear_formula(self):
        """45 mph: L = 12 × 45 = 540 ft (switches to linear)"""
        L = compute_merging_taper_L(45, Decimal("12"))
        assert L == Decimal("540"), f"Expected 540, got {L}"
    
    def test_50mph_uses_linear_formula(self):
        """50 mph: L = 12 × 50 = 600 ft"""
        L = compute_merging_taper_L(50, Decimal("12"))
        assert L == Decimal("600"), f"Expected 600, got {L}"
    
    def test_55mph_uses_linear_formula(self):
        """55 mph: L = 12 × 55 = 660 ft"""
        L = compute_merging_taper_L(55, Decimal("12"))
        assert L == Decimal("660"), f"Expected 660, got {L}"
    
    def test_60mph_uses_linear_formula(self):
        """60 mph: L = 12 × 60 = 720 ft"""
        L = compute_merging_taper_L(60, Decimal("12"))
        assert L == Decimal("720"), f"Expected 720, got {L}"
    
    def test_65mph_uses_linear_formula(self):
        """65 mph: L = 12 × 65 = 780 ft"""
        L = compute_merging_taper_L(65, Decimal("12"))
        assert L == Decimal("780"), f"Expected 780, got {L}"
    
    def test_matches_ottch_table_2_3_values(self):
        """Verify computed L matches OTTCH Table 2-3 for 12ft lane width."""
        for speed, data in OTTCH_2_3_12FT.items():
            expected = data["merging_L_ft"]
            computed = compute_merging_taper_L(speed, Decimal("12"))
            assert int(computed) == expected, \
                f"At {speed} mph: expected {expected}, got {int(computed)}"


class TestOneLaneTwoWayTaper:
    """
    Test one-lane two-way taper (Diagram 320 / Figure 6P-10).
    
    This taper is 50-100 ft, NOT the L formula.
    """
    
    def test_one_lane_two_way_taper_is_not_L(self):
        """One-lane two-way taper should be 50-100 ft, not L formula."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            lane_width_ft=Decimal("12"),
        )
        computation = engine.compute(facts)
        
        # Should be in 50-100 range
        taper_length = int(computation.taper_length_ft.value)
        assert 50 <= taper_length <= 100, \
            f"One-lane two-way taper should be 50-100 ft, got {taper_length}"
        
        # Verify citation mentions the correct table
        assert "6B-3" in computation.taper_length_ft.citation.source_ref or \
               "6B.08" in computation.taper_length_ft.citation.source_ref
    
    def test_taper_device_spacing_is_20ft(self):
        """One-lane two-way taper uses 20 ft device spacing, not 1×S."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=55,  # Would be 55 ft with 1×S rule
        )
        computation = engine.compute(facts)
        
        assert int(computation.taper_device_spacing_ft.value) == 20, \
            "One-lane two-way taper spacing should be 20 ft"


class TestSignSpacing:
    """Test sign spacing from MUTCD Table 6B-1 / OTTCH Table 2-4."""
    
    def test_rural_sign_spacing(self):
        """Rural roads: A=B=C=500 ft"""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            road_context=RoadContext.rural,
        )
        computation = engine.compute(facts)
        
        assert int(computation.spacing_A_ft.value) == 500
        assert int(computation.spacing_B_ft.value) == 500
        assert int(computation.spacing_C_ft.value) == 500
    
    def test_urban_low_speed_sign_spacing(self):
        """Urban low speed: A=B=C=100 ft"""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=25,
            road_context=RoadContext.urban_low_speed,
        )
        computation = engine.compute(facts)
        
        assert int(computation.spacing_A_ft.value) == 100
        assert int(computation.spacing_B_ft.value) == 100
        assert int(computation.spacing_C_ft.value) == 100
    
    def test_urban_high_speed_sign_spacing(self):
        """Urban high speed: A=B=C=350 ft"""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=40,
            road_context=RoadContext.urban_high_speed,
        )
        computation = engine.compute(facts)
        
        assert int(computation.spacing_A_ft.value) == 350
        assert int(computation.spacing_B_ft.value) == 350
        assert int(computation.spacing_C_ft.value) == 350


class TestBufferLength:
    """Test buffer lengths from OTTCH Table 2-4."""
    
    @pytest.mark.parametrize("speed,expected_buffer", [
        (20, 50),
        (25, 75),
        (30, 100),
        (35, 125),
        (40, 150),
        (45, 180),
        (50, 210),
        (55, 250),
        (60, 285),
        (65, 325),
    ])
    def test_ottch_buffer_values(self, speed: int, expected_buffer: int):
        """Verify OTTCH Table 2-4 buffer values."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=speed,
            road_context=RoadContext.rural,
            uses_ottch_short_term=True,
            jurisdiction="OR",
        )
        computation = engine.compute(facts)
        
        assert int(computation.buffer_length_ft.value) == expected_buffer, \
            f"At {speed} mph: expected buffer {expected_buffer}, got {computation.buffer_length_ft.value}"


class TestMUTCDStoppingSightDistance:
    """Test MUTCD Table 6B-2 stopping sight distance values."""
    
    @pytest.mark.parametrize("speed,expected_ssd", [
        (25, 155),
        (35, 250),
        (40, 305),
        (45, 360),
        (55, 495),
        (65, 645),
    ])
    def test_mutcd_ssd_values(self, speed: int, expected_ssd: int):
        """Verify MUTCD Table 6B-2 stopping sight distance."""
        engine = RulesEngine()
        facts = SiteFacts(posted_or_statutory_speed_mph=speed)
        computation = engine.compute(facts)
        
        assert int(computation.mutcd_ssd_ft.value) == expected_ssd


class TestFlaggerRequirements:
    """Test flagger requirements from OTTCH Diagram 320 note 4."""
    
    def test_daytime_short_work_low_adt_single_flagger(self):
        """Day, ≤200 ft work, good visibility, ≤400 ADT = 1 flagger"""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            work_length_ft=Decimal("150"),
            is_night=False,
            sight_distance_ft=Decimal("1000"),
            adt=300,
        )
        computation = engine.compute(facts)
        
        assert int(computation.flagger_count.value) == 1
    
    def test_night_requires_two_flaggers(self):
        """Night operations require two flaggers."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            work_length_ft=Decimal("100"),
            is_night=True,
        )
        computation = engine.compute(facts)
        
        assert int(computation.flagger_count.value) == 2
        assert any("Night" in note for note in computation.flagger_station_notes)
    
    def test_work_over_200ft_requires_two_flaggers(self):
        """Work space > 200 ft requires two flaggers."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            work_length_ft=Decimal("250"),
            is_night=False,
        )
        computation = engine.compute(facts)
        
        assert int(computation.flagger_count.value) == 2
        assert any("200 ft" in note for note in computation.flagger_station_notes)
    
    def test_poor_sight_distance_requires_two_flaggers(self):
        """Sight distance < 750 ft requires two flaggers."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            work_length_ft=Decimal("100"),
            is_night=False,
            sight_distance_ft=Decimal("600"),
        )
        computation = engine.compute(facts)
        
        assert int(computation.flagger_count.value) == 2
        assert any("750 ft" in note for note in computation.flagger_station_notes)
    
    def test_high_adt_requires_two_flaggers(self):
        """ADT > 400 requires two flaggers."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            work_length_ft=Decimal("100"),
            is_night=False,
            adt=500,
        )
        computation = engine.compute(facts)
        
        assert int(computation.flagger_count.value) == 2
        assert any("400" in note for note in computation.flagger_station_notes)


class TestScopeRefusal:
    """Test that the engine refuses out-of-scope requests."""
    
    def test_refuses_non_two_lane(self):
        """Refuses multi-lane roads."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            lane_count=4,
            opposing_directions=True,
        )
        computation = engine.compute(facts)
        
        assert len(computation.refused_reasons) > 0
        assert any("two-lane" in r.lower() for r in computation.refused_reasons)
    
    def test_refuses_freeway(self):
        """Refuses expressway/freeway context."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=65,
            road_context=RoadContext.expressway_freeway,
        )
        computation = engine.compute(facts)
        
        assert len(computation.refused_reasons) > 0
        assert any("freeway" in r.lower() for r in computation.refused_reasons)
    
    def test_refuses_pilot_car_control(self):
        """Refuses non-flagger control methods."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            control_method=ControlMethod.pilot_car,
        )
        computation = engine.compute(facts)
        
        assert len(computation.refused_reasons) > 0
        assert any("flagger" in r.lower() for r in computation.refused_reasons)
    
    def test_refuses_duration_over_3_days(self):
        """Refuses work duration > 3 days (OTTCH scope)."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            duration_days=Decimal("5"),
        )
        computation = engine.compute(facts)
        
        assert len(computation.refused_reasons) > 0
        assert any("3" in r for r in computation.refused_reasons)
    
    def test_refuses_rail_crossing(self):
        """Refuses rail crossing within influence zone."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            rail_crossing_within_influence=True,
        )
        computation = engine.compute(facts)
        
        assert len(computation.refused_reasons) > 0
        assert any("rail" in r.lower() for r in computation.refused_reasons)
    
    def test_refuses_ambiguous_speed_41_44(self):
        """Refuses speeds 41-44 mph (ambiguous formula zone)."""
        engine = RulesEngine()
        for speed in [41, 42, 43, 44]:
            facts = SiteFacts(posted_or_statutory_speed_mph=speed)
            computation = engine.compute(facts)
            
            assert len(computation.refused_reasons) > 0, \
                f"Should refuse speed {speed}"
            assert any("threshold" in r.lower() for r in computation.refused_reasons)
    
    def test_refuses_work_over_1_mile(self):
        """Refuses work length > 1 mile (use Diagram 340 instead)."""
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            work_length_ft=Decimal("6000"),  # > 5280 ft = 1 mile
        )
        computation = engine.compute(facts)
        
        assert len(computation.refused_reasons) > 0
        assert any("340" in r for r in computation.refused_reasons)


class TestSignSequence:
    """Test sign sequence for Figure 6P-10 / Diagram 320."""
    
    def test_required_signs_present(self):
        """W20-1 (ROAD WORK) and W20-7 (FLAGGER) are always required."""
        engine = RulesEngine()
        facts = SiteFacts(posted_or_statutory_speed_mph=35)
        computation = engine.compute(facts)
        
        sign_codes = [s.mutcd_code for s in computation.sign_sequence if s.required]
        assert "W20-1" in sign_codes, "W20-1 ROAD WORK required"
        assert "W20-7" in sign_codes, "W20-7 FLAGGER required"
    
    def test_w20_4_optional_for_high_speed_or_volume(self):
        """W20-4 (ONE LANE ROAD) is optional but recommended for high speed/volume."""
        engine = RulesEngine()
        
        # Low speed, low volume
        facts_low = SiteFacts(
            posted_or_statutory_speed_mph=25,
            adt=200,
        )
        computation_low = engine.compute(facts_low)
        w20_4_low = next((s for s in computation_low.sign_sequence if s.mutcd_code == "W20-4"), None)
        
        # High speed
        facts_high = SiteFacts(
            posted_or_statutory_speed_mph=45,
            adt=200,
        )
        computation_high = engine.compute(facts_high)
        w20_4_high = next((s for s in computation_high.sign_sequence if s.mutcd_code == "W20-4"), None)
        
        assert w20_4_high.required == True, "W20-4 should be required at high speed"


class TestArrowBoard:
    """Test arrow board requirements."""
    
    def test_arrow_board_not_required_two_lane_two_way(self):
        """Arrow board not required for two-lane two-way operations."""
        engine = RulesEngine()
        facts = SiteFacts(posted_or_statutory_speed_mph=35)
        computation = engine.compute(facts)
        
        assert computation.arrow_board_required == False
    
    def test_arrow_board_caution_mode_at_high_speed(self):
        """If used, arrow board must be in caution mode (OTTCH 4.3)."""
        engine = RulesEngine()
        facts = SiteFacts(posted_or_statutory_speed_mph=55)
        computation = engine.compute(facts)
        
        # If mode is set, must be caution (not directional)
        if computation.arrow_board_mode:
            assert computation.arrow_board_mode == "caution"


class TestCitations:
    """Test that all computed values have proper citations."""
    
    def test_all_values_have_citations(self):
        """Every computed value must have source documentation."""
        engine = RulesEngine()
        facts = SiteFacts(posted_or_statutory_speed_mph=35)
        computation = engine.compute(facts)
        
        # Check all ComputedValue fields
        computed_values = [
            computation.spacing_A_ft,
            computation.spacing_B_ft,
            computation.spacing_C_ft,
            computation.taper_length_ft,
            computation.downstream_taper_length_ft,
            computation.taper_device_spacing_ft,
            computation.tangent_device_spacing_ft,
            computation.buffer_length_ft,
            computation.mutcd_ssd_ft,
            computation.flagger_count,
            computation.cones_per_taper,
            computation.cones_tangent,
        ]
        
        for cv in computed_values:
            assert cv.citation is not None, f"Missing citation for value {cv.value}"
            assert cv.citation.source_doc, "Citation must have source_doc"
            assert cv.citation.source_ref, "Citation must have source_ref"


class TestWorkedExample:
    """
    Test the worked example from the architecture document.
    
    Facts: Oregon, two-lane two-way, 35 mph posted, 12 ft lanes, 150 ft work space,
    daytime, rural context, ADT 1,200, sight distance 1,000 ft, duration 1 day, flaggers.
    """
    
    def test_worked_example(self):
        engine = RulesEngine()
        facts = SiteFacts(
            posted_or_statutory_speed_mph=35,
            lane_width_ft=Decimal("12"),
            work_length_ft=Decimal("150"),
            is_night=False,
            road_context=RoadContext.rural,
            adt=1200,
            sight_distance_ft=Decimal("1000"),
            duration_days=Decimal("1"),
            control_method=ControlMethod.flaggers,
            uses_ottch_short_term=True,
            jurisdiction="OR",
        )
        computation = engine.compute(facts)
        
        # Should not be refused
        assert len(computation.refused_reasons) == 0, \
            f"Should not be refused: {computation.refused_reasons}"
        
        # Sign spacing: rural = 500 ft
        assert int(computation.spacing_A_ft.value) == 500
        assert int(computation.spacing_B_ft.value) == 500
        assert int(computation.spacing_C_ft.value) == 500
        
        # One-lane two-way taper: 50-100 ft (not L=245 ft)
        assert 50 <= int(computation.taper_length_ft.value) <= 100
        
        # Taper device spacing: 20 ft
        assert int(computation.taper_device_spacing_ft.value) == 20
        
        # Buffer at 35 mph: 125 ft (OTTCH Table 2-4)
        assert int(computation.buffer_length_ft.value) == 125
        
        # MUTCD SSD at 35 mph: 250 ft (reference)
        assert int(computation.mutcd_ssd_ft.value) == 250
        
        # Flaggers: 2 because ADT 1,200 > 400
        assert int(computation.flagger_count.value) == 2
        
        # Arrow board: not required
        assert computation.arrow_board_required == False
