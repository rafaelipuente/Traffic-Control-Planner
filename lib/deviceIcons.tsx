/**
 * SVG-based device icon components for Map Mockup markers
 * 
 * These replace emoji markers with proper SVG icons that:
 * - Render consistently across all browsers
 * - Scale cleanly at different sizes
 * - Support theming/coloring
 * - Are always derived from device.type/subtype
 */

import { DeviceType, SignSubtype, SIGN_SUBTYPES } from "./layoutTypes";

/**
 * Props for device marker elements
 */
export interface DeviceMarkerProps {
  type: DeviceType;
  subtype?: SignSubtype;
  size?: number;
  selected?: boolean;
  label?: string;
}

/**
 * Traffic Cone SVG Icon
 */
export function ConeIcon({ size = 24, selected = false }: { size?: number; selected?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cone body - orange with stripes */}
      <path 
        d="M12 2L5 20H19L12 2Z" 
        fill={selected ? "#FFB300" : "#FF6B00"} 
        stroke="#000" 
        strokeWidth="1"
      />
      {/* White reflective stripes */}
      <path d="M7 14H17" stroke="white" strokeWidth="2" />
      <path d="M8 18H16" stroke="white" strokeWidth="2" />
      {/* Base */}
      <rect x="4" y="20" width="16" height="2" fill="#333" rx="0.5" />
    </svg>
  );
}

/**
 * Warning Sign SVG Icon (diamond shape with subtype text)
 */
export function SignIcon({ 
  size = 24, 
  selected = false, 
  subtype = "generic" 
}: { 
  size?: number; 
  selected?: boolean; 
  subtype?: SignSubtype;
}) {
  const config = SIGN_SUBTYPES[subtype] || SIGN_SUBTYPES.generic;
  const bgColor = selected ? "#FFD54F" : config.backgroundColor;
  
  // For small markers, show abbreviated text
  const abbreviation = getSignAbbreviation(subtype);
  
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Diamond background */}
      <path 
        d="M12 1L23 12L12 23L1 12L12 1Z" 
        fill={bgColor}
        stroke="#000"
        strokeWidth="1.5"
      />
      {/* Text abbreviation */}
      <text 
        x="12" 
        y="14" 
        textAnchor="middle" 
        fill={config.color}
        fontSize="7"
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
      >
        {abbreviation}
      </text>
    </svg>
  );
}

/**
 * Get abbreviated sign text for marker display
 */
function getSignAbbreviation(subtype: SignSubtype): string {
  switch (subtype) {
    case "roadWorkAhead": return "RW";
    case "bePreparedToStop": return "STOP";
    case "flaggerAhead": return "FL";
    case "rightLaneClosed": return "R←";
    case "leftLaneClosed": return "←L";
    case "oneLaneRoadAhead": return "1L";
    case "generic":
    default: return "⚠";
  }
}

/**
 * Arrow Board SVG Icon
 */
export function ArrowBoardIcon({ size = 24, selected = false, rotation = 0 }: { size?: number; selected?: boolean; rotation?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Board background */}
      <rect x="2" y="6" width="20" height="12" fill="#1a1a1a" stroke={selected ? "#FFB300" : "#333"} strokeWidth="1" rx="1" />
      {/* Arrow lights */}
      <g transform={`rotate(${rotation} 12 12)`}>
        <circle cx="6" cy="12" r="2" fill="#FFB300" />
        <circle cx="10" cy="12" r="2" fill="#FFB300" />
        <circle cx="14" cy="12" r="2" fill="#FFB300" />
        <path d="M16 12L20 9V15L16 12Z" fill="#FFB300" />
      </g>
    </svg>
  );
}

/**
 * Flagger SVG Icon
 */
export function FlaggerIcon({ size = 24, selected = false }: { size?: number; selected?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Head */}
      <circle cx="12" cy="4" r="3" fill={selected ? "#FFB300" : "#FCD34D"} stroke="#333" strokeWidth="0.5" />
      {/* Hard hat */}
      <path d="M9 3.5C9 2.5 10 2 12 2C14 2 15 2.5 15 3.5" stroke="#FFB300" strokeWidth="1.5" />
      {/* Body (safety vest) */}
      <path d="M9 8L8 20H16L15 8H9Z" fill={selected ? "#FFB300" : "#FF6B00"} stroke="#333" strokeWidth="0.5" />
      {/* Reflective stripes */}
      <path d="M9 12H15" stroke="#FFFF00" strokeWidth="1.5" />
      <path d="M9 16H15" stroke="#FFFF00" strokeWidth="1.5" />
      {/* Arms with flag */}
      <path d="M8 10L4 8" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16 10L20 6" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
      {/* Flag */}
      <rect x="19" y="3" width="4" height="5" fill="#EF4444" />
    </svg>
  );
}

