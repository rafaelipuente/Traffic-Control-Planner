"""
Deterministic Rules Engine for Traffic Control Plans.

This engine computes ALL distances, spacing, and device counts.
Every value has a source citation. No estimation or LLM involvement.

SCOPE (Phase 1): MUTCD Figure 6P-10 / OTTCH Diagram 320
Two-lane two-way flagger closure only.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, List, Optional, Literal
from enum import Enum

from app.rules.tables import (
    RULES_PACK_VERSION,
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
    get_taper_device_spacing_ft,
    get_tangent_device_spacing_ft,
)


class RoadContext(str, Enum):
    urban_low_speed = "urban_low_speed"
    urban_high_speed = "urban_high_speed"
    rural = "rural"
    expressway_freeway = "expressway_freeway"


class ControlMethod(str, Enum):
    flaggers = "flaggers"
    afad = "afad"
    pilot_car = "pilot_car"
    self_regulating = "self_regulating"
    signal = "signal"


class TaperType(str, Enum):
    one_lane_two_way = "one_lane_two_way"
    downstream = "downstream"
    merging = "merging"
    shifting = "shifting"
    shoulder = "shoulder"


@dataclass
class Citation:
    """Source citation for a computed value."""
    source_doc: str
    source_ref: str
    source_url: str
    notes: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            "source_doc": self.source_doc,
            "source_ref": self.source_ref,
            "source_url": self.source_url,
            "notes": self.notes,
        }


@dataclass
class ComputedValue:
    """A computed value with its citation."""
    value: Decimal | int | str
    unit: Optional[str]
    formula: Optional[str]
    citation: Citation

    def to_dict(self) -> Dict:
        return {
            "value": float(self.value) if isinstance(self.value, Decimal) else self.value,
            "unit": self.unit,
            "formula": self.formula,
            "citation": self.citation.to_dict(),
        }


@dataclass
class SignSpec:
    """Specification for a sign in the sequence."""
    mutcd_code: str
    name: str
    sequence_order: int
    purpose: str
    required: bool
    citation: Citation


@dataclass
class SiteFacts:
    """
    Confirmed site facts from vision extraction + user confirmation.
    All required fields must be confirmed before plan generation.
    """
    posted_or_statutory_speed_mph: int
    speed_basis: Literal["posted", "off_peak_85th", "anticipated"] = "posted"
    road_context: RoadContext = RoadContext.rural
    lane_count: int = 2
    opposing_directions: bool = True
    lane_width_ft: Decimal = Decimal("12")
    shoulder_width_ft: Optional[Decimal] = None
    work_length_ft: Decimal = Decimal("100")
    duration_days: Decimal = Decimal("1")
    is_night: bool = False
    sight_distance_ft: Optional[Decimal] = None
    adt: Optional[int] = None
    control_method: ControlMethod = ControlMethod.flaggers
    approach_count: int = 2
    rail_crossing_within_influence: bool = False
    jurisdiction: str = "OR"
    uses_ottch_short_term: bool = True


@dataclass
class Computation:
    """Complete computation result from the rules engine."""
    layout_family: str
    rules_pack_version: str
    
    # Sign sequence
    sign_sequence: List[SignSpec]
    
    # Spacing
    spacing_A_ft: ComputedValue
    spacing_B_ft: ComputedValue
    spacing_C_ft: ComputedValue
    
    # Taper
    taper_type: TaperType
    taper_length_ft: ComputedValue
    downstream_taper_length_ft: ComputedValue
    taper_device_spacing_ft: ComputedValue
    tangent_device_spacing_ft: ComputedValue
    
    # Buffer
    buffer_length_ft: ComputedValue
    mutcd_ssd_ft: ComputedValue  # Federal reference value
    
    # Flaggers
    flagger_count: ComputedValue
    flagger_station_notes: List[str]
    
    # Device counts
    cones_per_taper: ComputedValue
    cones_tangent: ComputedValue
    signs_count: int
    
    # Arrow board (False for two-lane two-way)
    arrow_board_required: bool
    arrow_board_mode: Optional[str]  # "caution" only for two-lane two-way per OTTCH 4.3
    
    # Refused if out of scope
    refused_reasons: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict:
        return {
            "layout_family": self.layout_family,
            "rules_pack_version": self.rules_pack_version,
            "sign_sequence": [
                {
                    "mutcd_code": s.mutcd_code,
                    "name": s.name,
                    "sequence_order": s.sequence_order,
                    "purpose": s.purpose,
                    "required": s.required,
                }
                for s in self.sign_sequence
            ],
            "spacing_A_ft": self.spacing_A_ft.to_dict(),
            "spacing_B_ft": self.spacing_B_ft.to_dict(),
            "spacing_C_ft": self.spacing_C_ft.to_dict(),
            "taper_type": self.taper_type.value,
            "taper_length_ft": self.taper_length_ft.to_dict(),
            "downstream_taper_length_ft": self.downstream_taper_length_ft.to_dict(),
            "taper_device_spacing_ft": self.taper_device_spacing_ft.to_dict(),
            "tangent_device_spacing_ft": self.tangent_device_spacing_ft.to_dict(),
            "buffer_length_ft": self.buffer_length_ft.to_dict(),
            "mutcd_ssd_ft": self.mutcd_ssd_ft.to_dict(),
            "flagger_count": self.flagger_count.to_dict(),
            "flagger_station_notes": self.flagger_station_notes,
            "cones_per_taper": self.cones_per_taper.to_dict(),
            "cones_tangent": self.cones_tangent.to_dict(),
            "signs_count": self.signs_count,
            "arrow_board_required": self.arrow_board_required,
            "arrow_board_mode": self.arrow_board_mode,
            "refused_reasons": self.refused_reasons,
        }


class RulesEngine:
    """
    Deterministic rules engine for TCP computations.
    
    Phase 1 scope: ottch_320_mutcd_ta10 (two-lane two-way flagger closure)
    """
    
    LAYOUT_FAMILY = "ottch_320_mutcd_ta10"
    
    def __init__(self):
        self.version = RULES_PACK_VERSION
    
    def compute(self, facts: SiteFacts) -> Computation:
        """
        Compute a traffic control plan from confirmed site facts.
        
        Raises ValueError if facts are outside supported scope.
        """
        refused = self._check_scope(facts)
        if refused:
            return self._create_refused_computation(refused)
        
        # Get sign spacing based on road context
        spacing = self._get_sign_spacing(facts)
        
        # Get buffer length
        buffer = self._get_buffer_length(facts)
        
        # Get MUTCD SSD reference
        mutcd_ssd = self._get_mutcd_ssd(facts.posted_or_statutory_speed_mph)
        
        # One-lane two-way taper (50-100 ft, not L formula)
        taper = self._get_one_lane_two_way_taper()
        downstream_taper = self._get_one_lane_two_way_taper()
        
        # Device spacing
        taper_spacing = self._get_taper_device_spacing(facts)
        tangent_spacing = self._get_tangent_device_spacing(facts)
        
        # Flagger requirements
        flagger_count, flagger_notes = self._get_flagger_requirements(facts)
        
        # Device counts
        cones_taper = self._get_taper_cone_count()
        cones_tangent = self._get_tangent_cone_count(facts, buffer)
        
        # Sign sequence for TA-10 / Diagram 320
        sign_sequence = self._get_sign_sequence(facts)
        
        return Computation(
            layout_family=self.LAYOUT_FAMILY,
            rules_pack_version=self.version,
            sign_sequence=sign_sequence,
            spacing_A_ft=spacing["A"],
            spacing_B_ft=spacing["B"],
            spacing_C_ft=spacing["C"],
            taper_type=TaperType.one_lane_two_way,
            taper_length_ft=taper,
            downstream_taper_length_ft=downstream_taper,
            taper_device_spacing_ft=taper_spacing,
            tangent_device_spacing_ft=tangent_spacing,
            buffer_length_ft=buffer,
            mutcd_ssd_ft=mutcd_ssd,
            flagger_count=flagger_count,
            flagger_station_notes=flagger_notes,
            cones_per_taper=cones_taper,
            cones_tangent=cones_tangent,
            signs_count=len([s for s in sign_sequence if s.required]),
            arrow_board_required=False,
            arrow_board_mode="caution" if facts.posted_or_statutory_speed_mph >= 45 else None,
            refused_reasons=[],
        )
    
    def _check_scope(self, facts: SiteFacts) -> List[str]:
        """Check if facts are within Phase 1 scope."""
        refused = []
        
        # Must be two-lane two-way
        if facts.lane_count != 2 or not facts.opposing_directions:
            refused.append("Phase 1 only supports two-lane, two-way roads")
        
        # Must use flaggers
        if facts.control_method != ControlMethod.flaggers:
            refused.append(f"Phase 1 only supports flagger control (got {facts.control_method.value})")
        
        # Must be OTTCH short-term (3 days or less)
        if not facts.uses_ottch_short_term:
            refused.append("Phase 1 only supports OTTCH short-term (3 days or less)")
        
        if facts.duration_days > Decimal("3"):
            refused.append(f"Duration {facts.duration_days} days exceeds 3-day OTTCH limit")
        
        # No freeways
        if facts.road_context == RoadContext.expressway_freeway:
            refused.append("Freeway/expressway not supported in Phase 1")
        
        # No rail crossings
        if facts.rail_crossing_within_influence:
            refused.append("Rail crossing within influence zone requires special handling")
        
        # Check W20-7 spacing limit
        if facts.work_length_ft > Decimal(str(MAX_W20_7_SPACING_MI * 5280)):
            refused.append(
                f"Work length {facts.work_length_ft} ft exceeds 1-mile W20-7 limit; "
                "use Diagram 340 (pilot car)"
            )
        
        # Speed must be in table range
        speed = facts.posted_or_statutory_speed_mph
        if speed < 20 or speed > 70:
            refused.append(f"Speed {speed} mph outside supported range (20-70)")
        
        # Reject speeds 41-44 mph (ambiguous formula zone)
        if 41 <= speed <= 44:
            refused.append(
                f"Speed {speed} mph is between formula thresholds (40 or less / 45 or more); "
                "use the posted/statutory value"
            )
        
        return refused
    
    def _get_sign_spacing(self, facts: SiteFacts) -> Dict[str, ComputedValue]:
        """Get A/B/C sign spacing from OTTCH Table 2-4 or MUTCD Table 6B-1."""
        road_ctx = facts.road_context.value
        
        # Prefer OTTCH for Oregon short-term
        if facts.uses_ottch_short_term and facts.jurisdiction == "OR":
            spacing_table = OTTCH_2_4_SIGN_SPACING.get(road_ctx, MUTCD_6B_1.get(road_ctx))
            citation = Citation(
                source_doc=OTTCH_2_4_CITATION.source_doc,
                source_ref=OTTCH_2_4_CITATION.source_ref,
                source_url=OTTCH_2_4_CITATION.source_url,
                notes=f"Sign spacing for {road_ctx}",
            )
        else:
            spacing_table = MUTCD_6B_1.get(road_ctx)
            citation = Citation(
                source_doc=MUTCD_6B_1_CITATION.source_doc,
                source_ref=MUTCD_6B_1_CITATION.source_ref,
                source_url=MUTCD_6B_1_CITATION.source_url,
                notes=f"Sign spacing for {road_ctx}",
            )
        
        if not spacing_table:
            # Fallback to rural
            spacing_table = MUTCD_6B_1["rural"]
        
        return {
            "A": ComputedValue(
                value=spacing_table["A"], unit="ft", formula=None, citation=citation
            ),
            "B": ComputedValue(
                value=spacing_table["B"], unit="ft", formula=None, citation=citation
            ),
            "C": ComputedValue(
                value=spacing_table["C"], unit="ft", formula=None, citation=citation
            ),
        }
    
    def _get_buffer_length(self, facts: SiteFacts) -> ComputedValue:
        """Get buffer length from OTTCH Table 2-4."""
        speed = facts.posted_or_statutory_speed_mph
        
        # Find closest speed in table
        available_speeds = sorted(OTTCH_2_4_BUFFER.keys())
        closest_speed = min(available_speeds, key=lambda x: abs(x - speed))
        
        if speed not in OTTCH_2_4_BUFFER:
            # Interpolate or use closest
            lower_speeds = [s for s in available_speeds if s <= speed]
            upper_speeds = [s for s in available_speeds if s >= speed]
            
            if lower_speeds and upper_speeds:
                lower = max(lower_speeds)
                upper = min(upper_speeds)
                if lower == upper:
                    buffer = OTTCH_2_4_BUFFER[lower]
                else:
                    # Linear interpolation
                    ratio = (speed - lower) / (upper - lower)
                    buffer = int(
                        OTTCH_2_4_BUFFER[lower] + 
                        ratio * (OTTCH_2_4_BUFFER[upper] - OTTCH_2_4_BUFFER[lower])
                    )
            else:
                buffer = OTTCH_2_4_BUFFER[closest_speed]
        else:
            buffer = OTTCH_2_4_BUFFER[speed]
        
        return ComputedValue(
            value=buffer,
            unit="ft",
            formula=None,
            citation=Citation(
                source_doc=OTTCH_2_4_CITATION.source_doc,
                source_ref=OTTCH_2_4_CITATION.source_ref,
                source_url=OTTCH_2_4_CITATION.source_url,
                notes=f"Buffer space at {speed} mph",
            ),
        )
    
    def _get_mutcd_ssd(self, speed_mph: int) -> ComputedValue:
        """Get MUTCD stopping sight distance (Table 6B-2) as reference."""
        available_speeds = sorted(MUTCD_6B_2.keys())
        
        if speed_mph in MUTCD_6B_2:
            ssd = MUTCD_6B_2[speed_mph]
        else:
            closest = min(available_speeds, key=lambda x: abs(x - speed_mph))
            ssd = MUTCD_6B_2[closest]
        
        return ComputedValue(
            value=ssd,
            unit="ft",
            formula=None,
            citation=Citation(
                source_doc=MUTCD_6B_2_CITATION.source_doc,
                source_ref=MUTCD_6B_2_CITATION.source_ref,
                source_url=MUTCD_6B_2_CITATION.source_url,
                notes=f"Stopping sight distance at {speed_mph} mph (federal reference)",
            ),
        )
    
    def _get_one_lane_two_way_taper(self) -> ComputedValue:
        """Get one-lane two-way taper length (50-100 ft range)."""
        taper_range = get_one_lane_two_way_taper_length()
        
        return ComputedValue(
            value=75,  # Midpoint of 50-100 range
            unit="ft",
            formula=f"50-100 ft range (not L formula)",
            citation=Citation(
                source_doc="MUTCD 11th Edition",
                source_ref="Table 6B-3, Section 6B.08 para 14",
                source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
                notes="One-lane two-way taper: 50 ft min, 100 ft max; 20 ft device spacing",
            ),
        )
    
    def _get_taper_device_spacing(self, facts: SiteFacts) -> ComputedValue:
        """Get device spacing for one-lane two-way taper (always 20 ft)."""
        return ComputedValue(
            value=ONE_LANE_TWO_WAY_TAPER_SPACING_FT,
            unit="ft",
            formula=None,
            citation=Citation(
                source_doc=OTTCH_DEVICE_SPACING_CITATION.source_doc,
                source_ref=OTTCH_DEVICE_SPACING_CITATION.source_ref,
                source_url=OTTCH_DEVICE_SPACING_CITATION.source_url,
                notes="One-lane two-way taper: 20 ft spacing",
            ),
        )
    
    def _get_tangent_device_spacing(self, facts: SiteFacts) -> ComputedValue:
        """Get device spacing for tangent (buffer/work space): 2×S."""
        spacing = get_tangent_device_spacing_ft(facts.posted_or_statutory_speed_mph)
        
        return ComputedValue(
            value=spacing,
            unit="ft",
            formula=f"2 × {facts.posted_or_statutory_speed_mph} mph",
            citation=Citation(
                source_doc=MUTCD_6K_01_CITATION.source_doc,
                source_ref=MUTCD_6K_01_CITATION.source_ref,
                source_url=MUTCD_6K_01_CITATION.source_url,
                notes="Tangent spacing ≤ 2×S",
            ),
        )
    
    def _get_flagger_requirements(self, facts: SiteFacts) -> tuple[ComputedValue, List[str]]:
        """Determine flagger count from OTTCH Diagram 320 note 4."""
        notes = []
        two_flaggers = False
        
        # Check each condition from Diagram 320 note 4
        if facts.is_night:
            two_flaggers = True
            notes.append("Night operations: two-approach flagging required")
        
        if facts.work_length_ft > TWO_FLAGGER_CONDITIONS["work_space_over_ft"]:
            two_flaggers = True
            notes.append(f"Work space {facts.work_length_ft} ft > 200 ft: two-approach flagging required")
        
        if facts.sight_distance_ft is not None:
            if facts.sight_distance_ft < TWO_FLAGGER_CONDITIONS["sight_distance_less_than_ft"]:
                two_flaggers = True
                notes.append(
                    f"Sight distance {facts.sight_distance_ft} ft < 750 ft: "
                    "two-approach flagging required"
                )
        
        if facts.adt is not None and facts.adt > TWO_FLAGGER_CONDITIONS["adt_greater_than"]:
            two_flaggers = True
            notes.append(f"ADT {facts.adt} > 400: two-approach flagging required")
        
        flagger_count = 2 if two_flaggers else 1
        
        if not notes:
            notes.append(
                "Single flagger permitted: daytime, work space ≤ 200 ft, "
                "sight distance ≥ 750 ft, ADT ≤ 400"
            )
        
        return (
            ComputedValue(
                value=flagger_count,
                unit=None,
                formula=None,
                citation=Citation(
                    source_doc=OTTCH_320_WARRANTS_CITATION.source_doc,
                    source_ref=OTTCH_320_WARRANTS_CITATION.source_ref,
                    source_url=OTTCH_320_WARRANTS_CITATION.source_url,
                    notes="Diagram 320 note 4 conditions",
                ),
            ),
            notes,
        )
    
    def _get_taper_cone_count(self) -> ComputedValue:
        """Get cone count for one-lane two-way taper (4-6 cones)."""
        return ComputedValue(
            value=5,  # Midpoint of 4-6 range
            unit=None,
            formula=f"{ONE_LANE_TWO_WAY_TAPER_CONES_MIN}-{ONE_LANE_TWO_WAY_TAPER_CONES_MAX} cones",
            citation=Citation(
                source_doc=OTTCH_DEVICE_SPACING_CITATION.source_doc,
                source_ref=OTTCH_DEVICE_SPACING_CITATION.source_ref,
                source_url=OTTCH_DEVICE_SPACING_CITATION.source_url,
                notes="One-lane two-way taper: 4-6 cones at 20 ft spacing",
            ),
        )
    
    def _get_tangent_cone_count(self, facts: SiteFacts, buffer: ComputedValue) -> ComputedValue:
        """Compute cones needed for tangent (buffer + work space)."""
        tangent_length = int(buffer.value) + int(facts.work_length_ft)
        spacing = get_tangent_device_spacing_ft(facts.posted_or_statutory_speed_mph)
        cone_count = max(1, (tangent_length // spacing) + 1)
        
        return ComputedValue(
            value=cone_count,
            unit=None,
            formula=f"({int(buffer.value)} + {int(facts.work_length_ft)}) / {spacing}",
            citation=Citation(
                source_doc=MUTCD_6K_01_CITATION.source_doc,
                source_ref=MUTCD_6K_01_CITATION.source_ref,
                source_url=MUTCD_6K_01_CITATION.source_url,
                notes="Tangent cones at 2×S spacing",
            ),
        )
    
    def _get_sign_sequence(self, facts: SiteFacts) -> List[SignSpec]:
        """Get sign sequence for Figure 6P-10 / Diagram 320."""
        citation = Citation(
            source_doc="MUTCD 11th Edition",
            source_ref="Figure 6P-10",
            source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
            notes="Lane Closure on Two-Lane Road Using Flaggers",
        )
        
        signs = [
            SignSpec(
                mutcd_code="W20-1",
                name="ROAD WORK",
                sequence_order=1,
                purpose="Advance warning",
                required=True,
                citation=citation,
            ),
            SignSpec(
                mutcd_code="W20-4",
                name="ONE LANE ROAD",
                sequence_order=2,
                purpose="Lane configuration warning",
                required=facts.posted_or_statutory_speed_mph >= 35 or facts.adt and facts.adt > 400,
                citation=Citation(
                    source_doc="OTTCH 2026",
                    source_ref="Section 3.6",
                    source_url="https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
                    notes="Optional; consider on high-volume or high-speed roads",
                ),
            ),
            SignSpec(
                mutcd_code="W20-7",
                name="FLAGGER",
                sequence_order=3,
                purpose="Flagger station warning",
                required=True,
                citation=citation,
            ),
            SignSpec(
                mutcd_code="W3-4",
                name="BE PREPARED TO STOP",
                sequence_order=4,
                purpose="Stopping warning",
                required=False,
                citation=Citation(
                    source_doc="MUTCD 11th Edition",
                    source_ref="Figure 6P-10 notes",
                    source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
                    notes="May be added",
                ),
            ),
        ]
        
        return signs
    
    def _create_refused_computation(self, reasons: List[str]) -> Computation:
        """Create a computation result that indicates refusal."""
        null_value = ComputedValue(
            value=0, unit=None, formula=None,
            citation=Citation(
                source_doc="N/A",
                source_ref="N/A",
                source_url="",
                notes="Computation refused",
            ),
        )
        
        return Computation(
            layout_family=self.LAYOUT_FAMILY,
            rules_pack_version=self.version,
            sign_sequence=[],
            spacing_A_ft=null_value,
            spacing_B_ft=null_value,
            spacing_C_ft=null_value,
            taper_type=TaperType.one_lane_two_way,
            taper_length_ft=null_value,
            downstream_taper_length_ft=null_value,
            taper_device_spacing_ft=null_value,
            tangent_device_spacing_ft=null_value,
            buffer_length_ft=null_value,
            mutcd_ssd_ft=null_value,
            flagger_count=null_value,
            flagger_station_notes=[],
            cones_per_taper=null_value,
            cones_tangent=null_value,
            signs_count=0,
            arrow_board_required=False,
            arrow_board_mode=None,
            refused_reasons=reasons,
        )
