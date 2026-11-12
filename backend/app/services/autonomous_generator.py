"""
Autonomous TCP Generation Service

Uses Claude with tool-use/structured output to generate complete TCP layouts.
Implements self-correction loop: generate → validate → if errors, retry with violations.
"""
import os
import time
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Any, Tuple
from uuid import UUID

from anthropic import Anthropic, APIError, APIConnectionError, RateLimitError

from app.rules.validator import LayoutValidator, LayoutInput, SiteContext, ValidationResult
from app.rules.tables import (
    MUTCD_6B_1, OTTCH_2_4_SIGN_SPACING, OTTCH_2_4_BUFFER,
    compute_merging_taper_L, get_one_lane_two_way_taper_length,
)

logger = logging.getLogger(__name__)


MAX_AUTONOMOUS_ATTEMPTS = int(os.getenv("MAX_AUTONOMOUS_ATTEMPTS", "4"))
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")


@dataclass
class GenerationAttemptResult:
    """Result of a single generation attempt."""
    attempt_number: int
    generated_layout: Optional[Dict[str, Any]]
    validation_result: Optional[ValidationResult]
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    total_tokens: Optional[int]
    latency_ms: int
    model_name: str
    model_version: Optional[str]
    api_error: bool = False
    error_message: Optional[str] = None
    malformed_json: bool = False
    started_at: datetime = None
    completed_at: datetime = None
    
    def __post_init__(self):
        if self.started_at is None:
            self.started_at = datetime.utcnow()


@dataclass
class AutonomousGenerationResult:
    """Final result of autonomous generation."""
    success: bool
    final_layout: Optional[Dict[str, Any]]
    final_validation: Optional[ValidationResult]
    attempts: List[GenerationAttemptResult]
    total_attempts: int
    model_name: str
    model_version: Optional[str]
    best_attempt_number: Optional[int]
    status: str  # "autonomous_validated" or "autonomous_failed_validation"


TCP_LAYOUT_SCHEMA = {
    "type": "object",
    "properties": {
        "spacing_A_ft": {"type": "integer", "description": "Distance from first advance warning sign (W20-1) to work zone in feet"},
        "spacing_B_ft": {"type": "integer", "description": "Distance between W20-1 and W20-7 signs in feet"},
        "spacing_C_ft": {"type": "integer", "description": "Distance from last warning sign to taper in feet"},
        "taper_type": {
            "type": "string",
            "enum": ["one_lane_two_way", "merging", "shifting", "shoulder", "downstream"],
            "description": "Type of taper based on lane closure configuration"
        },
        "taper_length_ft": {"type": "integer", "description": "Length of approach taper in feet"},
        "downstream_taper_length_ft": {"type": "integer", "description": "Length of downstream taper in feet"},
        "taper_device_spacing_ft": {"type": "integer", "description": "Spacing between channelizing devices in taper in feet"},
        "buffer_length_ft": {"type": "integer", "description": "Length of buffer space before work area in feet"},
        "tangent_device_spacing_ft": {"type": "integer", "description": "Spacing between channelizing devices in tangent/work area in feet"},
        "flagger_count": {"type": "integer", "description": "Number of flaggers (1 or 2)"},
        "flagger_station_positions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Positions of flagger stations (e.g., 'upstream_approach', 'downstream_approach')"
        },
        "sign_sequence": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "mutcd_code": {"type": "string"},
                    "legend": {"type": "string"},
                    "position": {"type": "string"},
                    "required": {"type": "boolean"}
                },
                "required": ["mutcd_code", "position"]
            },
            "description": "Sequence of signs from upstream to downstream"
        },
        "cone_count": {"type": "integer", "description": "Total number of traffic cones"},
        "drum_count": {"type": "integer", "description": "Total number of drums"},
        "arrow_board_present": {"type": "boolean", "description": "Whether arrow board is present"},
        "arrow_board_mode": {
            "type": ["string", "null"],
            "enum": ["caution", "flashing", "sequential", None],
            "description": "Arrow board mode if present"
        },
        "assumptions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Assumptions made about missing or ambiguous data"
        },
        "reasoning": {
            "type": "string",
            "description": "Brief explanation of key decisions in the layout"
        }
    },
    "required": [
        "spacing_A_ft", "spacing_B_ft", "spacing_C_ft",
        "taper_type", "taper_length_ft", "downstream_taper_length_ft", "taper_device_spacing_ft",
        "buffer_length_ft", "tangent_device_spacing_ft",
        "flagger_count", "flagger_station_positions",
        "sign_sequence", "cone_count", "drum_count",
        "arrow_board_present", "assumptions"
    ]
}


