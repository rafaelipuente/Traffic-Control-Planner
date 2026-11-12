"""
MUTCD 11th Edition and OTTCH 2026 table data.

IMPORTANT: All values are quoted directly from official sources.
Source citations are included for each table.

Values marked TODO require verification from the official PDF.
"""
from decimal import Decimal
from typing import Dict, List, Optional
from dataclasses import dataclass

RULES_PACK_VERSION = "mutcd11e+ottch2026.1"


@dataclass(frozen=True)
class Citation:
    """Source citation for a table value."""
    source_doc: str
    source_ref: str
    source_url: str
    notes: Optional[str] = None


# =============================================================================
# MUTCD 11th Edition Tables
# =============================================================================

# Table 6B-1: Recommended Advance Warning Sign Minimum Spacing
# Source: MUTCD 11th Edition, Part 6, Table 6B-1
# URL: https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf
MUTCD_6B_1_CITATION = Citation(
    source_doc="MUTCD 11th Edition",
    source_ref="Table 6B-1",
    source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
    notes="Recommended Advance Warning Sign Minimum Spacing",
)

MUTCD_6B_1: Dict[str, Dict[str, int]] = {
    "urban_low_speed": {"A": 100, "B": 100, "C": 100},
    "urban_high_speed": {"A": 350, "B": 350, "C": 350},
    "rural": {"A": 500, "B": 500, "C": 500},
    "expressway_freeway": {"A": 1000, "B": 1500, "C": 2640},
}


# Table 6B-2: Stopping Sight Distance as a Function of Speed
# Source: MUTCD 11th Edition, Part 6, Table 6B-2
# URL: https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf
MUTCD_6B_2_CITATION = Citation(
    source_doc="MUTCD 11th Edition",
    source_ref="Table 6B-2",
    source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
    notes="Stopping Sight Distance (also suggested longitudinal buffer and flagger-station distance)",
)

MUTCD_6B_2: Dict[int, int] = {
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
}


# Table 6B-3: Taper Length Criteria
# Source: MUTCD 11th Edition, Part 6, Table 6B-3
MUTCD_6B_3_CITATION = Citation(
    source_doc="MUTCD 11th Edition",
    source_ref="Table 6B-3",
    source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
    notes="Taper Length Criteria for Temporary Traffic Control Zones",
)

# Taper types and their length rules
MUTCD_6B_3 = {
    "merging": "at least L",
    "shifting": "at least 0.5 L",
    "shoulder": "at least 0.33 L",
    "one_lane_two_way": {"min_ft": 50, "max_ft": 100},
    "downstream": {"min_ft": 50, "max_ft": 100},
}


# Table 6B-4: Formulas for Determining Taper Length L
# Source: MUTCD 11th Edition, Part 6, Table 6B-4
# CRITICAL: The CORRECT formulas are:
#   - 40 mph or less: L = W * S^2 / 60
#   - 45 mph or more: L = W * S
MUTCD_6B_4_CITATION = Citation(
    source_doc="MUTCD 11th Edition",
    source_ref="Table 6B-4",
    source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
    notes="L=WS²/60 at 40 mph or less; L=WS at 45 mph or more",
)


# Section 6K.01: Channelizing Device Spacing
# Source: MUTCD 11th Edition, Section 6K.01 Guidance paragraph 04
MUTCD_6K_01_CITATION = Citation(
    source_doc="MUTCD 11th Edition",
    source_ref="Section 6K.01 para 04",
    source_url="https://mutcd.fhwa.dot.gov/pdfs/11th_Edition/part6.pdf",
    notes="Taper spacing ≤ 1×S ft; tangent spacing ≤ 2×S ft",
)


# =============================================================================
# OTTCH 2026 Tables
# =============================================================================

# Table 2-1: Taper Length Formulas (matches MUTCD 6B-4)
# Source: OTTCH 2026, page 15
OTTCH_2_1_CITATION = Citation(
    source_doc="OTTCH 2026",
    source_ref="Table 2-1",
    source_url="https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
    notes="Taper length formulas (matches MUTCD Table 6B-4)",
)


# Table 2-2: Taper Types and Lengths
# Source: OTTCH 2026, page 15
OTTCH_2_2_CITATION = Citation(
    source_doc="OTTCH 2026",
    source_ref="Table 2-2",
    source_url="https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
    notes="Taper Types and Lengths",
)

OTTCH_2_2 = {
    "merging": "L (minimum)",
    "shifting": "L/2 (minimum)",
    "shoulder": "L/3 (minimum)",
    "one_lane_two_way": {"min_ft": 50, "max_ft": 100},
    "downstream": {"min_ft": 50, "max_ft": 100},
}


# Table 2-3: Taper Lengths and Device Quantities
# Source: OTTCH 2026, page 15
# These are for MERGING tapers (not one-lane two-way tapers)
OTTCH_2_3_CITATION = Citation(
    source_doc="OTTCH 2026",
    source_ref="Table 2-3",
    source_url="https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
    notes="Taper lengths L for merging/shifting at 12ft lane width",
)