/**
 * Traffic Drum SVG Icon
 */
export function DrumIcon({ size = 24, selected = false }: { size?: number; selected?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Drum body */}
      <ellipse cx="12" cy="4" rx="6" ry="2" fill={selected ? "#FFB300" : "#FF6B00"} stroke="#333" strokeWidth="0.5" />
      <path d="M6 4V20C6 21 8.7 22 12 22C15.3 22 18 21 18 20V4" fill={selected ? "#FFB300" : "#FF6B00"} stroke="#333" strokeWidth="0.5" />
      {/* White stripes */}
      <path d="M6 8C6 9 8.7 10 12 10C15.3 10 18 9 18 8" stroke="white" strokeWidth="2" />
      <path d="M6 14C6 15 8.7 16 12 16C15.3 16 18 15 18 14" stroke="white" strokeWidth="2" />
    </svg>
  );
}

/**
 * Barricade SVG Icon
 */
export function BarricadeIcon({ size = 24, selected = false }: { size?: number; selected?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Top rail */}
      <rect x="2" y="6" width="20" height="4" fill={selected ? "#FFB300" : "#FF6B00"} stroke="#333" strokeWidth="0.5" />
      {/* White stripe on rail */}
      <rect x="4" y="7" width="4" height="2" fill="white" />
      <rect x="10" y="7" width="4" height="2" fill="white" />
      <rect x="16" y="7" width="4" height="2" fill="white" />
      {/* Legs */}
      <path d="M4 10L3 20" stroke="#333" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 10L7 20" stroke="#333" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 10L17 20" stroke="#333" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 10L21 20" stroke="#333" strokeWidth="2" strokeLinecap="round" />
      {/* Cross braces */}
      <path d="M5 15L18 15" stroke="#333" strokeWidth="1" />
    </svg>
  );
}

/**
 * Create a DOM element for a device marker
 * This is the SINGLE source of truth for marker visuals
 */
export function createDeviceMarkerElement(
  device: { type: DeviceType; subtype?: SignSubtype; label?: string; id: string },
  options: { selected?: boolean; draggable?: boolean } = {}
): HTMLDivElement {
  const { selected = false, draggable = false } = options;
  
  const el = document.createElement("div");
  el.className = "device-marker";
  el.setAttribute("data-device-type", device.type);
  el.setAttribute("data-device-id", device.id);
  if (device.subtype) {
    el.setAttribute("data-device-subtype", device.subtype);
  }
  
  // Container styling
  el.style.cssText = `
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ${draggable ? "grab" : "pointer"};
    border-radius: 50%;
    background: ${selected ? "#FFF3E0" : "white"};
    border: 2px solid ${selected ? "#FFB300" : getDeviceColor(device.type)};
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    transition: all 0.15s ease;
    pointer-events: auto;
    z-index: ${selected ? 20 : 10};
    position: relative;
  `;
  
  // Create SVG icon
  const svgHtml = getDeviceSvgHtml(device.type, device.subtype, 20, selected);
  el.innerHTML = svgHtml;
  
  // Add label badge if exists
  if (device.label) {
    const labelEl = document.createElement("span");
    labelEl.style.cssText = `
      position: absolute;
      top: -6px;
      right: -6px;
      background: ${getDeviceColor(device.type)};
      color: white;
      font-size: 9px;
      font-weight: bold;
      padding: 1px 4px;
      border-radius: 4px;
      font-family: monospace;
      min-width: 14px;
      text-align: center;
    `;
    labelEl.textContent = device.label;
    el.appendChild(labelEl);
  }
  
  return el;
}

/**
 * Get color for a device type
 */
function getDeviceColor(type: DeviceType): string {
  const colors: Record<DeviceType, string> = {
    cone: "#FF6B00",
    sign: "#FFB300",
    arrowBoard: "#FFB300",
    flagger: "#EF4444",
    drum: "#FF6B00",
    barricade: "#FFB300",
  };
  return colors[type] || "#666";
}

