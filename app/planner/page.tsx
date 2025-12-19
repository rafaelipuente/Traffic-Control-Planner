"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import JobDetailsForm, { JobDetails } from "@/components/JobDetailsForm";
import OutputPanel from "@/components/OutputPanel";
import GenerationProgress from "@/components/GenerationProgress";
import RagSearchTester from "@/components/RagSearchTester";
import { TcpDraftResponse, Bbox, PolygonRing } from "@/lib/tcpTypes";
import { GeometryOutput } from "@/components/MapSelector";

// Dynamic import for MapSelector to avoid SSR issues with Mapbox
const MapSelector = dynamic(() => import("@/components/MapSelector"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] rounded-lg border border-gray-300 bg-gray-100 flex items-center justify-center">
      <span className="text-gray-500">Loading map…</span>
    </div>
  ),
});

// Dev-only flags
const IS_DEV = process.env.NODE_ENV === "development";
const DEV_DELAY = IS_DEV ? 2500 : 0;

export default function PlannerPage() {
  // Geometry state
  const [geometry, setGeometry] = useState<GeometryOutput | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>("");

  // Job details state
  const [jobDetails, setJobDetails] = useState<JobDetails | null>(null);
  const [jobValid, setJobValid] = useState<boolean>(false);

  // API response state
  const [response, setResponse] = useState<TcpDraftResponse | null>(null);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Progress state
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<number>(0);
  const [finalStepComplete, setFinalStepComplete] = useState<boolean>(false);

  // Refs for timer cleanup
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stepTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Map token from env (client-side)
  const mapToken = process.env.NEXT_PUBLIC_MAP_TOKEN || "";

  // Cleanup timers on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, []);

  // Timer effect - runs when isLoading changes
  useEffect(() => {
    // Clear any existing timers first to prevent duplicates
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (stepTimerRef.current) {
      clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }

    if (!isLoading) {
      return;
    }

    // Local flag to prevent updates after effect cleanup
    let isEffectActive = true;

    // Start elapsed timer
    elapsedTimerRef.current = setInterval(() => {
      if (isMountedRef.current && isEffectActive) {
        setElapsedSeconds((prev) => prev + 1);
      }
    }, 1000);

    // Step advancement schedule (steps 0->1->2, stops BEFORE step 3)
    // Step 3 ("Finalizing") is reached but NEVER auto-completed
    const advanceStep = (currentStep: number) => {
      // Stop advancing once we reach step 3 (Finalizing)
      // Step 3 completion is controlled ONLY by finalStepComplete from API success
      if (!isMountedRef.current || !isEffectActive || currentStep >= 3) return;

      stepTimerRef.current = setTimeout(() => {
        if (isMountedRef.current && isEffectActive) {
          const nextStep = currentStep + 1;
          setProgressStep(nextStep);
          // Continue advancing only up to step 3 (but step 3 won't auto-complete)
          if (nextStep < 3) {
            advanceStep(nextStep);
          }
        }
      }, 3500); // ~3.5 seconds per step
    };

    advanceStep(0);

    return () => {
      isEffectActive = false;
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (stepTimerRef.current) {
        clearTimeout(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };
  }, [isLoading]);

  const handleGeometryChange = useCallback((geo: GeometryOutput | null, label: string) => {
    setGeometry(geo);
    setLocationLabel(label);
    // Clear stale errors when user draws new geometry or clears
    setError(null);
  }, []);

  const handleJobDetailsChange = useCallback((details: JobDetails, isValid: boolean) => {
    setJobDetails(details);
    setJobValid(isValid);
  }, []);

  const canGenerate = geometry !== null && jobValid && !isLoading;

  const buildRequest = useCallback(() => {
    if (!geometry || !jobDetails) return null;

    const base = {
      locationLabel: locationLabel || undefined,
      roadType: jobDetails.roadType,
      postedSpeedMph: jobDetails.postedSpeedMph,
      workType: jobDetails.workType,
      workLengthFt: jobDetails.workLengthFt,
      isNight: jobDetails.isNight,
      notes: jobDetails.notes || undefined,
    };

    if (geometry.type === "bbox") {
      return {
        ...base,
        geometry: { type: "bbox" as const, bbox: geometry.bbox as Bbox },
      };
    }

    // Cast polygon coordinates to the expected tuple types
    const polygonRings = geometry.polygon.map(
      (ring) => ring.map((coord) => coord as [number, number]) as PolygonRing
    );

    return {
      ...base,
      geometry: { type: "polygon" as const, polygon: polygonRings },
    };
  }, [geometry, jobDetails, locationLabel]);

  const handleGenerate = useCallback(async () => {
    const request = buildRequest();
    if (!request) return;

    // Reset progress state
    setElapsedSeconds(0);
    setProgressStep(0);
    setFinalStepComplete(false);

    setIsLoading(true);
    setError(null);
    setResponse(null);
    setRawJson(null);

    try {
      const res = await fetch("/api/draft-tcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const text = await res.text();

      if (!res.ok) {
        // Try to parse error JSON
        try {
          const errJson = JSON.parse(text);
          const msg =
            errJson.error ||
            errJson.details?.issues?.join("; ") ||
            `Request failed with status ${res.status}`;
          setError(msg);
        } catch {
          setError(`Request failed with status ${res.status}: ${text.slice(0, 500)}`);
        }
        return;
      }

      const data = JSON.parse(text) as TcpDraftResponse;
      
      // Mark final step as complete on success
      if (isMountedRef.current) {
        setFinalStepComplete(true);
      }
      
      // Dev-only delay to verify visual transitions (see "Finalizing" checkmark)
      // In production, this is 0ms (no delay)
      if (DEV_DELAY > 0) {
        await new Promise((resolve) => setTimeout(resolve, DEV_DELAY));
      }
      
      if (isMountedRef.current) {
        setResponse(data);
        setRawJson(JSON.stringify(data, null, 2));
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [buildRequest]);

  const handleRegenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  // Selection summary
  const selectionSummary = geometry
    ? geometry.type === "bbox"
      ? `Bbox: [${geometry.bbox.map((n) => n.toFixed(5)).join(", ")}]`
      : `Polygon: ${geometry.polygon[0]?.length ?? 0} vertices`
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">TCP Planner</h1>
              <p className="text-sm text-gray-500">AI-powered Traffic Control Plan Generator</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Input */}
          <div className="flex flex-col gap-6">
            {/* Map Section */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Work Zone Location</h2>

              {mapToken ? (
                <MapSelector mapToken={mapToken} onGeometryChange={handleGeometryChange} />
              ) : (
                <div className="w-full h-[400px] rounded-lg border border-red-300 bg-red-50 flex items-center justify-center p-4">
                  <p className="text-red-600 text-center">
                    Map token not configured. Set <code className="bg-red-100 px-1 rounded">NEXT_PUBLIC_MAP_TOKEN</code> in your environment.
                  </p>
                </div>
              )}

              {/* Selection Summary */}
              {selectionSummary && (
                <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <h3 className="text-sm font-medium text-orange-800 mb-1">Selected Area</h3>
                  <p className="text-sm text-orange-700 font-mono">{selectionSummary}</p>
                  {locationLabel && (
                    <p className="text-sm text-orange-600 mt-1">
                      <span className="font-medium">Location:</span> {locationLabel}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Job Details Section */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Job Details</h2>
              <JobDetailsForm onChange={handleJobDetailsChange} />
            </div>

            {/* Generate Button */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`w-full py-3 px-4 rounded-lg font-semibold text-lg transition-colors ${
                canGenerate
                  ? "bg-orange-500 text-white hover:bg-orange-600 shadow-md"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              {isLoading ? "Generating…" : "Generate Draft TCP"}
            </button>

            {/* Status feedback */}
            {!canGenerate && !isLoading && (
              <div className="text-sm text-center space-y-1">
                {!geometry && (
                  <p className="text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
                    ⚠️ Draw a polygon on the map to define the work zone.
                  </p>
                )}
                {geometry && !jobValid && (
                  <p className="text-red-600 bg-red-50 px-3 py-2 rounded-md">
                    ⚠️ Please fix the errors in the job details form above.
                  </p>
                )}
              </div>
            )}
            {canGenerate && (
              <p className="text-sm text-green-600 text-center bg-green-50 px-3 py-2 rounded-md">
                ✓ Ready to generate! Click the button above.
              </p>
            )}
          </div>

          {/* Right Column - Output */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 min-h-[600px]">
            {isLoading ? (
              <GenerationProgress
                elapsedSeconds={elapsedSeconds}
                progressStep={progressStep}
                finalStepComplete={finalStepComplete}
              />
            ) : (
              <OutputPanel
                response={response}
                rawJson={rawJson}
                isLoading={isLoading}
                error={error}
                onRegenerate={handleRegenerate}
                canRegenerate={canGenerate}
                jobInfo={
                  jobDetails
                    ? {
                        locationLabel: locationLabel || "Unknown location",
                        roadType: jobDetails.roadType,
                        postedSpeedMph: jobDetails.postedSpeedMph,
                        workType: jobDetails.workType,
                        workLengthFt: jobDetails.workLengthFt,
                        isNight: jobDetails.isNight,
                      }
                    : null
                }
              />
            )}
          </div>
        </div>

        {/* DEV ONLY: RAG Search Tester */}
        {IS_DEV && <RagSearchTester />}
      </main>
    </div>
  );
}

