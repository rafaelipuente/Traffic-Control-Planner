# TCP Rules Pack v1.0

## Human-Readable Version with Citations

**Generated**: December 25, 2025  
**Sources**:
- Primary: 2025-TTCM Portland, MUTCD 11th Edition
- Supplemental: BP Guidebook

---

## Table of Contents

1. [Sign Types and Definitions](#1-sign-types-and-definitions)
2. [Work Zone Configurations](#2-work-zone-configurations)
3. [Spacing and Distance Rules](#3-spacing-and-distance-rules)
4. [Taper Rules](#4-taper-rules)
5. [Device Requirements](#5-device-requirements)
6. [Placement Constraints](#6-placement-constraints)
7. [Night Operations](#7-night-operations)
8. [Extraction Summary](#8-extraction-summary)

---

## 1. Sign Types and Definitions

### Warning Signs (Orange Background)

| Code | MUTCD | Label | Sizes | Description |
|------|-------|-------|-------|-------------|
| ROAD_WORK_AHEAD | W20-1 | Road Work Ahead | 36", 48" | Advance warning sign placed upstream of work zone |
| BE_PREPARED_TO_STOP | W3-4 | Be Prepared To Stop | 36", 48" | Warning for potential stopping requirement ahead |
| FLAGGER_AHEAD | CW23-2 | Flagger Ahead | 36", 48" | **Note**: CW23-2 preferred over W20-7a per TTCM Portland |
| RIGHT_LANE_CLOSED | W20-5R | Right Lane Closed | 36", 48" | Warning of right lane closure ahead |
| LEFT_LANE_CLOSED | W20-5L | Left Lane Closed | 36", 48" | Warning of left lane closure ahead |
| ONE_LANE_ROAD | W20-4 | One Lane Road Ahead | 36", 48" | Warning of road narrowing to single lane |
| WORKERS_AHEAD | W21-1 | Workers Ahead | 36", 48" | Warning of workers in or near roadway |

### Guide Signs (Green Background)

| Code | MUTCD | Label | Description |
|------|-------|-------|-------------|
| END_ROAD_WORK | G20-2 | End Road Work | Indicates end of work zone |
| DETOUR | M4-8 | Detour | Detour route indicator |

### Regulatory Signs (Red/White)

| Code | MUTCD | Label | Description |
|------|-------|-------|-------------|
| ROAD_CLOSED | R11-2 | Road Closed | Road closure regulatory sign |

> **Citation**: 2025-TTCM_portland.pdf, Section 2.2 Signs, Page 14-16

---

## 2. Work Zone Configurations

### Road Segment Work

**Required Signs**: ROAD_WORK_AHEAD  
**Optional Signs**: BE_PREPARED_TO_STOP, WORKERS_AHEAD, END_ROAD_WORK  
**Sign Order** (upstream → downstream): ROAD_WORK_AHEAD → BE_PREPARED_TO_STOP → WORKERS_AHEAD  
**Minimum Advance Warning**: 100 ft

**Special Conditions**:
- Additional ROAD WORK AHEAD (W20-1) and BE PREPARED TO STOP signing upstream if extended queues develop

> **Citation**: 2025-TTCM_portland.pdf, Section 3.5 Flagging Signs & Equipment, Page 28

### Intersection Work

**Required Signs**: ROAD_WORK_AHEAD  
**Optional Signs**: BE_PREPARED_TO_STOP, FLAGGER_AHEAD  
**Flaggers Required**: YES

**Special Conditions**:
- One flagger per approach recommended
- One flagger per movement on approach if multiple lanes
- Conflicting regulatory signs (STOP, YIELD) **SHALL** be covered

> **Citation**: 2025-TTCM_portland.pdf, Section 3.6 Flagging Through Intersections, Page 28-29

### Lane Closure

**Required Signs**: ROAD_WORK_AHEAD, RIGHT_LANE_CLOSED (or LEFT_LANE_CLOSED)  
**Arrow Board Required**: YES

**Special Conditions**:
- Arrow board required for overnight lane closure at 30mph+
- Drums required in merge taper for overnight closure at 30mph+
- Do not use arrow board for lane shift, only closure

> **Citation**: 2025-TTCM_portland.pdf, Section 2.7.3 Arrow Boards, Page 22-23

### Mobile Work (≤60 minutes)

| Duration | Requirements |
|----------|-------------|
| Up to 15 min | Vehicle hazard warning lights + one beacon |
| 16-60 min | Short taper (6 cones, 50ft), beacon, one advance warning sign |
| Any duration lane closure on high-speed | TMA + truck-mounted arrow board |

> **Citation**: 2025-TTCM_portland.pdf, Section 4.1.7 Mobile Work, Page 33-34

---

## 3. Spacing and Distance Rules

### Formulas

**Cone Spacing**: Maximum spacing = S feet (where S = speed in mph)  
- **Reduced to ½S** when conflicting with pavement markings

**Taper Length**:
- Speed ≤ 40 mph: **L = W × S**
- Speed > 40 mph: **L = W × S² / 60**

Where:
- L = taper length in feet
- W = lane width (typically 12 ft)
- S = speed limit in mph

### Spacing by Speed Table

| Speed (mph) | Sign Spacing (ft) | Cone Spacing (ft) | Taper Length (ft) | Buffer Length (ft) |
|-------------|------------------|-------------------|-------------------|-------------------|
| 25 | 100 | 25 (12.5 reduced) | 75 | 50 |
| 30 | 100 | 15* | 90 | 75 |
| 35 | 200 | 35 (17.5 reduced) | 180 | 100 |
| 40 | 350 | 40 | 240 | 150 |
| 45 | 350 | 45 | 405 | 200 |
| 50 | 500 | 50 | 500 | 250 |
| 55 | 500 | 55 | 605 | 300 |

*30 mph shows reduced spacing (½S = 15ft) for conflicting markings example

> **Citation**: 2025-TTCM_portland.pdf, Section 2.3 Channelizing Devices, Page 16-17; MUTCD Table 6H-3

---

## 4. Taper Rules

### Lane Closure Taper

| Speed (mph) | Taper Length (ft) | Cone Spacing (ft) | Drums Required |
|-------------|-------------------|-------------------|----------------|
| 25 | 75 | 20 | No |
| 30 | 120 | 20 | Only overnight |
| 35 | 180 | 20 | **Yes** |
| 40 | 240 | 20 | **Yes** |
| 45 | 405 | 20 | **Yes** |

**Rule**: Drums **SHALL** be placed within any merge or shift taper on multi-lane roadways with speed limit ≥30 mph requiring overnight closure.

> **Citation**: 2025-TTCM_portland.pdf, Section 2.3.3 Plastic Drums (Barrels), Page 17

---

## 5. Device Requirements

### Cones

| Condition | Min Height | Reflective | Weighted Base |
|-----------|-----------|------------|---------------|
| Busy Streets | 28" | Yes | Yes |
| Lower Classification (Day) | 18" | No | Yes |
| Night Operations | 28" | **Yes** | Yes |

**IMPORTANT CONSTRAINTS**:
- Cones **SHOULD NOT** be used in unoccupied work sites (prone to wind movement)
- Cones **SHALL NOT** be used for pedestrian channelization

> **Citation**: 2025-TTCM_portland.pdf, Section 2.3.2 Cones, Page 17

### Drums (Barrels)

**Required when**:
- Merge tapers on high-speed streets (35 mph+)
- Overnight lane closures at 30 mph+

**Purpose**: Provide larger retroreflective area for approaching vehicles

> **Citation**: 2025-TTCM_portland.pdf, Section 2.3.3 Plastic Drums (Barrels), Page 17

---

## 6. Placement Constraints

### SHALL Requirements (Mandatory)

| ID | Requirement | Citation |
|----|-------------|----------|
| SIGN_OUTSIDE_WORK_ZONE | Warning signs must be placed upstream of and outside the active work zone | Section 2.2 Signs |
| CONES_NOT_FOR_PEDESTRIANS | Cones shall not be used for pedestrian channelization | Section 2.3.2, Page 17 |
| FIRE_APPARATUS_WIDTH | Fire apparatus require minimum 11 feet width through work zone | Section 1.13, Page 7 |
| ARROW_BOARD_LANE_CLOSURE_ONLY | Arrow boards shall only be used to indicate lane closure, not lane shift | Section 2.7.3, Page 22-23 |
| FLAGGER_STOP_SIGNAL_PROHIBITED | Traffic cannot be flagged to proceed through red signal/STOP sign (ORS 811.265) | Section 3.3, Page 26 |

### SHOULD Requirements (Best Practice)

| ID | Requirement | Citation |
|----|-------------|----------|
| SIGN_CLEAR_OF_BIKE_LANE | Signs should not restrict bike lanes/sidewalks to less than 4 feet | Section 2.2, Page 14 |
| PARKING_CLEARANCE_30MPH | Remove 20 feet of parking in front of sign at ≤30 mph | Section 2.2, Page 15 |
| PARKING_CLEARANCE_35MPH | Remove 40 feet of parking in front of sign at ≥35 mph | Section 2.2, Page 15 |
| MIN_LANE_WIDTH | Motorized vehicle lanes should be maintained to 10 feet minimum | Section 4.1.4, Page 31 |
| LATERAL_BUFFER | At least 2 feet lateral buffer space should separate traffic from work zone | Section 4.1.5, Page 32 |
| MAX_FLAGGER_DELAY | Vehicles should not be delayed more than 5 minutes at flagger station | Section 3.3, Page 26 |

### Sign Placement Guidelines

| Sign | Position | Offset from Work Zone | Lateral Position |
|------|----------|----------------------|------------------|
| ROAD_WORK_AHEAD | Upstream | 100-500 ft (typical: 200 ft) | Right shoulder |
| BE_PREPARED_TO_STOP | Upstream | 100-350 ft (typical: 150 ft) | Right shoulder |
| FLAGGER_AHEAD | Upstream | 100-350 ft (typical: 100 ft) | Right shoulder |

> **Note**: On one-way streets with 2+ lanes, signs should be placed on BOTH left and right sides.

---

## 7. Night Operations

### Requirements

1. **ALL** TCDs shall be retroreflective
2. TCDs and worker apparel should provide visibility from **1000 feet**
3. Pedestrian diversions and lanes adjacent to sidewalk closures should be adequately lit
4. Cones shall be at least **28 inches tall** and retroreflective
5. Flagger stations shall be illuminated separately from work space

> **Citation**: 2025-TTCM_portland.pdf, Section 4.1.6 Night Time Operations, Page 32-33

---

## 8. Extraction Summary

### Pages Used

| PDF | Pages | Sections |
|-----|-------|----------|
| 2025-TTCM_portland.pdf | 1-50 (Appendix excluded) | Sections 1-4, Glossary |
| mutcd11thedition.pdf | Part 6 (6C, 6H) | Temporary Traffic Control Zones |
| bpguidebook.pdf | Various | Supplemental best practices |

### What Was Extracted

1. **Sign Types**: 10 sign codes with MUTCD references, sizes, and descriptions
2. **Work Zone Configurations**: 6 configurations (Road Segment, Intersection, Lane Closure, Full Closure, Shoulder Work, Mobile)
3. **Spacing Rules**: Formula-based + lookup tables for speeds 25-55 mph
4. **Taper Rules**: Lane closure, lane shift, and merging tapers
5. **Device Requirements**: Cones and drums with condition-specific rules
6. **Placement Constraints**: 13 constraints (5 SHALL, 8 SHOULD)
7. **Night Operations**: 5 specific requirements

### Known Limitations

1. MUTCD 11th Edition PDF was too large to fully parse; extracted general principles from Part 6
2. Specific figure references (TAs) from TTCM Portland not included (require visual interpretation)
3. Best Practice Guidebook rules marked as recommendations, not requirements

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-25 | Initial extraction from TTCM Portland 2025, MUTCD 11e, BP Guidebook |