/**
 * Get SVG HTML string for a device (for innerHTML insertion)
 */
function getDeviceSvgHtml(type: DeviceType, subtype?: SignSubtype, size = 20, selected = false): string {
  switch (type) {
    case "cone":
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L5 20H19L12 2Z" fill="${selected ? "#FFB300" : "#FF6B00"}" stroke="#000" stroke-width="1"/>
        <path d="M7 14H17" stroke="white" stroke-width="2"/>
        <path d="M8 18H16" stroke="white" stroke-width="2"/>
        <rect x="4" y="20" width="16" height="2" fill="#333" rx="0.5"/>
      </svg>`;
      
    case "sign":
      const signConfig = SIGN_SUBTYPES[subtype || "generic"];
      const bgColor = selected ? "#FFD54F" : signConfig.backgroundColor;
      const abbrev = getSignAbbreviation(subtype || "generic");
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <path d="M12 1L23 12L12 23L1 12L12 1Z" fill="${bgColor}" stroke="#000" stroke-width="1.5"/>
        <text x="12" y="14" text-anchor="middle" fill="${signConfig.color}" font-size="7" font-weight="bold" font-family="Arial">${abbrev}</text>
      </svg>`;
      
    case "arrowBoard":
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="6" width="20" height="12" fill="#1a1a1a" stroke="${selected ? "#FFB300" : "#333"}" stroke-width="1" rx="1"/>
        <circle cx="6" cy="12" r="2" fill="#FFB300"/>
        <circle cx="10" cy="12" r="2" fill="#FFB300"/>
        <circle cx="14" cy="12" r="2" fill="#FFB300"/>
        <path d="M16 12L20 9V15L16 12Z" fill="#FFB300"/>
      </svg>`;
      
    case "flagger":
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="4" r="3" fill="${selected ? "#FFB300" : "#FCD34D"}" stroke="#333" stroke-width="0.5"/>
        <path d="M9 3.5C9 2.5 10 2 12 2C14 2 15 2.5 15 3.5" stroke="#FFB300" stroke-width="1.5"/>
        <path d="M9 8L8 20H16L15 8H9Z" fill="${selected ? "#FFB300" : "#FF6B00"}" stroke="#333" stroke-width="0.5"/>
        <path d="M9 12H15" stroke="#FFFF00" stroke-width="1.5"/>
        <path d="M9 16H15" stroke="#FFFF00" stroke-width="1.5"/>
        <path d="M8 10L4 8" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M16 10L20 6" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
        <rect x="19" y="3" width="4" height="5" fill="#EF4444"/>
      </svg>`;
      
    case "drum":
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="4" rx="6" ry="2" fill="${selected ? "#FFB300" : "#FF6B00"}" stroke="#333" stroke-width="0.5"/>
        <path d="M6 4V20C6 21 8.7 22 12 22C15.3 22 18 21 18 20V4" fill="${selected ? "#FFB300" : "#FF6B00"}" stroke="#333" stroke-width="0.5"/>
        <path d="M6 8C6 9 8.7 10 12 10C15.3 10 18 9 18 8" stroke="white" stroke-width="2"/>
        <path d="M6 14C6 15 8.7 16 12 16C15.3 16 18 15 18 14" stroke="white" stroke-width="2"/>
      </svg>`;
      
    case "barricade":
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="6" width="20" height="4" fill="${selected ? "#FFB300" : "#FF6B00"}" stroke="#333" stroke-width="0.5"/>
        <rect x="4" y="7" width="4" height="2" fill="white"/>
        <rect x="10" y="7" width="4" height="2" fill="white"/>
        <rect x="16" y="7" width="4" height="2" fill="white"/>
        <path d="M4 10L3 20" stroke="#333" stroke-width="2" stroke-linecap="round"/>
        <path d="M8 10L7 20" stroke="#333" stroke-width="2" stroke-linecap="round"/>
        <path d="M16 10L17 20" stroke="#333" stroke-width="2" stroke-linecap="round"/>
        <path d="M20 10L21 20" stroke="#333" stroke-width="2" stroke-linecap="round"/>
        <path d="M5 15L18 15" stroke="#333" stroke-width="1"/>
      </svg>`;
      
    default:
      // Fallback: question mark
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#EF4444" stroke="#fff" stroke-width="1"/>
        <text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="bold">?</text>
      </svg>`;
  }
}