# Format: speed_mph -> {merging_L_ft, shifting_L_2_ft, merging_cones, shifting_cones}
# Lane width: 12 ft
OTTCH_2_3_12FT: Dict[int, Dict[str, int]] = {
    20: {"merging_L_ft": 80, "shifting_L_2_ft": 40, "merging_cones": 5, "shifting_cones": 3},
    25: {"merging_L_ft": 125, "shifting_L_2_ft": 65, "merging_cones": 6, "shifting_cones": 4},
    30: {"merging_L_ft": 180, "shifting_L_2_ft": 90, "merging_cones": 7, "shifting_cones": 4},
    35: {"merging_L_ft": 245, "shifting_L_2_ft": 125, "merging_cones": 8, "shifting_cones": 5},
    40: {"merging_L_ft": 320, "shifting_L_2_ft": 160, "merging_cones": 9, "shifting_cones": 5},
    45: {"merging_L_ft": 540, "shifting_L_2_ft": 270, "merging_cones": 13, "shifting_cones": 7},
    50: {"merging_L_ft": 600, "shifting_L_2_ft": 300, "merging_cones": 13, "shifting_cones": 7},
    55: {"merging_L_ft": 660, "shifting_L_2_ft": 330, "merging_cones": 13, "shifting_cones": 7},
    60: {"merging_L_ft": 720, "shifting_L_2_ft": 360, "merging_cones": 13, "shifting_cones": 7},
    65: {"merging_L_ft": 780, "shifting_L_2_ft": 390, "merging_cones": 13, "shifting_cones": 7},
    70: {"merging_L_ft": 840, "shifting_L_2_ft": 420, "merging_cones": 13, "shifting_cones": 7},
}

# Lane width: 10 ft - TODO: verify from PDF page 15
# Lane width: 11 ft - TODO: verify from PDF page 15


# Table 2-4: Sign Spacing and Buffer Lengths
# Source: OTTCH 2026, page 20
# NOTE: A/B/C groupings need verification from PDF page 20
OTTCH_2_4_CITATION = Citation(
    source_doc="OTTCH 2026",
    source_ref="Table 2-4",
    source_url="https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
    notes="Sign spacing and buffer lengths by speed",
)

# Buffer space values - verified from doc
OTTCH_2_4_BUFFER: Dict[int, int] = {
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
}

# Sign spacing A/B/C by road context
# TODO: Verify exact speed breakpoints from PDF page 20
OTTCH_2_4_SIGN_SPACING: Dict[str, Dict[str, int]] = {
    "urban_low_speed": {"A": 100, "B": 100, "C": 100},
    "urban_high_speed": {"A": 350, "B": 350, "C": 350},
    "rural": {"A": 500, "B": 500, "C": 500},
    # Visible in doc: for freeway matches MUTCD
    "expressway_freeway": {"A": 1000, "B": 1500, "C": 2640},
}


# =============================================================================
# Diagram 320 Warrants
# =============================================================================

# Source: OTTCH 2026, Diagram 320 notes (page 88)
OTTCH_320_WARRANTS_CITATION = Citation(
    source_doc="OTTCH 2026",
    source_ref="Diagram 320 notes",
    source_url="https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
    notes="Two-flagger conditions from Diagram 320 note 4",
)

# From Diagram 320 note 4: Two-approach flagging required if ANY of:
TWO_FLAGGER_CONDITIONS = {
    "is_night": True,  # Night operations
    "work_space_over_ft": 200,  # Work space > 200 ft
    "sight_distance_less_than_ft": 750,  # Sight distance < 750 ft from each approach
    "adt_greater_than": 400,  # Traffic > 400 ADT
}

# From Section 3.1 / Diagram 320 note 5
MAX_W20_7_SPACING_MI = 1.0  # W20-7 to W20-7 should not exceed 1 mile


# =============================================================================
# Device Spacing Rules
# =============================================================================

# From OTTCH Section 2.3
OTTCH_DEVICE_SPACING_CITATION = Citation(
    source_doc="OTTCH 2026",
    source_ref="Section 2.3",
    source_url="https://www.oregon.gov/odot/Engineering/Docs_TrafficEng/OTTCH-2026.pdf",
    notes="Device spacing rules",
)

# One-lane two-way and downstream tapers: 20 ft spacing, 4-6 cones
ONE_LANE_TWO_WAY_TAPER_SPACING_FT = 20
ONE_LANE_TWO_WAY_TAPER_CONES_MIN = 4
ONE_LANE_TWO_WAY_TAPER_CONES_MAX = 6


def get_taper_device_spacing_ft(speed_mph: int, taper_type: str) -> int:
    """
    Get device spacing for tapers.
    
    - One-lane two-way and downstream: 20 ft (OTTCH 2.3)
    - Other tapers: 1×S where S=speed (MUTCD 6K.01)
    """
    if taper_type in ("one_lane_two_way", "downstream"):
        return ONE_LANE_TWO_WAY_TAPER_SPACING_FT
    return speed_mph


def get_tangent_device_spacing_ft(speed_mph: int) -> int:
    """Get device spacing for tangent (buffer/work space): 2×S (MUTCD 6K.01)."""
    return speed_mph * 2


def compute_merging_taper_L(speed_mph: int, lane_width_ft: Decimal) -> Decimal:
    """
    Compute merging taper length L using MUTCD Table 6B-4 / OTTCH Table 2-1.
    
    CORRECT FORMULAS (from MUTCD 11th Edition):
    - 40 mph or less: L = W × S² / 60
    - 45 mph or more: L = W × S
    """
    W = lane_width_ft
    S = Decimal(speed_mph)
    
    if speed_mph <= 40:
        return W * S * S / Decimal(60)
    else:
        return W * S


def get_one_lane_two_way_taper_length() -> Dict[str, int]:
    """
    One-lane two-way taper length from MUTCD Table 6B-3 / OTTCH Table 2-2.
    Returns min/max range (50-100 ft) instead of L formula.
    """
    return {"min_ft": 50, "max_ft": 100}
