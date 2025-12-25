"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import JobDetailsForm, { JobDetails } from "@/components/JobDetailsForm";
import OutputPanel from "@/components/OutputPanel";
import GenerationProgress from "@/components/GenerationProgress";
import RagSearchTester from "@/components/RagSearchTester";
import Toast from "@/components/Toast";
import { TcpDraftResponse, Bbox, PolygonRing, CoverageInfo } from "@/lib/tcpTypes";
import { GeometryOutput } from "@/components/MapSelector";
import { DiagramGeometry } from "@/lib/diagram/types";

/**
 * Build a stable signature string from job inputs that affect plan calculations.
 * Used to detect when inputs change after a plan was generated.
 */
function buildPlanSignature(jobDetails: JobDetails | null): string {
  if (!jobDetails) return "";
  return JSON.stringify({
    roadType: jobDetails.roadType,
    postedSpeedMph: jobDetails.postedSpeedMph,
    workType: jobDetails.workType,
    workLengthFt: jobDetails.workLengthFt,
    isNight: jobDetails.isNight,
    // Notes intentionally excluded - they don't affect numeric calculations
  });
}

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
  const [errorDetails, setErrorDetails] = useState<{
    missing?: string[];
    coverage?: CoverageInfo;
    message?: string;
  } | null>(null);
  
  
  // Toast notification state
  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // Plan signature tracking for dirty state detection
  const [lastGeneratedSignature, setLastGeneratedSignature] = useState<string>("");

  // Progress state
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<number>(0);
  const [finalStepComplete, setFinalStepComplete] = useState<boolean>(false);

  // Refs for timer cleanup
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stepTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // AbortController ref for cancelling in-flight generation requests
  // This prevents the "clear during generation" race condition
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Generation token ref for additional guard against stale responses
  // Increments on both Generate and Clear to invalidate old requests
  const generationTokenRef = useRef<number>(0);

  // Map token from env (client-side)
  const mapToken = process.env.NEXT_PUBLIC_MAP_TOKEN || "";

  // Cleanup timers and abort controller on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
      // Abort any in-flight request on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
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
    
    // HARD RESET: When geometry is cleared, reset ALL downstream state
    // This prevents stale plan data from appearing after clear
    if (geo === null) {
      // CRITICAL: Abort any in-flight generation request to prevent race condition
      // This fixes the "clear during generation shows AI-VERIFIED without geometry" bug
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      // Increment generation token to invalidate any pending responses
      generationTokenRef.current += 1;
      
      // Reset loading state immediately on clear
      setIsLoading(false);
      
      setResponse(null);
      setRawJson(null);
      setError(null);
      setErrorDetails(null);
      setLastGeneratedSignature(""); // Clear signature on reset
      // Reset progress state in case of interrupted generation
      setElapsedSeconds(0);
      setProgressStep(0);
      setFinalStepComplete(false);
    } else {
      // Clear stale errors when user draws new geometry
      setError(null);
      setErrorDetails(null);
    }
  }, []);

  const handleJobDetailsChange = useCallback((details: JobDetails, isValid: boolean) => {
    setJobDetails(details);
    setJobValid(isValid);
  }, []);

  const canGenerate = geometry !== null && jobValid && !isLoading;

  // Derive current signature from current job details
  const currentSignature = useMemo(() => buildPlanSignature(jobDetails), [jobDetails]);

  // Plan is "dirty" if we have a generated plan but inputs have changed since generation
  const isPlanDirty = useMemo(() => {
    if (!response) return false; // No plan yet, can't be dirty
    if (!lastGeneratedSignature) return false; // No previous signature (shouldn't happen)
    return currentSignature !== lastGeneratedSignature;
  }, [response, lastGeneratedSignature, currentSignature]);

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

    // Abort any existing in-flight request before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    // Capture generation token at start - used to detect if request is stale
    generationTokenRef.current += 1;
    const requestToken = generationTokenRef.current;

    // Reset progress state
    setElapsedSeconds(0);
    setProgressStep(0);
    setFinalStepComplete(false);

    setIsLoading(true);
    setError(null);
    setErrorDetails(null);
    setResponse(null);
    setRawJson(null);

    try {
      const res = await fetch("/api/draft-tcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal, // Pass abort signal to fetch
      });

      const text = await res.text();

      // GUARD: Check if request was aborted or token changed (e.g., user cleared)
      // If so, discard results silently - do not update state
      if (requestToken !== generationTokenRef.current) {
        console.log("[generate] Discarding stale response - token mismatch");
        return;
      }

      if (!res.ok) {
        // Try to parse error JSON
        try {
          const errJson = JSON.parse(text);
          const msg =
            errJson.error ||
            errJson.details?.issues?.join("; ") ||
            `Request failed with status ${res.status}`;
          setError(msg);
          
          // Extract coverage gate error details if present
          if (errJson.details?.coverage && errJson.details?.missing) {
            setErrorDetails({
              missing: errJson.details.missing,
              coverage: errJson.details.coverage,
              message: errJson.details.message,
            });
          }
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
      
      // GUARD: Final check before applying response - token must still match
      // and geometry must still exist (user might have cleared during DEV_DELAY)
      if (requestToken !== generationTokenRef.current) {
        console.log("[generate] Discarding stale response after delay - token mismatch");
        return;
      }
      
      if (isMountedRef.current) {
        setResponse(data);
        setRawJson(JSON.stringify(data, null, 2));
        
        // Store the signature that was used to generate this plan
        setLastGeneratedSignature(buildPlanSignature(jobDetails));
        
        // Show success toast with appropriate message
        setToastMessage("Plan Refined: AI updated spacing and taper based on MUTCD Table 6C-2.");
        setShowToast(true);
      }
    } catch (err) {
      // Handle AbortError gracefully - user cancelled, no need to show error
      if (err instanceof Error && err.name === "AbortError") {
        console.log("[generate] Request aborted by user");
        // Don't set error state - this is expected when user clears
        return;
      }
      
      // Only show error if token still matches (request wasn't invalidated)
      if (isMountedRef.current && requestToken === generationTokenRef.current) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      }
    } finally {
      // Only update loading state if this request is still current
      if (isMountedRef.current && requestToken === generationTokenRef.current) {
        setIsLoading(false);
      }
      
      // Clear the controller ref if this is the current controller
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [buildRequest, jobDetails]);

  const handleRegenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  // Dev tools state
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);

  // Selection summary
  const selectionSummary = geometry
    ? geometry.type === "bbox"
      ? `Bbox: [${geometry.bbox.map((n) => n.toFixed(5)).join(", ")}]`
      : `Work Zone: ${geometry.polygon[0]?.length ?? 0} points`
    : null;

  return (
    <div className="min-h-screen w-full bg-white font-sans text-slate-600 relative">
      {/* Amber Glow Background */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(125% 125% at 50% 90%, #ffffff 40%, #f59e0b 100%)`,
          backgroundSize: "100% 100%",
        }}
      />
      
      {/* Sticky Header - Command Center Style */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-sm relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#FFB300] flex items-center justify-center shadow-sm">
              <svg className="w-5 h-5 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">TCP Planner</h1>
              <p className="text-xs text-slate-500 font-medium tracking-wide uppercase">Industrial Edition</p>
            </div>
          </div>
          
          {/* Header Actions */}
          <div className="flex items-center gap-4">
             {/* Add any header actions here if needed */}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-32 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column - Input (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {/* Map Section */}
            <div className="bg-white rounded-sm shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Work Zone Location</h2>
                <span className="text-[10px] font-mono text-slate-400">MAP-01</span>
              </div>

              <div className="p-4">
                {mapToken ? (
                  <div className="shadow-inner rounded-sm overflow-hidden border border-slate-200">
                    <MapSelector mapToken={mapToken} onGeometryChange={handleGeometryChange} />
                  </div>
                ) : (
                  <div className="w-full h-[400px] rounded-sm border border-red-300 bg-red-50 flex items-center justify-center p-4">
                    <p className="text-red-600 text-center font-mono text-sm">
                      ERR_MISSING_TOKEN: Set NEXT_PUBLIC_MAP_TOKEN
                    </p>
                  </div>
                )}

                {/* Selection Summary */}
                {selectionSummary && (
                  <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-[#FFB300]"></div>
                      <h3 className="text-xs font-bold text-slate-700 uppercase">Selected Area</h3>
                    </div>
                    <p className="text-xs font-mono text-slate-600 pl-4">{selectionSummary}</p>
                    {locationLabel && (
                      <p className="text-xs text-slate-500 pl-4 mt-1 truncate">
                        {locationLabel}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Job Details Section */}
            <div className="bg-white rounded-sm shadow-sm border border-slate-200">
              <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Job Specifications</h2>
                <span className="text-[10px] font-mono text-slate-400">FORM-01</span>
              </div>
              <div className="p-4">
                <JobDetailsForm onChange={handleJobDetailsChange} />
              </div>
            </div>

            {/* Generate Button */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`w-full py-3 px-4 rounded-sm font-bold text-base tracking-wide transition-all active:scale-[0.98] ${
                  canGenerate
                    ? "bg-[#FFB300] text-slate-900 hover:bg-[#F59E0B] shadow-md border border-[#D97706]"
                    : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                }`}
              >
                {isLoading 
                  ? "PROCESSING..." 
                  : response 
                    ? "REGENERATE PLAN"
                    : "GENERATE DRAFT PLAN"
                }
              </button>
              {/* Helper text */}
              <p className="text-[10px] text-slate-400 text-center font-mono">
                AI VERIFICATION • MUTCD COMPLIANCE • AUTO-REFINEMENT
              </p>
            </div>

            {/* Status feedback */}
            {!canGenerate && !isLoading && (
              <div className="text-xs text-center space-y-2">
                {!geometry && (
                  <div className="flex items-center justify-center gap-2 text-amber-700 bg-amber-50 px-3 py-2 rounded-sm border border-amber-100">
                    <span className="font-bold">⚠ ACTION REQUIRED:</span> Define work zone on map
                  </div>
                )}
                {geometry && !jobValid && (
                  <div className="flex items-center justify-center gap-2 text-red-700 bg-red-50 px-3 py-2 rounded-sm border border-red-100">
                    <span className="font-bold">⚠ INVALID INPUT:</span> Check job details
                  </div>
                )}
              </div>
            )}
            {canGenerate && (
              <div className="flex items-center justify-center gap-2 text-emerald-700 bg-emerald-50 px-3 py-2 rounded-sm border border-emerald-100 text-xs">
                <span className="font-bold">✓ SYSTEM READY:</span> Awaiting generation command
              </div>
            )}
          </div>

          {/* Right Column - Output (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="bg-white rounded-sm shadow-md border border-slate-200 min-h-[600px] flex flex-col h-full">
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
                  errorDetails={errorDetails}
                  onRegenerate={handleRegenerate}
                  canRegenerate={canGenerate}
                  hasGeometry={geometry !== null}
                  hasGeneratedPlan={response !== null}
                  isPlanDirty={isPlanDirty}
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
                  geometry={
                    geometry
                      ? {
                          type: geometry.type,
                          bbox: geometry.type === "bbox" ? geometry.bbox : undefined,
                          polygon: geometry.type === "polygon" 
                            ? geometry.polygon.map(ring => 
                                ring.map(coord => [coord[0], coord[1]] as [number, number])
                              )
                            : undefined,
                        } as DiagramGeometry
                      : null
                  }
                />
              )}
            </div>
          </div>
        </div>

        {/* DEV ONLY: Collapsible RAG Search Tester */}
        {IS_DEV && (
          <div className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-300 ease-in-out ${
            isDevToolsOpen ? "translate-y-0" : "translate-y-[calc(100%-40px)]"
          }`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="bg-slate-900 rounded-t-lg shadow-2xl border-t border-slate-700 overflow-hidden">
                <button 
                  onClick={() => setIsDevToolsOpen(!isDevToolsOpen)}
                  className="w-full h-10 bg-slate-800 hover:bg-slate-700 flex items-center justify-between px-4 cursor-pointer transition-colors"
                >
                  <span className="text-xs font-mono font-bold text-[#FFB300]">
                    🛠 DEV TOOLS // RAG SEARCH
                  </span>
                  <span className="text-slate-400">
                    {isDevToolsOpen ? "▼ Collapse" : "▲ Expand"}
                  </span>
                </button>
                <div className="p-4 bg-slate-100 max-h-[600px] overflow-y-auto">
                  <RagSearchTester />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Toast notification for AI refinement feedback */}
      <Toast
        message={toastMessage}
        visible={showToast}
        onClose={() => setShowToast(false)}
        duration={3000}
        type="success"
      />
    </div>
  );
}
