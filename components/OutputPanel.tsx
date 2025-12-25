"use client";

import { useState, useRef, useMemo } from "react";
import { TcpDraftResponse, CoverageInfo } from "@/lib/tcpTypes";
import DiagramPreview from "./DiagramPreview";
import { TransitionPanel } from "./TransitionPanel";
import { InView } from "./motion/InView";
import { AnimatedValue } from "./motion/AnimatedValue";
import {
  DiagramGeometry,
  DiagramJobData,
  DiagramPlanData,
} from "@/lib/diagram/types";

// Industrial transition variants - subtle fade + slight translateY
const panelVariants = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

const panelTransition = {
  duration: 0.3,
  ease: "easeInOut" as const,
};

export interface JobInfoForExport {
  locationLabel: string;
  roadType: string;
  postedSpeedMph: number;
  workType: string;
  workLengthFt: number;
  isNight: boolean;
}

// Extended error object that may include coverage gate details
export interface CoverageGateErrorDetails {
  missing?: string[];
  coverage?: CoverageInfo;
  message?: string;
}

export interface OutputPanelProps {
  response: TcpDraftResponse | null;
  rawJson: string | null;
  isLoading: boolean;
  error: string | null;
  errorDetails?: CoverageGateErrorDetails | null; // Coverage gate error details
  onRegenerate: () => void;
  canRegenerate: boolean;
  /** Whether a work zone polygon has been drawn */
  hasGeometry: boolean;
  /** Whether an AI-generated plan exists */
  hasGeneratedPlan: boolean;
  /** Whether inputs have changed since the plan was generated */
  isPlanDirty?: boolean;
  jobInfo?: JobInfoForExport | null;
  /** Geometry from map selection for dynamic diagram */
  geometry?: DiagramGeometry | null;
}

