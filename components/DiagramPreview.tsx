"use client";

import { useMemo } from "react";
import {
  DiagramInput,
  DiagramState,
  DiagramGeometry,
  DiagramPlanData,
  DiagramJobData,
  DEFAULT_DIAGRAM_CONFIG,
} from "@/lib/diagram/types";
import { hasValidGeometry } from "@/lib/diagram/geometry";
import { renderDiagram, determineLayoutMode } from "@/lib/diagram/renderer";

export interface DiagramPreviewProps {
  /**
   * Geometry from map selection (bbox or polygon).
   */
  geometry?: DiagramGeometry | null;

  /**
   * Job details from form.
   */
  job?: DiagramJobData | null;

  /**
   * Plan data from API response.
   */
  plan?: DiagramPlanData | null;

  /**
   * Optional custom width (default: 100% of container).
   */
  width?: number | string;

  /**
   * Optional custom height (default: 500px).
   */
  height?: number;
}

/**
 * Determine the diagram state based on available data.
 */
function determineDiagramState(
  geometry: DiagramGeometry | null | undefined,
  plan: DiagramPlanData | null | undefined
): DiagramState {
  if (!geometry || !hasValidGeometry(geometry)) {
    return "empty";
  }
  if (!plan) {
    return "geometry-only";
  }
  return "full";
}

/**
 * DiagramPreview Component
 * 
 * Renders a dynamic, data-driven TCP schematic diagram.
 * Handles three states: empty, geometry-only, and full.
 */
export default function DiagramPreview({
  geometry,
  job,
  plan,
  width = "100%",
  height = 500,
}: DiagramPreviewProps) {
  // Determine state and layout mode
  const state = determineDiagramState(geometry, plan);
  const layoutMode = determineLayoutMode(job ?? undefined);

  // Build diagram input
  const input: DiagramInput = useMemo(() => ({
    state,
    layoutMode,
    geometry: geometry ?? undefined,
    job: job ?? undefined,
    plan: plan ?? undefined,
  }), [state, layoutMode, geometry, job, plan]);

  // Generate SVG with custom config
  const config = useMemo(() => ({
    ...DEFAULT_DIAGRAM_CONFIG,
    height: typeof height === "number" ? height : DEFAULT_DIAGRAM_CONFIG.height,
  }), [height]);

  const svgContent = useMemo(() => {
    return renderDiagram(input, config);
  }, [input, config]);

  // Container style
  const containerStyle: React.CSSProperties = {
    width: typeof width === "number" ? `${width}px` : width,
    maxWidth: "100%",
    overflow: "hidden",
  };

  return (
    <div 
      className="diagram-preview bg-white rounded-lg border border-gray-200"
      style={containerStyle}
    >
      <div
        className="w-full overflow-auto"
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
}

