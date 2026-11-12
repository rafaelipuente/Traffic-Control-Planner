"""Tests for autonomous TCP generation service.

These tests mock the Anthropic API to verify the self-correction loop behavior.
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from decimal import Decimal
from datetime import datetime

from app.services.autonomous_generator import (
    AutonomousGenerator,
    GenerationAttemptResult,
    AutonomousGenerationResult,
    TCP_LAYOUT_SCHEMA,
    build_system_prompt,
    build_generation_prompt,
)
from app.rules.validator import SiteContext, LayoutValidator


@pytest.fixture
def site_context():
    """Standard site context for testing."""
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
def valid_layout_dict():
    """A valid AI-generated layout that passes validation."""
    return {
        "spacing_A_ft": 500,
        "spacing_B_ft": 500,
        "spacing_C_ft": 500,
        "taper_type": "one_lane_two_way",
        "taper_length_ft": 75,
        "downstream_taper_length_ft": 75,
        "taper_device_spacing_ft": 20,
        "buffer_length_ft": 125,  # 125 ft for 35 mph per OTTCH
        "tangent_device_spacing_ft": 70,
        "flagger_count": 2,  # 2 flaggers for ADT > 400 or sight < 750
        "flagger_station_positions": ["upstream_approach", "downstream_approach"],
        "sign_sequence": [
            {"mutcd_code": "W20-1", "position": "advance", "required": True},
            {"mutcd_code": "W20-7", "position": "advance", "required": True},
        ],
        "cone_count": 30,
        "drum_count": 0,
        "arrow_board_present": False,
        "arrow_board_mode": None,
        "assumptions": ["Assumed clear sight lines"],
        "reasoning": "Standard rural one-lane setup",
    }


@pytest.fixture
def invalid_layout_dict():
    """An invalid layout with violations."""
    return {
        "spacing_A_ft": 200,  # Too short for rural
        "spacing_B_ft": 200,
        "spacing_C_ft": 200,
        "taper_type": "one_lane_two_way",
        "taper_length_ft": 200,  # Outside 50-100 range
        "downstream_taper_length_ft": 75,
        "taper_device_spacing_ft": 20,
        "buffer_length_ft": 50,  # Too short
        "tangent_device_spacing_ft": 70,
        "flagger_count": 2,  # Correct for ADT > 400
        "flagger_station_positions": ["upstream_approach", "downstream_approach"],
        "sign_sequence": [
            {"mutcd_code": "W20-1", "position": "advance", "required": True},
            {"mutcd_code": "W20-7", "position": "advance", "required": True},
        ],
        "cone_count": 30,
        "drum_count": 0,
        "arrow_board_present": False,
        "arrow_board_mode": None,
        "assumptions": [],
        "reasoning": "Initial attempt",
    }


def create_mock_response(layout_dict, input_tokens=500, output_tokens=300):
    """Create a mock Anthropic API response with tool use."""
    mock_tool_use = MagicMock()
    mock_tool_use.type = "tool_use"
    mock_tool_use.name = "generate_tcp_layout"
    mock_tool_use.input = layout_dict
    
    mock_usage = MagicMock()
    mock_usage.input_tokens = input_tokens
    mock_usage.output_tokens = output_tokens
    
    mock_response = MagicMock()
    mock_response.content = [mock_tool_use]
    mock_response.usage = mock_usage
    
    return mock_response


class TestPromptBuilding:
    """Tests for prompt construction."""
    
    def test_system_prompt_contains_correct_formulas(self):
        """System prompt should have CORRECT taper formulas."""
        prompt = build_system_prompt()
        
        # Must have correct formulas, not inverted
        assert "≤ 40 mph: L = W × S² / 60" in prompt
        assert "≥ 45 mph: L = W × S" in prompt
        
        # Must mention one-lane exception
        assert "50-100 ft" in prompt
        
    def test_generation_prompt_includes_violations(self, site_context):
        """Generation prompt should include previous violations for retry."""
        violations = [
            {
                "rule_id": "SIGN-SPACING-A-MIN",
                "message": "Sign spacing A too short",
                "expected": ">= 500 ft",
                "actual": "200 ft",
            }
        ]
        
        prompt = build_generation_prompt(
            context=site_context,
            previous_violations=violations,
        )
        
        assert "PREVIOUS ATTEMPT HAD VALIDATION ERRORS" in prompt
        assert "SIGN-SPACING-A-MIN" in prompt
        assert "500 ft" in prompt


class TestGenerationLoop:
    """Tests for the self-correction generation loop."""
    
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_passes_first_try(self, mock_anthropic_class, site_context, valid_layout_dict):
        """If AI generates valid layout on first try, should return success."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        mock_client.messages.create.return_value = create_mock_response(valid_layout_dict)
        
        generator = AutonomousGenerator()
        result = generator.generate(site_context)
        
        assert result.success
        assert result.status == "autonomous_validated"
        assert result.total_attempts == 1
        assert len(result.attempts) == 1
        assert result.attempts[0].validation_result.passed
        
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_passes_after_correction(self, mock_anthropic_class, site_context, invalid_layout_dict, valid_layout_dict):
        """If first attempt fails, should retry and pass on second attempt."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        
        # First call returns invalid layout, second returns valid
        mock_client.messages.create.side_effect = [
            create_mock_response(invalid_layout_dict),
            create_mock_response(valid_layout_dict),
        ]
        
        generator = AutonomousGenerator()
        result = generator.generate(site_context)
        
        assert result.success
        assert result.status == "autonomous_validated"
        assert result.total_attempts == 2
        assert len(result.attempts) == 2
        assert not result.attempts[0].validation_result.passed
        assert result.attempts[1].validation_result.passed
        
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key', 'MAX_AUTONOMOUS_ATTEMPTS': '3'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_hits_max_attempts_cap(self, mock_anthropic_class, site_context, invalid_layout_dict):
        """If all attempts fail, should return failure with best attempt."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        
        # All attempts return invalid layout
        mock_client.messages.create.return_value = create_mock_response(invalid_layout_dict)
        
        # Patch MAX_AUTONOMOUS_ATTEMPTS
        with patch('app.services.autonomous_generator.MAX_AUTONOMOUS_ATTEMPTS', 3):
            generator = AutonomousGenerator()
            result = generator.generate(site_context)
        
        assert not result.success
        assert result.status == "autonomous_failed_validation"
        assert result.total_attempts == 3
        assert len(result.attempts) == 3
        assert result.best_attempt_number is not None
        
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_handles_malformed_json(self, mock_anthropic_class, site_context, valid_layout_dict):
        """Should handle malformed JSON and retry."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        
        # First response has no tool use (malformed)
        mock_bad_response = MagicMock()
        mock_bad_response.content = []  # No tool use block
        mock_bad_response.usage = MagicMock()
        mock_bad_response.usage.input_tokens = 500
        mock_bad_response.usage.output_tokens = 300
        
        # Second response is valid
        mock_client.messages.create.side_effect = [
            mock_bad_response,
            create_mock_response(valid_layout_dict),
        ]
        
        generator = AutonomousGenerator()
        result = generator.generate(site_context)
        
        assert result.success
        assert result.total_attempts == 2
        assert result.attempts[0].malformed_json
        
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_handles_api_error(self, mock_anthropic_class, site_context, valid_layout_dict):
        """Should handle API errors and retry."""
        from anthropic import APIError
        
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        
        # First call raises API error, second succeeds
        mock_client.messages.create.side_effect = [
            APIError(message="Rate limited", request=MagicMock(), body=None),
            create_mock_response(valid_layout_dict),
        ]
        
        generator = AutonomousGenerator()
        result = generator.generate(site_context)
        
        assert result.success
        assert result.total_attempts == 2
        assert result.attempts[0].api_error
        assert result.attempts[0].error_message is not None


class TestAttemptTracking:
    """Tests for generation attempt tracking."""
    
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_tracks_token_usage(self, mock_anthropic_class, site_context, valid_layout_dict):
        """Should track token usage for each attempt."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        mock_client.messages.create.return_value = create_mock_response(
            valid_layout_dict,
            input_tokens=1234,
            output_tokens=567,
        )
        
        generator = AutonomousGenerator()
        result = generator.generate(site_context)
        
        attempt = result.attempts[0]
        assert attempt.prompt_tokens == 1234
        assert attempt.completion_tokens == 567
        assert attempt.total_tokens == 1801
        
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_tracks_latency(self, mock_anthropic_class, site_context, valid_layout_dict):
        """Should track latency for each attempt."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        mock_client.messages.create.return_value = create_mock_response(valid_layout_dict)
        
        generator = AutonomousGenerator()
        result = generator.generate(site_context)
        
        attempt = result.attempts[0]
        assert attempt.latency_ms is not None
        assert attempt.latency_ms >= 0
        
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_tracks_model_info(self, mock_anthropic_class, site_context, valid_layout_dict):
        """Should track model name for each attempt."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        mock_client.messages.create.return_value = create_mock_response(valid_layout_dict)
        
        generator = AutonomousGenerator()
        result = generator.generate(site_context)
        
        assert result.model_name is not None
        assert "claude" in result.model_name.lower()


