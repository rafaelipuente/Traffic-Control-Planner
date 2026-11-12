"""Vision extraction service using Claude."""
import base64
from typing import List, Dict, Any
from pathlib import Path
from app.config import get_settings
from app.models import SitePhoto

settings = get_settings()

VISION_PROMPT_V1 = """Analyze these work zone site photos and extract the following information.
Return ONLY a JSON object with the following structure. Every field should include a confidence score (0.0-1.0) and evidence notes.

Required fields to extract:
- road_type: "two_lane_two_way" | "multilane_divided" | "multilane_undivided" | "intersection"
- lane_count: integer (total lanes)
- lane_width_ft: estimated lane width in feet (10-14 typical)
- shoulder_present: boolean
- posted_speed_mph: integer if a speed limit sign is visible, null otherwise
- visible_hazards: array of observed hazards (curves, hills, driveways, etc.)
- intersections_nearby: boolean if intersections visible within ~500ft
- suggested_layout_family: "ottch_320_mutcd_ta10" for two-lane two-way flagging operations

Example response:
{
  "road_type": {"value": "two_lane_two_way", "confidence": 0.9, "evidence": "Clear view of opposing traffic lanes"},
  "lane_count": {"value": 2, "confidence": 0.95, "evidence": "Two lanes visible in both directions"},
  "lane_width_ft": {"value": 12, "confidence": 0.7, "evidence": "Estimated from vehicle width reference"},
  "shoulder_present": {"value": true, "confidence": 0.8, "evidence": "Gravel shoulder visible on right"},
  "posted_speed_mph": {"value": 35, "confidence": 1.0, "evidence": "Speed limit sign visible in photo 2"},
  "visible_hazards": [
    {"value": "curve_ahead", "confidence": 0.85, "evidence": "Road curves left ~300ft ahead"}
  ],
  "intersections_nearby": {"value": false, "confidence": 0.9, "evidence": "No visible cross streets"},
  "suggested_layout_family": {"value": "ottch_320_mutcd_ta10", "confidence": 0.85, "evidence": "Two-lane two-way road suitable for flagger operations"},
  "raw_observations": "Rural two-lane road, appears to be county road, good visibility, dry pavement"
}

IMPORTANT:
- Be conservative with confidence scores
- Mark posted_speed_mph as null if no speed sign is clearly visible
- Include ALL visible hazards even with low confidence
- Add raw_observations with any relevant details not captured in structured fields
"""


class VisionService:
    """Service for extracting site facts from photos using Claude vision."""
    
    def __init__(self):
        self.model_name = "claude-sonnet-4-20250514"
        self.prompt_version = "v1.0"
        self._client = None
    
    @property
    def client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        return self._client
    
    async def extract_site_facts(self, photos: List[SitePhoto]) -> Dict[str, Any]:
        """
        Extract site facts from photos using Claude vision.
        
        Returns structured JSON with confidence scores for each field.
        """
        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured")
        
        # Build image content for Claude
        content = []
        
        for i, photo in enumerate(photos[:5]):  # Limit to 5 photos
            # Read photo data
            photo_path = Path(f"/tmp/photos/{photo.object_key}")
            if photo_path.exists():
                with open(photo_path, "rb") as f:
                    image_data = base64.standard_b64encode(f.read()).decode("utf-8")
                
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": photo.content_type,
                        "data": image_data,
                    },
                })
                content.append({
                    "type": "text",
                    "text": f"Photo {i+1}: {photo.caption or 'Site photo'}",
                })
        
        if not content:
            raise ValueError("No readable photos found")
        
        content.append({
            "type": "text",
            "text": VISION_PROMPT_V1,
        })
        
        # Call Claude
        message = self.client.messages.create(
            model=self.model_name,
            max_tokens=2000,
            messages=[
                {"role": "user", "content": content}
            ],
        )
        
        # Parse response
        response_text = message.content[0].text
        
        # Extract JSON from response
        import json
        try:
            # Try to find JSON in the response
            start = response_text.find("{")
            end = response_text.rfind("}") + 1
            if start != -1 and end > start:
                return json.loads(response_text[start:end])
        except json.JSONDecodeError:
            pass
        
        # Return raw response if JSON parsing fails
        return {
            "raw_observations": response_text,
            "parsing_failed": True,
        }