export default function OutputPanel({
  response,
  rawJson,
  isLoading,
  error,
  errorDetails,
  onRegenerate,
  canRegenerate,
  hasGeometry,
  hasGeneratedPlan,
  isPlanDirty = false,
  jobInfo,
  geometry,
}: OutputPanelProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showCoverageDetails, setShowCoverageDetails] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Convert jobInfo to DiagramJobData format
  const diagramJob: DiagramJobData | null = useMemo(() => {
    if (!jobInfo) return null;
    
    // Map string roadType to literal union type
    const roadTypeMap: Record<string, DiagramJobData["roadType"]> = {
      "2_lane_undivided": "2_lane_undivided",
      "multilane_divided": "multilane_divided",
      "intersection": "intersection",
    };
    
    const workTypeMap: Record<string, DiagramJobData["workType"]> = {
      "shoulder_work": "shoulder_work",
      "lane_closure": "lane_closure",
      "one_lane_two_way_flaggers": "one_lane_two_way_flaggers",
    };

    return {
      roadType: roadTypeMap[jobInfo.roadType] ?? "2_lane_undivided",
      workType: workTypeMap[jobInfo.workType] ?? "lane_closure",
      workLengthFt: jobInfo.workLengthFt,
      postedSpeedMph: jobInfo.postedSpeedMph,
      isNight: jobInfo.isNight,
    };
  }, [jobInfo]);

  // Convert response plan to DiagramPlanData format
  const diagramPlan: DiagramPlanData | null = useMemo(() => {
    if (!response?.plan) return null;
    
    return {
      signSpacing: response.plan.signSpacing.map(s => ({
        label: s.label as "A" | "B" | "C",
        distanceFt: s.distanceFt,
      })),
      taperLengthFt: response.plan.taperLengthFt,
      bufferLengthFt: response.plan.bufferLengthFt,
      devices: response.plan.devices,
      recommendedLayout: response.plan.recommendedLayout,
    };
  }, [response?.plan]);

  const handleExportPdf = async () => {
    if (!exportRef.current || !response) return;

    setIsExporting(true);
    try {
      // Dynamic imports to avoid SSR issues
      const html2canvasModule = await import("html2canvas");
      const html2canvas = html2canvasModule.default;
      const jsPDFModule = await import("jspdf");
      const jsPDF = jsPDFModule.default;

      // Build header text
      const now = new Date();
      const dateStr = now.toLocaleDateString() + " " + now.toLocaleTimeString();
      const locationStr = jobInfo?.locationLabel || "Unknown location";
      const jobStr = jobInfo
        ? `${jobInfo.roadType}, ${jobInfo.postedSpeedMph} mph, ${jobInfo.workType}, ${jobInfo.workLengthFt} ft, ${jobInfo.isNight ? "Night" : "Day"}`
        : "Job details not available";

      // Capture the content with safe color overrides to avoid lab()/oklab() parsing errors
      const canvas = await html2canvas(exportRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        onclone: (doc) => {
          // Inject safe sRGB colors to prevent html2canvas from choking on lab()/oklab()/oklch()
          const style = doc.createElement("style");
          style.innerHTML = `
            [data-testid="tcp-output-panel"],
            [data-testid="tcp-output-panel"] * {
              color: #111827 !important;
              background-color: #ffffff !important;
              border-color: #e5e7eb !important;
              box-shadow: none !important;
              filter: none !important;
              backdrop-filter: none !important;
            }
            [data-testid="tcp-output-panel"] .bg-orange-50 {
              background-color: #fff7ed !important;
            }
            [data-testid="tcp-output-panel"] .bg-orange-100 {
              background-color: #ffedd5 !important;
            }
            [data-testid="tcp-output-panel"] .bg-gray-50 {
              background-color: #f9fafb !important;
            }
            [data-testid="tcp-output-panel"] .bg-gray-100 {
              background-color: #f3f4f6 !important;
            }
            [data-testid="tcp-output-panel"] .bg-blue-100 {
              background-color: #dbeafe !important;
            }
            [data-testid="tcp-output-panel"] .text-orange-600 {
              color: #ea580c !important;
            }
            [data-testid="tcp-output-panel"] .text-orange-800 {
              color: #9a3412 !important;
            }
            [data-testid="tcp-output-panel"] .text-blue-800 {
              color: #1e40af !important;
            }
            [data-testid="tcp-output-panel"] .text-gray-500 {
              color: #6b7280 !important;
            }
            [data-testid="tcp-output-panel"] .text-gray-600 {
              color: #4b5563 !important;
            }
            [data-testid="tcp-output-panel"] .text-gray-700 {
              color: #374151 !important;
            }
            [data-testid="tcp-output-panel"] .text-gray-800 {
              color: #1f2937 !important;
            }
            [data-testid="tcp-output-panel"] .border-gray-100 {
              border-color: #f3f4f6 !important;
            }
            [data-testid="tcp-output-panel"] .border-gray-200 {
              border-color: #e5e7eb !important;
            }
            [data-testid="tcp-output-panel"] .border-orange-200 {
              border-color: #fed7aa !important;
            }
          `;
          doc.head.appendChild(style);
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      // A4 dimensions in mm
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Margins
      const marginX = 10;
      const marginTop = 10;
      const headerHeight = 35;
      const contentStartY = marginTop + headerHeight;

      // Scale image to fit page width (accounting for margins)
      const availableWidth = pageWidth - 2 * marginX;
      const scaleFactor = availableWidth / imgWidth;
      const scaledHeight = imgHeight * scaleFactor;

      // Available height for content per page
      const availableHeightFirstPage = pageHeight - contentStartY - marginTop;
      const availableHeightOtherPages = pageHeight - 2 * marginTop;

      // Add header to first page
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text("TCP Draft – For Human Review Only", marginX, marginTop + 6);

      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Generated: ${dateStr}`, marginX, marginTop + 14);
      pdf.text(`Location: ${locationStr}`, marginX, marginTop + 21);
      pdf.text(`Job: ${jobStr}`, marginX, marginTop + 28);

      // Draw a line under header
      pdf.setDrawColor(200);
      pdf.line(marginX, marginTop + 32, pageWidth - marginX, marginTop + 32);

      // Calculate how many pages we need
      let remainingHeight = scaledHeight;
      let sourceY = 0;
      let pageNum = 0;

      while (remainingHeight > 0) {
        const availableHeight = pageNum === 0 ? availableHeightFirstPage : availableHeightOtherPages;
        const sliceHeight = Math.min(remainingHeight, availableHeight);
        const sliceHeightPx = sliceHeight / scaleFactor;

        // For pages after the first, add a new page
        if (pageNum > 0) {
          pdf.addPage();
        }

        // Calculate destination Y
        const destY = pageNum === 0 ? contentStartY : marginTop;

        // Add image slice
        // We add the full image but position it so only the relevant portion shows
        // jsPDF clips automatically to page bounds
        pdf.addImage(
          imgData,
          "PNG",
          marginX,
          destY - sourceY * scaleFactor,
          availableWidth,
          scaledHeight
        );

        sourceY += sliceHeightPx;
        remainingHeight -= sliceHeight;
        pageNum++;
      }

      // Generate filename with date
      const dateForFilename = now.toISOString().split("T")[0];
      pdf.save(`tcp-draft-${dateForFilename}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      alert("Export failed — try again.");
    } finally {
      setIsExporting(false);
    }
  };

  // Determine State
  const isGenerated = hasGeneratedPlan;
  const isPreview = hasGeometry && !isGenerated;
  const isEmpty = !hasGeometry && !isGenerated;

  // Calculate panel state index for TransitionPanel
  // 0: empty, 1: preview, 2: loading, 3: error, 4: generated (valid), 5: generated (dirty/invalidated)
  const panelStateIndex = useMemo(() => {
    if (isLoading) return 2;
    if (error) return 3;
    if (isGenerated && response && isPlanDirty) return 5; // Dirty state
    if (isGenerated && response) return 4;
    if (isPreview) return 1;
    return 0; // empty
  }, [isLoading, error, isGenerated, response, isPreview, isPlanDirty]);

  // DEV-MODE ASSERTION: Detect invalid state combinations that could cause crashes
  if (process.env.NODE_ENV === "development") {
    // State 4 or 5 should NEVER be reached without a valid response
    if ((panelStateIndex === 4 || panelStateIndex === 5) && !response) {
      console.error(
        "[OutputPanel] INVARIANT VIOLATION: State %d requires non-null response. " +
        "isGenerated=%s, isPlanDirty=%s, response=%s",
        panelStateIndex,
        isGenerated,
        isPlanDirty,
        response
      );
    }
  }

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* 1) Persistent Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-4 bg-slate-300 rounded-full" />
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Traffic Control Output
          </h2>
        </div>
        
        {/* Status Badges based on State */}
        <div>
          {isEmpty && !isLoading && !error && (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-slate-200">
              Awaiting Work Zone
            </span>
          )}
          {isPreview && !isLoading && !error && (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-amber-100">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              Preview (Estimated)
            </span>
          )}
          {isGenerated && !isLoading && !isPlanDirty && (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              AI-Verified
            </span>
          )}
          {isGenerated && !isLoading && isPlanDirty && (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              Outdated
            </span>
          )}
          {isLoading && (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-blue-100">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
              Generating...
            </span>
          )}
          {error && (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded-sm border border-red-100">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
              Error
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
        <TransitionPanel
          activeIndex={panelStateIndex}
          variants={panelVariants}
          transition={panelTransition}
          className="h-full"
        >
          {/* =====================================
              STATE 0: EMPTY (No geometry)
              ===================================== */}
          <div className="flex flex-col gap-6 h-full">
            {/* Structured Empty State Block */}
            <InView variants="fadeUp" delay={0}>
              <div className="flex flex-col items-center justify-center text-center py-6">
                <div className="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-200">
                  <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-slate-800 mb-2">
                  Ready to Generate TCP
                </h3>
                <p className="text-sm text-slate-500 max-w-sm leading-relaxed mb-6">
                  Complete the steps below to generate an AI-verified traffic control plan.
                </p>

                {/* Step Checklist */}
                <div className="w-full max-w-xs space-y-2">
                  <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-sm">
                    <div className="w-6 h-6 rounded-full bg-[#FFB300] text-white flex items-center justify-center text-xs font-bold">1</div>
                    <div className="flex-1 text-left">
                      <span className="text-xs font-bold text-amber-800">Define Work Zone</span>
                      <p className="text-[10px] text-amber-600">Draw area on map</p>
                    </div>
                    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-sm opacity-60">
                    <div className="w-6 h-6 rounded-full bg-slate-300 text-white flex items-center justify-center text-xs font-bold">2</div>
                    <div className="flex-1 text-left">
                      <span className="text-xs font-medium text-slate-600">Configure Job Details</span>
                      <p className="text-[10px] text-slate-400">Road type, speed, operation</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-sm opacity-60">
                    <div className="w-6 h-6 rounded-full bg-slate-300 text-white flex items-center justify-center text-xs font-bold">3</div>
                    <div className="flex-1 text-left">
                      <span className="text-xs font-medium text-slate-600">Generate Plan</span>
                      <p className="text-[10px] text-slate-400">AI verification with MUTCD</p>
                    </div>
                  </div>
                </div>
              </div>
            </InView>

            {/* What You'll Get Section */}
            <InView variants="fadeUp" delay={0.1}>
              <div className="border-t border-dashed border-slate-200 pt-6">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 text-center">
                  What You&apos;ll Get
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-slate-50 rounded-sm border border-slate-100">
                    <svg className="w-5 h-5 text-slate-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-[10px] font-medium text-slate-600">Schematic</span>
                  </div>
                  <div className="text-center p-3 bg-slate-50 rounded-sm border border-slate-100">
                    <svg className="w-5 h-5 text-slate-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[10px] font-medium text-slate-600">Compliance</span>
                  </div>
                  <div className="text-center p-3 bg-slate-50 rounded-sm border border-slate-100">
                    <svg className="w-5 h-5 text-slate-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    <span className="text-[10px] font-medium text-slate-600">Specifications</span>
                  </div>
                </div>
              </div>
            </InView>
          </div>

          {/* =====================================
              STATE 1: PREVIEW (Geometry exists, no AI plan yet)
              ===================================== */}
          <div className="flex flex-col gap-6">
            {/* Diagram Preview - Geometry Only */}
            <InView variants="fadeUp" delay={0}>
              <div className="bg-white border border-slate-200 rounded-sm shadow-lg p-1 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-1 bg-amber-400 opacity-50"></div>
                <DiagramPreview
                  geometry={geometry!}
                  job={diagramJob}
                  plan={null}
                  height={400}
                />
                {/* Overlay Warning */}
                <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur text-xs font-mono text-slate-500 px-2 py-1 rounded-sm border border-slate-200 shadow-sm pointer-events-none">
                  PREVIEW ONLY // NOT VERIFIED
                </div>
              </div>
            </InView>
            
            {/* Estimated Input Summary */}
            {jobInfo && (
              <InView variants="fadeUp" delay={0.06}>
                <div className="bg-slate-50 border border-slate-200 rounded-sm p-4">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Current Input Summary
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Road Type:</span>
                      <span className="font-medium text-slate-700">{jobInfo.roadType.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Speed:</span>
                      <span className="font-medium text-slate-700 font-mono">{jobInfo.postedSpeedMph} mph</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Operation:</span>
                      <span className="font-medium text-slate-700">{jobInfo.workType.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Work Length:</span>
                      <span className="font-medium text-slate-700 font-mono">{jobInfo.workLengthFt} ft</span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span className="text-slate-500">Time:</span>
                      <span className="font-medium text-slate-700">{jobInfo.isNight ? "Night Operation" : "Day Operation"}</span>
                    </div>
                  </div>
                </div>
              </InView>
            )}

            {/* What's Next Block */}
            <InView variants="fadeUp" delay={0.1}>
              <div className="bg-amber-50/50 border border-amber-100 rounded-sm p-4 flex gap-3">
                <div className="text-amber-500 mt-0.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1">
                    Ready to Generate
                  </p>
                  <p className="text-xs text-amber-700/80 leading-relaxed mb-3">
                    Click <strong>&quot;Generate Draft Plan&quot;</strong> to apply MUTCD rules for spacing, taper lengths, and device requirements.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-amber-200 rounded-sm text-[10px] text-amber-700">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      MUTCD Verification
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-amber-200 rounded-sm text-[10px] text-amber-700">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Device Counts
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-amber-200 rounded-sm text-[10px] text-amber-700">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Compliance Check
                    </span>
                  </div>
                </div>
              </div>
            </InView>
          </div>

          {/* =====================================
              STATE 2: LOADING
              ===================================== */}
          <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
            <div className="w-12 h-12 mb-4 border-4 border-slate-200 border-t-[#FFB300] rounded-full animate-spin" />
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Generating draft TCP…</h3>
            <p className="text-sm text-slate-500">This may take a few seconds.</p>
          </div>

          {/* =====================================
              STATE 3: ERROR
              ===================================== */}
          <div className="p-0">
            {errorDetails?.coverage && errorDetails?.missing ? (
              // Safety Block Alert for Coverage Gate errors
              <div className="bg-amber-50 border-2 border-amber-500 rounded-sm p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-amber-800">
                      Safety Gate: Cannot Generate Plan
                    </h3>
                    <p className="mt-2 text-sm text-amber-700">
                      The following mandatory handbook rules were not found in the current knowledge base:
                    </p>
                    <ul className="mt-2 list-disc list-inside text-sm text-amber-800 font-medium">
                      {errorDetails.missing?.map((item) => (
                        <li key={item} className="capitalize">{item} guidance</li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs text-amber-600">
                      This safety gate prevents the AI from generating potentially incorrect numeric values.
                      The knowledge base needs handbook documents that cover sign spacing, taper lengths, and buffer distances.
                    </p>

                    {/* Coverage Status Grid */}
                    {errorDetails.coverage && (
                      <div className="mt-4 p-3 bg-white rounded-sm border border-amber-200">
                        <h4 className="text-sm font-semibold text-slate-700 mb-2">Coverage Status</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            {errorDetails.coverage.spacing ? (
                              <span className="text-emerald-600">✓</span>
                            ) : (
                              <span className="text-red-600">✗</span>
                            )}
                            <span className={errorDetails.coverage.spacing ? "text-slate-700" : "text-red-700 font-medium"}>
                              Spacing
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {errorDetails.coverage.taper ? (
                              <span className="text-emerald-600">✓</span>
                            ) : (
                              <span className="text-red-600">✗</span>
                            )}
                            <span className={errorDetails.coverage.taper ? "text-slate-700" : "text-red-700 font-medium"}>
                              Taper
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {errorDetails.coverage.buffer ? (
                              <span className="text-emerald-600">✓</span>
                            ) : (
                              <span className="text-red-600">✗</span>
                            )}
                            <span className={errorDetails.coverage.buffer ? "text-slate-700" : "text-red-700 font-medium"}>
                              Buffer
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {errorDetails.coverage.devices ? (
                              <span className="text-emerald-600">✓</span>
                            ) : (
                              <span className="text-amber-600">⚠</span>
                            )}
                            <span className={errorDetails.coverage.devices ? "text-slate-700" : "text-amber-700"}>
                              Devices
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* View Retrieved Chunks Button */}
                    {errorDetails.coverage?.citations && errorDetails.coverage.citations.length > 0 && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => setShowCoverageDetails(!showCoverageDetails)}
                          className="text-sm text-amber-700 hover:text-amber-900 underline"
                        >
                          {showCoverageDetails ? "Hide" : "View"} Retrieved Chunks ({errorDetails.coverage.citations.length})
                        </button>
                        {showCoverageDetails && (
                          <div className="mt-2 p-2 bg-slate-50 rounded-sm border border-slate-200 max-h-48 overflow-y-auto">
                            {errorDetails.coverage.citations.map((citation, idx) => (
                              <div key={idx} className="text-xs text-slate-600 mb-2 pb-2 border-b border-slate-100 last:border-b-0">
                                <span className="font-semibold text-slate-700">[{citation.category}]</span>{" "}
                                {citation.docName}
                                {citation.page && <span> p.{citation.page}</span>}
                                {citation.snippet && (
                                  <p className="mt-1 text-slate-500 italic">{citation.snippet}...</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              // Standard error display
              <div className="bg-red-50 border border-red-200 rounded-sm p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-red-800">Error generating TCP</h3>
                    <p className="mt-1 text-sm text-red-700 whitespace-pre-wrap">{error}</p>
                  </div>
                </div>
              </div>
            )}
            {/* Friendly hint */}
            <p className="mt-3 text-xs text-slate-500 text-center">
              {(errorDetails?.coverage && errorDetails?.missing)
                ? "Run the RAG ingestion script to index more handbook documents."
                : "If this keeps happening, verify your API key, billing, or usage limits."}
            </p>
            {canRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="mt-4 px-4 py-2 bg-[#FFB300] text-slate-900 font-medium rounded-sm hover:bg-[#F59E0B] transition-colors shadow-sm"
              >
                Try Again
              </button>
            )}
          </div>

          {/* =====================================
              STATE 4: AI-GENERATED PLAN (Full response)
              ===================================== */}
          <div className="flex flex-col gap-6">
            {response ? (
              <>
                {/* ID Badge handled in header now */}
                <div className="flex justify-end -mt-2">
                    <span className="text-[10px] text-slate-400 font-mono">ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}</span>
                </div>

                {/* Exportable content container */}
                <div ref={exportRef} data-testid="tcp-output-panel" className="flex flex-col gap-6">
                  
                  {/* Summary Card - Defensive: use optional chaining for safety during transitions */}
                  <InView variants="fadeUp" delay={0}>
                    <div className="bg-white border border-slate-200 rounded-sm p-4 shadow-sm relative">
                      <div className="absolute top-0 left-0 w-1 h-full bg-slate-200"></div>
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 pl-2">
                        Executive Summary
                      </h3>
                      <p className="text-sm text-slate-700 leading-relaxed pl-2">{response?.summary ?? "Loading..."}</p>
                    </div>
                  </InView>

                  {/* Plan Confidence Card - Defensive: optional chaining */}
                  {response?.coverage && (
                    <InView variants="fadeUp" delay={0.06}>
                      <div className="bg-emerald-50/30 border border-emerald-100 rounded-sm p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                            Compliance Verification
                          </h3>
                        </div>
                        
                        {/* Coverage Checklist */}
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          {[
                            { key: 'spacing', label: 'Spacing' },
                            { key: 'taper', label: 'Taper' },
                            { key: 'buffer', label: 'Buffer' },
                            { key: 'devices', label: 'Devices' }
                          ].map(({ key, label }) => {
                            const isCovered = response.coverage?.[key as keyof CoverageInfo] ?? false;
                            return (
                              <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-sm border ${
                                isCovered ? "bg-emerald-100/50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-100 text-red-700"
                              }`}>
                                <span className="text-[10px]">{isCovered ? "✓" : "✗"}</span>
                                <span className="text-[10px] font-bold uppercase">{label}</span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Verified Sources */}
                        {response.coverage.citations && response.coverage.citations.length > 0 && (
                          <div className="border-t border-emerald-100 pt-2 mt-2">
                            <div className="flex flex-wrap gap-1.5">
                              {response.coverage.citations.map((citation, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-emerald-200 rounded-sm text-[10px] text-emerald-700 shadow-sm"
                                  title={citation.snippet || undefined}
                                >
                                  <span className="font-bold uppercase">{citation.category}</span>
                                  <span className="text-emerald-300">|</span>
                                  <span className="font-mono">{citation.docName}</span>
                                  {citation.page && <span className="text-emerald-400 font-mono">p.{citation.page}</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </InView>
                  )}

                  {/* Dynamic Diagram Preview - AI Verified */}
                  <InView variants="fadeUp" delay={0.12}>
                    <div className="bg-white border border-slate-200 rounded-sm shadow-lg p-1 relative group">
                      <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
                      <div className="absolute top-3 right-3 z-10">
                         <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-sm border border-emerald-100 shadow-sm">
                          VERIFIED
                        </span>
                      </div>
                      <DiagramPreview
                        geometry={geometry}
                        job={diagramJob}
                        plan={diagramPlan}
                        height={500}
                      />
                    </div>
                  </InView>

                  {/* Plan Details */}
                  <InView variants="fadeUp" delay={0.18}>
                    <div className="bg-white border border-slate-200 rounded-sm shadow-sm overflow-hidden">
                      <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                          Plan Specifications
                        </h3>
                        <span className="text-[10px] font-mono text-slate-400">spec_v1.0</span>
                      </div>

                      <div className="p-4 space-y-6">
                        {/* Layout - Defensive: optional chaining */}
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Layout Strategy</span>
                          <p className="text-sm font-medium text-slate-800">{response?.plan?.recommendedLayout ?? "—"}</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Sign Spacing Table */}
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Sign Spacing</span>
                            <div className="border border-slate-200 rounded-sm overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                  <tr>
                                    <th className="py-1.5 px-3 text-left text-[10px] font-bold text-slate-500 uppercase">Sign</th>
                                    <th className="py-1.5 px-3 text-right text-[10px] font-bold text-slate-500 uppercase">Dist</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {(response?.plan?.signSpacing ?? []).map((sign) => (
                                    <tr key={sign.label} className="bg-white hover:bg-slate-50 transition-colors">
                                      <td className="py-2 px-3 font-bold text-amber-600 font-mono">{sign.label}</td>
                                      <td className="py-2 px-3 text-right text-slate-700 font-mono">
                                        <AnimatedValue value={sign.distanceFt} suffix=" ft" className="font-mono" />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Taper & Buffer - Defensive: optional chaining */}
                          <div className="space-y-3">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Taper Length</span>
                              <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded-sm">
                                <span className="text-xs text-slate-500">Calculated</span>
                                <AnimatedValue 
                                  value={response?.plan?.taperLengthFt ?? 0} 
                                  suffix=" ft" 
                                  className="text-sm font-bold text-slate-900 font-mono" 
                                />
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Buffer Length</span>
                              <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200 rounded-sm">
                                <span className="text-xs text-slate-500">Longitudinal</span>
                                <AnimatedValue 
                                  value={response?.plan?.bufferLengthFt ?? 0} 
                                  suffix=" ft" 
                                  className="text-sm font-bold text-slate-900 font-mono" 
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Devices - Defensive: optional chaining */}
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Required Devices</span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-2 border border-slate-200 rounded-sm bg-slate-50">
                              <span className="text-[10px] text-slate-500 uppercase block mb-1">Cones</span>
                              <AnimatedValue 
                                value={response?.plan?.devices?.cones ?? 0} 
                                className="text-lg font-bold text-slate-900 font-mono" 
                              />
                            </div>
                            <div className="p-2 border border-slate-200 rounded-sm bg-slate-50">
                              <span className="text-[10px] text-slate-500 uppercase block mb-1">Signs</span>
                              <AnimatedValue 
                                value={response?.plan?.devices?.signs ?? 0} 
                                className="text-lg font-bold text-slate-900 font-mono" 
                              />
                            </div>
                            <div className="p-2 border border-slate-200 rounded-sm bg-slate-50">
                              <span className="text-[10px] text-slate-500 uppercase block mb-1">Arrow Board</span>
                              <span className="text-lg font-bold text-slate-900 font-mono">
                                {response?.plan?.devices?.arrowBoard ? "YES" : "NO"}
                              </span>
                            </div>
                            <div className="p-2 border border-slate-200 rounded-sm bg-slate-50">
                              <span className="text-[10px] text-slate-500 uppercase block mb-1">Flaggers</span>
                              <AnimatedValue 
                                value={response?.plan?.devices?.flaggers ?? 0} 
                                className="text-lg font-bold text-slate-900 font-mono" 
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </InView>

                  {/* Assumptions - Defensive: optional chaining */}
                  {(response?.assumptions?.length ?? 0) > 0 && (
                    <InView variants="fadeUp" delay={0.24}>
                      <div className="bg-white border border-slate-200 rounded-sm p-4 shadow-sm">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                          Notes & Assumptions
                        </h3>
                        <ul className="list-disc list-inside text-xs text-slate-600 space-y-1 marker:text-slate-300">
                          {(response?.assumptions ?? []).map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    </InView>
                  )}

                  {/* References - Defensive: optional chaining */}
                  {(response?.references?.length ?? 0) > 0 && (
                    <InView variants="fadeUp" delay={0.3}>
                      <div className="bg-white border border-slate-200 rounded-sm p-4 shadow-sm">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                          Reference Docs
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {(response?.references ?? []).map((ref, i) => (
                            <span
                              key={i}
                              className="inline-block bg-slate-100 text-slate-600 text-[10px] font-medium px-2 py-1 rounded-sm border border-slate-200 font-mono"
                            >
                              {ref}
                            </span>
                          ))}
                        </div>
                      </div>
                    </InView>
                  )}

              {/* Raw JSON Collapsible */}
              {rawJson && (
                <details className="group border border-slate-200 rounded-sm bg-slate-50">
                  <summary className="px-4 py-2 cursor-pointer text-xs font-bold text-slate-500 uppercase tracking-wide hover:bg-slate-100 transition-colors flex items-center justify-between">
                    <span>Debug Payload</span>
                    <span className="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="p-0 border-t border-slate-200">
                    <pre className="bg-slate-900 text-slate-200 p-4 text-[10px] font-mono overflow-x-auto max-h-64">
                      {rawJson}
                    </pre>
                  </div>
                </details>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-slate-100">
              {/* Regenerate Button */}
              {canRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={isLoading}
                  className="flex-1 px-4 py-3 bg-white text-slate-700 font-bold text-sm uppercase tracking-wide rounded-sm border border-slate-300 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm"
                >
                  Refine Plan
                </button>
              )}

              {/* Export PDF Button */}
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isLoading || isExporting}
                className="flex-1 px-4 py-3 bg-slate-800 text-white font-bold text-sm uppercase tracking-wide rounded-sm hover:bg-slate-900 transition-all shadow-md flex items-center justify-center gap-2"
              >
                {isExporting ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generating PDF...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export PDF
                  </>
                )}
              </button>
            </div>
              </>
            ) : null}
          </div>

          {/* =====================================
              STATE 5: DIRTY/INVALIDATED (Plan exists but inputs changed)
              Defensive: Guard all response access to prevent null reference errors
              ===================================== */}
          <div className="flex flex-col gap-6">
            {/* Invalidation Warning Banner - Always safe to render */}
            <div className="bg-amber-50 border-2 border-amber-400 rounded-sm p-4" role="alert" aria-live="polite">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-amber-800">
                    ⚠ Parameters Changed — Regeneration Required
                  </h3>
                  <p className="mt-1 text-xs text-amber-700">
                    One or more job inputs have been modified since this plan was generated. 
                    The previous results may no longer be accurate for the current configuration.
                  </p>
                  <p className="mt-2 text-xs text-amber-600 italic">
                    Click &quot;Regenerate Plan&quot; below to update with current parameters.
                  </p>
                </div>
              </div>
            </div>

            {/* Diagram Preview - Only render if response exists (defensive guard) */}
            {response ? (
              <div className="bg-white border border-amber-300 rounded-sm shadow-lg p-1 relative overflow-hidden opacity-60">
                <div className="absolute top-0 left-0 w-full h-1 bg-amber-400"></div>
                <div className="absolute inset-0 bg-amber-50/20 pointer-events-none z-10"></div>
                <DiagramPreview
                  geometry={geometry}
                  job={diagramJob}
                  plan={diagramPlan}
                  height={350}
                />
                {/* Overlay Warning */}
                <div className="absolute top-4 right-4 bg-amber-100 text-xs font-bold text-amber-800 px-3 py-1.5 rounded-sm border border-amber-300 shadow-sm z-20">
                  OUTDATED
                </div>
              </div>
            ) : (
              /* Fallback placeholder if response is null during transition */
              <div className="bg-slate-100 border border-slate-300 rounded-sm p-8 text-center">
                <p className="text-sm text-slate-500">Loading previous plan data...</p>
              </div>
            )}

            {/* Regenerate CTA */}
            <div className="flex flex-col gap-3">
              {canRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={isLoading}
                  className="w-full px-4 py-3 bg-[#FFB300] text-slate-900 font-bold text-sm uppercase tracking-wide rounded-sm hover:bg-[#F59E0B] transition-all shadow-md border border-[#D97706] flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Regenerate Plan
                </button>
              )}
              <p className="text-[10px] text-slate-400 text-center font-mono">
                Previous plan generated with different parameters
              </p>
            </div>
          </div>
        </TransitionPanel>
      </div>
    </div>
  );
}
