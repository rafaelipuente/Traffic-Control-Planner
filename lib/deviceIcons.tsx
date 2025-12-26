/**
 * Device Icon System for Map Mockup markers
 * 
 * This module provides a SINGLE source of truth for marker rendering.
 * Both auto-layout and manual edit-mode markers MUST use createDeviceMarkerElement().
 */

import { DeviceType, SignSubtype, SIGN_SUBTYPES } from "./layoutTypes";

/**
 * Sign icon paths - maps SignSubtype to SVG file path
 */
export const SIGN_ICON_SRC: Record<SignSubtype, string> = {
  roadWorkAhead: "/icons/signs/road-work-ahead.svg",
  bePreparedToStop: "/icons/signs/be-prepared-to-stop.svg",
  flaggerAhead: "/icons/signs/flagger-ahead.svg",
  rightLaneClosed: "/icons/signs/right-lane-closed.svg",
  leftLaneClosed: "/icons/signs/left-lane-closed.svg",
  oneLaneRoadAhead: "/icons/signs/one-lane-road.svg",
  generic: "/icons/signs/generic-warning.svg",
};

/**
 * Cone icon path
 */
export const CONE_ICON_SRC = "/icons/cones/cone.svg";

/**
 * Device marker size in pixels
 */
const MARKER_SIZE = 32;

/**
 * Get icon source for a device based on type and subtype
 */
export function getDeviceIconSrc(type: DeviceType, subtype?: SignSubtype): string {
  if (type === "cone") {
    return CONE_ICON_SRC;
  }
  if (type === "sign") {
    const src = SIGN_ICON_SRC[subtype || "generic"];
    if (!src) {
      console.warn(`[DeviceIcons] Unknown sign subtype: "${subtype}", using generic`);
      return SIGN_ICON_SRC.generic;
    }
    return src;
  }
  if (type === "drum" || type === "barricade") {
    // Drums and barricades use cone-like styling
    return CONE_ICON_SRC;
  }
  if (type === "arrowBoard" || type === "flagger") {
    // Arrow boards and flaggers use sign-like styling
    return SIGN_ICON_SRC.generic;
  }
  // UNKNOWN TYPE - this should never happen
  console.error(`[DeviceIcons] Unknown device type: "${type}"`);
  return SIGN_ICON_SRC.generic;
}

/**
 * Device data required for marker creation
 */
export interface DeviceForMarker {
  id: string;
  type: DeviceType;
  subtype?: SignSubtype;
  label?: string;
}

/**
 * Options for marker element creation
 */
export interface MarkerElementOptions {
  selected?: boolean;
  draggable?: boolean;
  size?: number;
}

/**
 * Create a DOM element for a device marker.
 * 
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR MARKER RENDERING.
 * Both auto-layout and manual edit-mode markers MUST use this function.
 * 
 * @param device - The device data (id, type, subtype, label)
 * @param options - Optional rendering options (selected, draggable, size)
 * @returns A div element configured as a map marker
 */
export function createDeviceMarkerElement(
  device: DeviceForMarker,
  options: MarkerElementOptions = {}
): HTMLDivElement {
  const { selected = false, draggable = false, size = MARKER_SIZE } = options;
  
  // INVARIANT: Validate device type
  if (!device.type) {
    console.error(`[MarkerFactory] INVARIANT VIOLATION: device.type is undefined/null for device ${device.id}`);
  }
  
  // INVARIANT: Sign must have subtype
  if (device.type === "sign" && !device.subtype) {
    console.warn(`[MarkerFactory] Sign device ${device.id} missing subtype, using "generic"`);
  }
  
  // Get the icon source based on device type
  const iconSrc = getDeviceIconSrc(device.type, device.subtype);
  
  // Create container element
  const el = document.createElement("div");
  el.className = `tcp-device tcp-device--${device.type}`;
  
  // Set data attributes for debugging and identification
  el.dataset.deviceId = device.id;
  el.dataset.deviceType = device.type;
  if (device.subtype) {
    el.dataset.signKind = device.subtype;
  }
  
  // Container styling
  el.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ${draggable ? "grab" : "pointer"};
    border-radius: 4px;
    background: ${selected ? "rgba(255, 179, 0, 0.2)" : "transparent"};
    border: ${selected ? "2px solid #FFB300" : "none"};
    box-shadow: ${selected ? "0 0 8px rgba(255, 179, 0, 0.5)" : "0 2px 4px rgba(0,0,0,0.2)"};
    transition: all 0.15s ease;
    pointer-events: auto;
    z-index: ${selected ? 20 : 10};
    position: relative;
  `;
  
  // Create image element for the icon
  const img = document.createElement("img");
  img.src = iconSrc;
  img.alt = device.type === "sign" 
    ? `Sign: ${SIGN_SUBTYPES[device.subtype || "generic"]?.label || "Warning"}`
    : "Traffic Cone";
  img.style.cssText = `
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  `;
  img.draggable = false;
  
  el.appendChild(img);
  
  // Add label badge if exists (for signs A, B, C, etc.)
  if (device.label) {
    const labelEl = document.createElement("span");
    labelEl.style.cssText = `
      position: absolute;
      top: -6px;
      right: -6px;
      background: ${device.type === "sign" ? "#FFB300" : "#FF6B00"};
      color: ${device.type === "sign" ? "#000" : "#fff"};
      font-size: 10px;
      font-weight: bold;
      padding: 1px 4px;
      border-radius: 4px;
      font-family: monospace;
      min-width: 14px;
      text-align: center;
      box-shadow: 0 1px 2px rgba(0,0,0,0.2);
    `;
    labelEl.textContent = device.label;
    el.appendChild(labelEl);
  }
  
  // Log marker creation for debugging
  console.log(`[MarkerCreate] id=${device.id} type=${device.type} subtype=${device.subtype || "none"} icon=${iconSrc}`);
  
  return el;
}

/**
 * Update an existing marker element (e.g., when selection state changes)
 */
export function updateMarkerElement(
  el: HTMLDivElement,
  options: { selected?: boolean; draggable?: boolean }
): void {
  const { selected = false, draggable = false } = options;
  
  el.style.background = selected ? "rgba(255, 179, 0, 0.2)" : "transparent";
  el.style.border = selected ? "2px solid #FFB300" : "none";
  el.style.boxShadow = selected ? "0 0 8px rgba(255, 179, 0, 0.5)" : "0 2px 4px rgba(0,0,0,0.2)";
  el.style.cursor = draggable ? "grab" : "pointer";
  el.style.zIndex = selected ? "20" : "10";
}

/**
 * Verify marker matches device data (for debugging)
 */
export function verifyMarkerDevice(el: HTMLElement, device: DeviceForMarker): boolean {
  const elId = el.dataset.deviceId;
  const elType = el.dataset.deviceType;
  const elSubtype = el.dataset.signKind;
  
  if (elId !== device.id) {
    console.error(`[MarkerVerify] ID mismatch: element=${elId} device=${device.id}`);
    return false;
  }
  if (elType !== device.type) {
    console.error(`[MarkerVerify] Type mismatch: element=${elType} device=${device.type}`);
    return false;
  }
  if (device.subtype && elSubtype !== device.subtype) {
    console.error(`[MarkerVerify] Subtype mismatch: element=${elSubtype} device=${device.subtype}`);
    return false;
  }
  
  return true;
}
