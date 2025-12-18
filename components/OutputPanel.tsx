"use client";

import { useState, useRef } from "react";
import { TcpDraftResponse } from "@/lib/tcpTypes";

export interface JobInfoForExport {
  locationLabel: string;
  roadType: string;
  postedSpeedMph: number;
  workType: string;
  workLengthFt: number;
  isNight: boolean;
}

export interface OutputPanelProps {
  response: TcpDraftResponse | null;
  rawJson: string | null;
  isLoading: boolean;
  error: string | null;
  onRegenerate: () => void;
  canRegenerate: boolean;
  jobInfo?: JobInfoForExport | null;
}

export default function OutputPanel({
  response,
  rawJson,
  isLoading,
  error,
  onRegenerate,
  canRegenerate,
  jobInfo,
}: OutputPanelProps) {
  const [isExporting, setIsExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

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

  // Empty state
  if (!response && !isLoading && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-full bg-orange-100 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-orange-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          Select an area on the map to begin
        </h3>
        <p className="text-sm text-gray-500 max-w-xs">
          Draw a work zone on the map and fill in the job details to generate a draft traffic
          control plan.
        </p>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
        <div className="w-12 h-12 mb-4 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Generating draft TCP…</h3>
        <p className="text-sm text-gray-500">This may take a few seconds.</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
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
        {/* Friendly hint */}
        <p className="mt-3 text-xs text-gray-500 text-center">
          If this keeps happening, verify your API key, billing, or usage limits.
        </p>
        {canRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="mt-4 px-4 py-2 bg-orange-500 text-white font-medium rounded-md hover:bg-orange-600 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    );
  }

  // Success state with response
  if (!response) return null;

  const { summary, plan, assumptions, references, svgContent } = response;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Exportable content container */}
      <div ref={exportRef} data-testid="tcp-output-panel" className="bg-white flex flex-col gap-6">
        {/* Summary Card */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Summary
        </h3>
        <p className="text-gray-800">{summary}</p>
      </div>

      {/* SVG Diagram Preview */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Diagram Preview
        </h3>
        <div
          className="w-full overflow-auto bg-gray-50 rounded border border-gray-100 p-2"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>

      {/* Plan Details */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Plan Details
        </h3>

        {/* Layout */}
        <div className="mb-4">
          <span className="text-xs font-medium text-gray-500">Recommended Layout</span>
          <p className="text-gray-800 font-medium">{plan.recommendedLayout}</p>
        </div>

        {/* Sign Spacing Table */}
        <div className="mb-4">
          <span className="text-xs font-medium text-gray-500">Sign Spacing</span>
          <div className="mt-1 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 px-3 text-left text-gray-600 font-medium">Label</th>
                  <th className="py-2 px-3 text-right text-gray-600 font-medium">Distance (ft)</th>
                </tr>
              </thead>
              <tbody>
                {plan.signSpacing.map((sign) => (
                  <tr key={sign.label} className="border-b border-gray-100">
                    <td className="py-2 px-3 font-semibold text-orange-600">{sign.label}</td>
                    <td className="py-2 px-3 text-right text-gray-800">{sign.distanceFt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Taper & Buffer */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-orange-50 rounded-md p-3">
            <span className="text-xs font-medium text-orange-600">Taper Length</span>
            <p className="text-lg font-semibold text-gray-800">{plan.taperLengthFt} ft</p>
          </div>
          <div className="bg-orange-50 rounded-md p-3">
            <span className="text-xs font-medium text-orange-600">Buffer Length</span>
            <p className="text-lg font-semibold text-gray-800">{plan.bufferLengthFt} ft</p>
          </div>
        </div>

        {/* Devices */}
        <div>
          <span className="text-xs font-medium text-gray-500">Devices</span>
          <div className="mt-2 flex flex-wrap gap-3">
            <div className="bg-gray-100 rounded-md px-3 py-2 text-sm">
              <span className="text-gray-500">Cones:</span>{" "}
              <span className="font-semibold text-gray-800">{plan.devices.cones}</span>
            </div>
            <div className="bg-gray-100 rounded-md px-3 py-2 text-sm">
              <span className="text-gray-500">Signs:</span>{" "}
              <span className="font-semibold text-gray-800">{plan.devices.signs}</span>
            </div>
            <div className="bg-gray-100 rounded-md px-3 py-2 text-sm">
              <span className="text-gray-500">Arrow Board:</span>{" "}
              <span className="font-semibold text-gray-800">
                {plan.devices.arrowBoard ? "Yes" : "No"}
              </span>
            </div>
            <div className="bg-gray-100 rounded-md px-3 py-2 text-sm">
              <span className="text-gray-500">Flaggers:</span>{" "}
              <span className="font-semibold text-gray-800">{plan.devices.flaggers}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Assumptions */}
      {assumptions.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Assumptions
          </h3>
          <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
            {assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* References */}
      {references.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            References
          </h3>
          <div className="flex flex-wrap gap-2">
            {references.map((ref, i) => (
              <span
                key={i}
                className="inline-block bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded"
              >
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Raw JSON Collapsible */}
      {rawJson && (
        <details className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-800">
            Raw JSON Response
          </summary>
          <div className="px-4 pb-4">
            <pre className="bg-gray-50 rounded p-3 text-xs text-gray-700 overflow-x-auto max-h-64 overflow-y-auto">
              {rawJson}
            </pre>
          </div>
        </details>
      )}
      </div>
      {/* End of exportable content */}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {/* Regenerate Button */}
        {canRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isLoading || isExporting}
            className="flex-1 px-4 py-3 bg-orange-500 text-white font-semibold rounded-md hover:bg-orange-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Regenerate from Edits
          </button>
        )}

        {/* Export PDF Button */}
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={isLoading || isExporting}
          className="flex-1 px-4 py-3 bg-gray-700 text-white font-semibold rounded-md hover:bg-gray-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isExporting ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Exporting…
            </>
          ) : (
            <>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export PDF
            </>
          )}
        </button>
      </div>
    </div>
  );
}