class TestBestAttemptSelection:
    """Tests for selecting the best attempt when all fail."""
    
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key', 'MAX_AUTONOMOUS_ATTEMPTS': '3'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_selects_attempt_with_fewest_errors(self, mock_anthropic_class, site_context):
        """Should select the attempt with fewest errors as best."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        
        # Create layouts with different error counts
        layout_5_errors = {
            "spacing_A_ft": 100, "spacing_B_ft": 100, "spacing_C_ft": 100,
            "taper_type": "one_lane_two_way",
            "taper_length_ft": 200,  # Error
            "downstream_taper_length_ft": 200,  # Error
            "taper_device_spacing_ft": 20,
            "buffer_length_ft": 20,  # Error
            "tangent_device_spacing_ft": 70,
            "flagger_count": 1,
            "flagger_station_positions": [],
            "sign_sequence": [],  # Missing required signs
            "cone_count": 5, "drum_count": 0,
            "arrow_board_present": False, "arrow_board_mode": None,
            "assumptions": [],
        }
        
        layout_2_errors = {
            "spacing_A_ft": 500, "spacing_B_ft": 500, "spacing_C_ft": 500,
            "taper_type": "one_lane_two_way",
            "taper_length_ft": 200,  # Error: outside range
            "downstream_taper_length_ft": 75,
            "taper_device_spacing_ft": 20,
            "buffer_length_ft": 50,  # Error: too short
            "tangent_device_spacing_ft": 70,
            "flagger_count": 1,
            "flagger_station_positions": ["upstream_approach"],
            "sign_sequence": [
                {"mutcd_code": "W20-1", "position": "advance", "required": True},
                {"mutcd_code": "W20-7", "position": "advance", "required": True},
            ],
            "cone_count": 30, "drum_count": 0,
            "arrow_board_present": False, "arrow_board_mode": None,
            "assumptions": [],
        }
        
        mock_client.messages.create.side_effect = [
            create_mock_response(layout_5_errors),
            create_mock_response(layout_2_errors),  # Better
            create_mock_response(layout_5_errors),
        ]
        
        with patch('app.services.autonomous_generator.MAX_AUTONOMOUS_ATTEMPTS', 3):
            generator = AutonomousGenerator()
            result = generator.generate(site_context)
        
        assert not result.success
        assert result.best_attempt_number == 2  # The one with fewer errors


class TestEnvironmentVariables:
    """Tests for environment variable handling."""
    
    def test_requires_api_key(self):
        """Should raise error if ANTHROPIC_API_KEY not set."""
        with patch.dict('os.environ', {}, clear=True):
            with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
                AutonomousGenerator()
                
    @patch.dict('os.environ', {'ANTHROPIC_API_KEY': 'test-key', 'MAX_AUTONOMOUS_ATTEMPTS': '2'})
    @patch('app.services.autonomous_generator.Anthropic')
    def test_respects_max_attempts_env(self, mock_anthropic_class, site_context, invalid_layout_dict):
        """Should respect MAX_AUTONOMOUS_ATTEMPTS environment variable."""
        mock_client = MagicMock()
        mock_anthropic_class.return_value = mock_client
        mock_client.messages.create.return_value = create_mock_response(invalid_layout_dict)
        
        with patch('app.services.autonomous_generator.MAX_AUTONOMOUS_ATTEMPTS', 2):
            generator = AutonomousGenerator()
            result = generator.generate(site_context)
        
        assert result.total_attempts == 2


class TestTCPLayoutSchema:
    """Tests for the TCP layout JSON schema."""
    
    def test_schema_has_required_fields(self):
        """Schema should require all necessary fields."""
        required = TCP_LAYOUT_SCHEMA["required"]
        
        assert "spacing_A_ft" in required
        assert "spacing_B_ft" in required
        assert "spacing_C_ft" in required
        assert "taper_type" in required
        assert "taper_length_ft" in required
        assert "buffer_length_ft" in required
        assert "flagger_count" in required
        assert "sign_sequence" in required
        
    def test_schema_taper_type_enum(self):
        """Schema should constrain taper type to valid options."""
        taper_enum = TCP_LAYOUT_SCHEMA["properties"]["taper_type"]["enum"]
        
        assert "one_lane_two_way" in taper_enum
        assert "merging" in taper_enum
        assert "shifting" in taper_enum