def build_system_prompt() -> str:
    """Build the system prompt with MUTCD/OTTCH rules."""
    return """You are a Traffic Control Plan (TCP) generator. Your task is to generate a complete TCP layout based on site conditions, following MUTCD 11th Edition Part 6 and OTTCH 2026 standards.

CRITICAL TAPER FORMULAS - DO NOT INVERT:
- For speeds ≤ 40 mph: L = W × S² / 60
- For speeds ≥ 45 mph: L = W × S
Where L = taper length, W = lane width (ft), S = posted speed (mph)

ONE-LANE TWO-WAY TAPERS:
- DO NOT use the L formula
- Use fixed range: 50-100 ft (typically 75 ft)
- Device spacing: 20 ft

SIGN SPACING (Table 6B-1):
- Urban low speed (<45 mph): A=100ft, B=100ft, C=100ft
- Urban high speed (≥45 mph): A=350ft, B=350ft, C=350ft
- Rural: A=500ft, B=500ft, C=500ft
- Expressway/freeway: A=1000ft, B=1500ft, C=2640ft

BUFFER LENGTH (OTTCH Table 2-4):
- 25 mph: 40 ft
- 30 mph: 60 ft
- 35 mph: 100 ft
- 40 mph: 140 ft
- 45 mph: 200 ft
- 50 mph: 250 ft
- 55 mph: 300 ft

CHANNELIZER SPACING (MUTCD 6K.01):
- Taper: ≤ 1×S feet
- Tangent: ≤ 2×S feet
- One-lane two-way taper: 20 ft fixed

FLAGGER REQUIREMENTS (OTTCH Diagram 320 Note 4):
Two flaggers required when ANY of:
- Night operations
- Work space > 250 ft
- Sight distance < 500 ft
- ADT > 2000

REQUIRED SIGNS for flagger operation (Figure 6P-10):
- W20-1 (ROAD WORK AHEAD)
- W20-7 (FLAGGER AHEAD)

When generating a layout, you MUST:
1. Use the CORRECT taper formula based on speed
2. Round to practical values (nearest 5 or 10 ft)
3. Document any assumptions made
4. Ensure device counts are consistent with lengths and spacing"""


def build_generation_prompt(context: SiteContext, site_photos_summary: Optional[str] = None, previous_violations: Optional[List[Dict]] = None) -> str:
    """Build the generation prompt for Claude."""
    prompt = f"""Generate a complete TCP layout for the following site:

SITE CONDITIONS:
- Posted speed: {context.posted_speed_mph} mph
- Road context: {context.road_context}
- Lane count: {context.lane_count}
- Lane width: {context.lane_width_ft} ft
- Work zone length: {context.work_length_ft} ft
- Night work: {'Yes' if context.is_night else 'No'}
- Control method: {context.control_method}
- Jurisdiction: {context.jurisdiction}
"""
    
    if context.sight_distance_ft:
        prompt += f"- Sight distance: {context.sight_distance_ft} ft\n"
    
    if context.adt:
        prompt += f"- ADT: {context.adt}\n"
    
    if site_photos_summary:
        prompt += f"\nSITE PHOTOS ANALYSIS:\n{site_photos_summary}\n"
    
    if previous_violations:
        prompt += "\n⚠️ PREVIOUS ATTEMPT HAD VALIDATION ERRORS. FIX THESE:\n"
        for v in previous_violations:
            prompt += f"- {v['rule_id']}: {v['message']}\n"
            prompt += f"  Expected: {v['expected']}, Got: {v['actual']}\n"
        prompt += "\nMake sure to correct ALL violations listed above.\n"
    
    prompt += "\nGenerate the TCP layout following all MUTCD and OTTCH requirements."
    
    return prompt


