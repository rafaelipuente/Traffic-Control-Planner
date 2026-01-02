/**
 * Sanitizes modern CSS Color Level 4 functions (lab, oklch, oklab, lch) 
 * for html2canvas compatibility.
 * 
 * html2canvas does NOT support CSS Color Level 4 color functions.
 * This utility converts all such colors to sRGB equivalents using
 * computed styles from the browser.
 * 
 * IMPORTANT: This should only be called on a CLONED DOM tree,
 * never on the live DOM, as it mutates element styles/attributes.
 */

// Pattern to detect modern color functions that html2canvas can't parse
const MODERN_COLOR_PATTERN = /lab\(|oklch\(|oklab\(|lch\(|color\(/i;

// SVG presentation attributes that can contain colors
const SVG_COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'];

// CSS properties that can contain colors
const CSS_COLOR_PROPS = [
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
];

interface SanitizeResult {
  totalElementsProcessed: number;
  elementsSanitized: number;
  attributesSanitized: number;
  stylePropertiesSanitized: number;
}

/**
 * Check if a color string contains modern color functions
 */
function containsModernColor(value: string | null): boolean {
  if (!value) return false;
  return MODERN_COLOR_PATTERN.test(value);
}

/**
 * Get a safe RGB fallback color from computed style
 * Falls back to explicit defaults if computed style returns modern colors
 */
function getSafeColor(computed: CSSStyleDeclaration | null, property: string, fallback: string): string {
  if (!computed) return fallback;
  
  const value = computed.getPropertyValue(property);
  
  // If computed style still contains modern color (shouldn't happen, but safety check)
  if (containsModernColor(value)) {
    return fallback;
  }
  
  // If value is empty or invalid, use fallback
  if (!value || value === 'none' || value === 'transparent') {
    return fallback;
  }
  
  return value;
}

/**
 * Sanitize a single SVG element's color attributes and styles
 */
function sanitizeSvgElement(
  el: SVGElement,
  doc: Document,
  result: SanitizeResult
): void {
  const computed = doc.defaultView?.getComputedStyle(el) || null;
  
  // Check and sanitize SVG presentation attributes
  for (const attr of SVG_COLOR_ATTRS) {
    const attrValue = el.getAttribute(attr);
    if (containsModernColor(attrValue)) {
      // Get the computed RGB value
      const safeColor = getSafeColor(computed, attr, attr === 'fill' ? '#1f2937' : '#000000');
      el.setAttribute(attr, safeColor);
      result.attributesSanitized++;
    }
  }
  
  // Check inline style attribute
  const styleAttr = el.getAttribute('style');
  if (styleAttr && containsModernColor(styleAttr)) {
    // Parse and replace each property that might have modern colors
    for (const prop of CSS_COLOR_PROPS) {
      const inlineValue = el.style.getPropertyValue(prop);
      if (containsModernColor(inlineValue)) {
        const safeColor = getSafeColor(computed, prop, '#1f2937');
        el.style.setProperty(prop, safeColor, 'important');
        result.stylePropertiesSanitized++;
      }
    }
  }
}

/**
 * Sanitize a single HTML element's color styles
 */
function sanitizeHtmlElement(
  el: HTMLElement,
  doc: Document,
  result: SanitizeResult
): void {
  const computed = doc.defaultView?.getComputedStyle(el) || null;
  
  // Check and sanitize CSS color properties
  for (const prop of CSS_COLOR_PROPS) {
    const computedValue = computed?.getPropertyValue(prop);
    if (containsModernColor(computedValue)) {
      // For computed styles that return modern colors, we need a fallback mapping
      const safeColor = getFallbackForProperty(prop);
      el.style.setProperty(prop, safeColor, 'important');
      result.stylePropertiesSanitized++;
    }
  }
  
  // Also check inline style attribute directly
  const styleAttr = el.getAttribute('style');
  if (styleAttr && containsModernColor(styleAttr)) {
    for (const prop of CSS_COLOR_PROPS) {
      const inlineValue = el.style.getPropertyValue(prop);
      if (containsModernColor(inlineValue)) {
        const safeColor = getFallbackForProperty(prop);
        el.style.setProperty(prop, safeColor, 'important');
        result.stylePropertiesSanitized++;
      }
    }
  }
}

/**
 * Get a sensible fallback color for a given CSS property
 */
function getFallbackForProperty(prop: string): string {
  switch (prop) {
    case 'color':
      return '#1f2937'; // gray-800
    case 'background-color':
      return '#ffffff'; // white
    case 'border-color':
    case 'border-top-color':
    case 'border-right-color':
    case 'border-bottom-color':
    case 'border-left-color':
      return '#e5e7eb'; // gray-200
    case 'fill':
      return '#1f2937'; // gray-800
    case 'stroke':
      return '#000000'; // black
    case 'stop-color':
    case 'flood-color':
      return '#ffffff'; // white
    default:
      return '#1f2937'; // gray-800
  }
}

/**
 * Recursively process all elements in a DOM tree
 */
function processElementTree(
  el: Element,
  doc: Document,
  result: SanitizeResult
): void {
  result.totalElementsProcessed++;
  
  let wasSanitized = false;
  const prevAttributeCount = result.attributesSanitized;
  const prevStyleCount = result.stylePropertiesSanitized;
  
  // Handle SVG elements
  if (el instanceof SVGElement) {
    sanitizeSvgElement(el, doc, result);
  }
  // Handle HTML elements
  else if (el instanceof HTMLElement) {
    sanitizeHtmlElement(el, doc, result);
  }
  
  if (result.attributesSanitized > prevAttributeCount || 
      result.stylePropertiesSanitized > prevStyleCount) {
    result.elementsSanitized++;
  }
  
  // Process all children recursively
  for (const child of Array.from(el.children)) {
    processElementTree(child, doc, result);
  }
}

/**
 * Main export function: Sanitizes all modern CSS colors in a DOM tree
 * for html2canvas compatibility.
 * 
 * @param rootElement - The root element of the cloned DOM tree to sanitize
 * @param doc - The document context (usually from onclone callback)
 * @returns Statistics about what was sanitized
 * 
 * @example
 * // In html2canvas onclone callback:
 * const canvas = await html2canvas(element, {
 *   onclone: (doc, clonedElement) => {
 *     const stats = sanitizeColorsForExport(clonedElement, doc);
 *     console.log(`[PDF_EXPORT] Sanitized ${stats.elementsSanitized} elements`);
 *   }
 * });
 */
export function sanitizeColorsForExport(
  rootElement: Element,
  doc: Document
): SanitizeResult {
  const result: SanitizeResult = {
    totalElementsProcessed: 0,
    elementsSanitized: 0,
    attributesSanitized: 0,
    stylePropertiesSanitized: 0,
  };
  
  processElementTree(rootElement, doc, result);
  
  // Log results for debugging
  if (result.elementsSanitized > 0) {
    console.log(
      `[PDF_EXPORT] Color sanitization complete:`,
      `${result.totalElementsProcessed} elements processed,`,
      `${result.elementsSanitized} elements sanitized,`,
      `${result.attributesSanitized} attributes fixed,`,
      `${result.stylePropertiesSanitized} style properties fixed`
    );
  }
  
  return result;
}

/**
 * Inject global CSS overrides for common Tailwind classes
 * This serves as a safety net for any colors that might slip through
 */
export function injectSafeColorOverrides(doc: Document): void {
  const style = doc.createElement("style");
  style.id = "pdf-export-color-overrides";
  style.innerHTML = `
    /* PDF Export: Global reset for modern color functions */
    *, *::before, *::after {
      --tw-ring-color: rgba(59, 130, 246, 0.5) !important;
      --tw-shadow-color: rgba(0, 0, 0, 0.1) !important;
    }
    
    /* Remove effects that might cause issues */
    [data-testid="tcp-output-panel"],
    [data-testid="tcp-output-panel"] * {
      box-shadow: none !important;
      filter: none !important;
      backdrop-filter: none !important;
    }
    
    /* SVG-specific overrides */
    svg, svg * {
      transition: none !important;
    }
    
    /* Tailwind background color overrides with explicit sRGB values */
    .bg-white { background-color: #ffffff !important; }
    .bg-slate-50, .bg-gray-50 { background-color: #f8fafc !important; }
    .bg-slate-100, .bg-gray-100 { background-color: #f1f5f9 !important; }
    .bg-slate-200, .bg-gray-200 { background-color: #e2e8f0 !important; }
    .bg-slate-300, .bg-gray-300 { background-color: #cbd5e1 !important; }
    .bg-orange-50 { background-color: #fff7ed !important; }
    .bg-orange-100 { background-color: #ffedd5 !important; }
    .bg-orange-200 { background-color: #fed7aa !important; }
    .bg-orange-300 { background-color: #fdba74 !important; }
    .bg-orange-400 { background-color: #fb923c !important; }
    .bg-orange-500 { background-color: #f97316 !important; }
    .bg-amber-50 { background-color: #fffbeb !important; }
    .bg-amber-100 { background-color: #fef3c7 !important; }
    .bg-amber-200 { background-color: #fde68a !important; }
    .bg-amber-300 { background-color: #fcd34d !important; }
    .bg-amber-400 { background-color: #fbbf24 !important; }
    .bg-amber-500 { background-color: #f59e0b !important; }
    .bg-green-50 { background-color: #f0fdf4 !important; }
    .bg-green-100 { background-color: #dcfce7 !important; }
    .bg-green-200 { background-color: #bbf7d0 !important; }
    .bg-green-500 { background-color: #22c55e !important; }
    .bg-blue-50 { background-color: #eff6ff !important; }
    .bg-blue-100 { background-color: #dbeafe !important; }
    .bg-blue-200 { background-color: #bfdbfe !important; }
    .bg-blue-500 { background-color: #3b82f6 !important; }
    .bg-red-50 { background-color: #fef2f2 !important; }
    .bg-red-100 { background-color: #fee2e2 !important; }
    .bg-red-500 { background-color: #ef4444 !important; }
    .bg-yellow-50 { background-color: #fefce8 !important; }
    .bg-yellow-100 { background-color: #fef9c3 !important; }
    .bg-yellow-200 { background-color: #fef08a !important; }
    .bg-yellow-300 { background-color: #fde047 !important; }
    .bg-yellow-400 { background-color: #facc15 !important; }
    .bg-yellow-500 { background-color: #eab308 !important; }
    
    /* Tailwind text color overrides */
    .text-white { color: #ffffff !important; }
    .text-black { color: #000000 !important; }
    .text-slate-900, .text-gray-900 { color: #0f172a !important; }
    .text-slate-800, .text-gray-800 { color: #1e293b !important; }
    .text-slate-700, .text-gray-700 { color: #334155 !important; }
    .text-slate-600, .text-gray-600 { color: #475569 !important; }
    .text-slate-500, .text-gray-500 { color: #64748b !important; }
    .text-slate-400, .text-gray-400 { color: #94a3b8 !important; }
    .text-orange-500 { color: #f97316 !important; }
    .text-orange-600 { color: #ea580c !important; }
    .text-orange-700 { color: #c2410c !important; }
    .text-orange-800 { color: #9a3412 !important; }
    .text-amber-500 { color: #f59e0b !important; }
    .text-amber-600 { color: #d97706 !important; }
    .text-amber-700 { color: #b45309 !important; }
    .text-green-500 { color: #22c55e !important; }
    .text-green-600 { color: #16a34a !important; }
    .text-green-700 { color: #15803d !important; }
    .text-blue-500 { color: #3b82f6 !important; }
    .text-blue-600 { color: #2563eb !important; }
    .text-blue-700 { color: #1d4ed8 !important; }
    .text-blue-800 { color: #1e40af !important; }
    .text-red-500 { color: #ef4444 !important; }
    .text-red-600 { color: #dc2626 !important; }
    .text-red-700 { color: #b91c1c !important; }
    
    /* Tailwind border color overrides */
    .border-slate-100, .border-gray-100 { border-color: #f1f5f9 !important; }
    .border-slate-200, .border-gray-200 { border-color: #e2e8f0 !important; }
    .border-slate-300, .border-gray-300 { border-color: #cbd5e1 !important; }
    .border-orange-200 { border-color: #fed7aa !important; }
    .border-orange-300 { border-color: #fdba74 !important; }
    .border-orange-500 { border-color: #f97316 !important; }
    .border-amber-200 { border-color: #fde68a !important; }
    .border-amber-300 { border-color: #fcd34d !important; }
    .border-green-200 { border-color: #bbf7d0 !important; }
    .border-green-500 { border-color: #22c55e !important; }
    .border-blue-200 { border-color: #bfdbfe !important; }
    .border-blue-500 { border-color: #3b82f6 !important; }
    
    /* SVG fill/stroke overrides for common diagram colors */
    [fill*="lab("], [fill*="oklch("], [fill*="oklab("] { fill: #1f2937 !important; }
    [stroke*="lab("], [stroke*="oklch("], [stroke*="oklab("] { stroke: #000000 !important; }
    
    /* Ring colors */
    .ring-amber-500 { --tw-ring-color: #f59e0b !important; }
    .ring-orange-500 { --tw-ring-color: #f97316 !important; }
    .ring-blue-500 { --tw-ring-color: #3b82f6 !important; }
    .ring-green-500 { --tw-ring-color: #22c55e !important; }
  `;
  doc.head.appendChild(style);
}

