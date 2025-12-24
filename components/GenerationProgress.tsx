"use client";

interface GenerationProgressProps {
  elapsedSeconds: number;
  progressStep: number; // 0-3 (step index)
  finalStepComplete: boolean;
}

const STEPS = [
  "Sending job details",
  "Refining calculations with MUTCD guidance",
  "Verifying spacing, taper & devices",
  "Finalizing plan",
];

export default function GenerationProgress({
  elapsedSeconds,
  progressStep,
  finalStepComplete,
}: GenerationProgressProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Determine if generation is still in progress
  const isGenerating = !finalStepComplete;

  return (
    <div
      className="flex flex-col h-full p-6"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={isGenerating}
      aria-label="TCP generation progress"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="relative w-3 h-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FFB300]"></span>
          </div>
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
            Processing Request
          </h3>
        </div>
        <span className="font-mono text-xs text-slate-400">
          T+{formatTime(elapsedSeconds)}
        </span>
      </div>

      {/* Terminal Feed */}
      <div className="bg-slate-50 border border-slate-200 rounded-sm p-4 mb-6 font-mono text-xs overflow-hidden">
        <div className="space-y-2">
          {STEPS.map((step, index) => {
            const isComplete =
              index < progressStep || (index === 3 && finalStepComplete);
            const isCurrent = index === progressStep && !finalStepComplete;
            
            // Only show steps that have started
            if (index > progressStep && !finalStepComplete) return null;

            return (
              <div
                key={step}
                className={`flex items-start gap-2 transition-all ${
                  isCurrent ? "text-slate-800" : "text-emerald-600"
                }`}
              >
                <span className="text-slate-400 shrink-0">
                  {isComplete ? "✓" : ">"}
                </span>
                <span className={isCurrent ? "font-bold" : ""}>
                  {step}
                  {isCurrent && (
                    <span className="inline-block w-1.5 h-3 ml-1 bg-slate-800 animate-pulse align-middle" />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Skeleton Loader - Plan Preview */}
      <div className="flex-1 space-y-4 animate-pulse opacity-50">
        {/* Skeleton Summary */}
        <div className="h-24 bg-slate-100 rounded-sm border border-slate-200"></div>
        
        {/* Skeleton Diagram */}
        <div className="h-64 bg-slate-100 rounded-sm border border-slate-200"></div>
        
        {/* Skeleton Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="h-32 bg-slate-100 rounded-sm border border-slate-200"></div>
          <div className="h-32 bg-slate-100 rounded-sm border border-slate-200"></div>
        </div>
      </div>
      
      {/* Live region for screen readers */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {progressStep < 3
          ? `Step ${progressStep + 1} of 4: ${STEPS[progressStep]}`
          : finalStepComplete
            ? "Generation complete"
            : "Finalizing, waiting for server response"}
      </div>
    </div>
  );
}