class AutonomousGenerator:
    """
    Generates TCP layouts using Claude with self-correction loop.
    """
    
    def __init__(self):
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable is required")
        self.client = Anthropic(api_key=api_key)
        self.validator = LayoutValidator()
        self.model = ANTHROPIC_MODEL
    
    def generate(
        self,
        context: SiteContext,
        site_photos_summary: Optional[str] = None,
        triggering_user_id: Optional[UUID] = None,
    ) -> AutonomousGenerationResult:
        """
        Generate a TCP layout with self-correction loop.
        
        Returns result with validation status and all attempts for audit.
        """
        attempts: List[GenerationAttemptResult] = []
        best_attempt: Optional[GenerationAttemptResult] = None
        best_error_count = float('inf')
        previous_violations: Optional[List[Dict]] = None
        
        for attempt_num in range(1, MAX_AUTONOMOUS_ATTEMPTS + 1):
            logger.info(f"Autonomous generation attempt {attempt_num}/{MAX_AUTONOMOUS_ATTEMPTS}")
            
            result = self._single_attempt(
                attempt_number=attempt_num,
                context=context,
                site_photos_summary=site_photos_summary,
                previous_violations=previous_violations,
            )
            attempts.append(result)
            
            # Handle API errors
            if result.api_error:
                logger.error(f"API error on attempt {attempt_num}: {result.error_message}")
                continue
            
            # Handle malformed JSON
            if result.malformed_json:
                logger.warning(f"Malformed JSON on attempt {attempt_num}")
                previous_violations = [{
                    "rule_id": "JSON_PARSE_ERROR",
                    "message": "Previous response was not valid JSON. Return ONLY valid JSON.",
                    "expected": "Valid JSON object",
                    "actual": "Parse error",
                }]
                continue
            
            # Track best attempt (fewest errors)
            if result.validation_result:
                if result.validation_result.error_count < best_error_count:
                    best_error_count = result.validation_result.error_count
                    best_attempt = result
                
                # Check if validation passed
                if result.validation_result.passed:
                    logger.info(f"Validation passed on attempt {attempt_num}")
                    return AutonomousGenerationResult(
                        success=True,
                        final_layout=result.generated_layout,
                        final_validation=result.validation_result,
                        attempts=attempts,
                        total_attempts=attempt_num,
                        model_name=self.model,
                        model_version=None,
                        best_attempt_number=attempt_num,
                        status="autonomous_validated",
                    )
                
                # Prepare violations for next attempt
                previous_violations = [v.to_dict() for v in result.validation_result.violations if v.severity.value == "error"]
                logger.info(f"Attempt {attempt_num} had {result.validation_result.error_count} errors, retrying...")
        
        # Hit max attempts without passing validation
        logger.warning(f"Hit max attempts ({MAX_AUTONOMOUS_ATTEMPTS}) without passing validation")
        
        return AutonomousGenerationResult(
            success=False,
            final_layout=best_attempt.generated_layout if best_attempt else None,
            final_validation=best_attempt.validation_result if best_attempt else None,
            attempts=attempts,
            total_attempts=MAX_AUTONOMOUS_ATTEMPTS,
            model_name=self.model,
            model_version=None,
            best_attempt_number=attempts.index(best_attempt) + 1 if best_attempt else None,
            status="autonomous_failed_validation",
        )
    
    def _single_attempt(
        self,
        attempt_number: int,
        context: SiteContext,
        site_photos_summary: Optional[str],
        previous_violations: Optional[List[Dict]],
    ) -> GenerationAttemptResult:
        """Execute a single generation + validation attempt."""
        started_at = datetime.utcnow()
        start_time = time.time()
        
        try:
            # Build prompt
            user_prompt = build_generation_prompt(context, site_photos_summary, previous_violations)
            
            # Call Claude with tool use for structured output
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=build_system_prompt(),
                tools=[{
                    "name": "generate_tcp_layout",
                    "description": "Generate a complete TCP layout with all required fields",
                    "input_schema": TCP_LAYOUT_SCHEMA,
                }],
                tool_choice={"type": "tool", "name": "generate_tcp_layout"},
                messages=[{"role": "user", "content": user_prompt}],
            )
            
            latency_ms = int((time.time() - start_time) * 1000)
            completed_at = datetime.utcnow()
            
            # Extract tool use result
            tool_use = None
            for block in response.content:
                if block.type == "tool_use" and block.name == "generate_tcp_layout":
                    tool_use = block
                    break
            
            if not tool_use:
                return GenerationAttemptResult(
                    attempt_number=attempt_number,
                    generated_layout=None,
                    validation_result=None,
                    prompt_tokens=response.usage.input_tokens if response.usage else None,
                    completion_tokens=response.usage.output_tokens if response.usage else None,
                    total_tokens=(response.usage.input_tokens + response.usage.output_tokens) if response.usage else None,
                    latency_ms=latency_ms,
                    model_name=self.model,
                    model_version=None,
                    api_error=False,
                    error_message="No tool use found in response",
                    malformed_json=True,
                    started_at=started_at,
                    completed_at=completed_at,
                )
            
            layout_dict = tool_use.input
            
            # Parse into LayoutInput for validation
            try:
                layout = LayoutInput(
                    spacing_A_ft=layout_dict["spacing_A_ft"],
                    spacing_B_ft=layout_dict["spacing_B_ft"],
                    spacing_C_ft=layout_dict["spacing_C_ft"],
                    taper_type=layout_dict["taper_type"],
                    taper_length_ft=layout_dict["taper_length_ft"],
                    downstream_taper_length_ft=layout_dict["downstream_taper_length_ft"],
                    taper_device_spacing_ft=layout_dict["taper_device_spacing_ft"],
                    buffer_length_ft=layout_dict["buffer_length_ft"],
                    tangent_device_spacing_ft=layout_dict["tangent_device_spacing_ft"],
                    flagger_count=layout_dict["flagger_count"],
                    flagger_station_positions=layout_dict.get("flagger_station_positions", []),
                    sign_sequence=layout_dict.get("sign_sequence", []),
                    cone_count=layout_dict["cone_count"],
                    drum_count=layout_dict["drum_count"],
                    arrow_board_present=layout_dict["arrow_board_present"],
                    arrow_board_mode=layout_dict.get("arrow_board_mode"),
                    assumptions=layout_dict.get("assumptions", []),
                )
            except (KeyError, TypeError) as e:
                return GenerationAttemptResult(
                    attempt_number=attempt_number,
                    generated_layout=layout_dict,
                    validation_result=None,
                    prompt_tokens=response.usage.input_tokens if response.usage else None,
                    completion_tokens=response.usage.output_tokens if response.usage else None,
                    total_tokens=(response.usage.input_tokens + response.usage.output_tokens) if response.usage else None,
                    latency_ms=latency_ms,
                    model_name=self.model,
                    model_version=None,
                    api_error=False,
                    error_message=f"Failed to parse layout: {e}",
                    malformed_json=True,
                    started_at=started_at,
                    completed_at=completed_at,
                )
            
            # Validate
            validation_result = self.validator.validate(layout, context)
            
            return GenerationAttemptResult(
                attempt_number=attempt_number,
                generated_layout=layout_dict,
                validation_result=validation_result,
                prompt_tokens=response.usage.input_tokens if response.usage else None,
                completion_tokens=response.usage.output_tokens if response.usage else None,
                total_tokens=(response.usage.input_tokens + response.usage.output_tokens) if response.usage else None,
                latency_ms=latency_ms,
                model_name=self.model,
                model_version=None,
                started_at=started_at,
                completed_at=completed_at,
            )
        
        except (APIError, APIConnectionError, RateLimitError) as e:
            latency_ms = int((time.time() - start_time) * 1000)
            return GenerationAttemptResult(
                attempt_number=attempt_number,
                generated_layout=None,
                validation_result=None,
                prompt_tokens=None,
                completion_tokens=None,
                total_tokens=None,
                latency_ms=latency_ms,
                model_name=self.model,
                model_version=None,
                api_error=True,
                error_message=str(e),
                started_at=started_at,
                completed_at=datetime.utcnow(),
            )
        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            logger.exception("Unexpected error during generation")
            return GenerationAttemptResult(
                attempt_number=attempt_number,
                generated_layout=None,
                validation_result=None,
                prompt_tokens=None,
                completion_tokens=None,
                total_tokens=None,
                latency_ms=latency_ms,
                model_name=self.model,
                model_version=None,
                api_error=True,
                error_message=f"Unexpected error: {e}",
                started_at=started_at,
                completed_at=datetime.utcnow(),
            )
