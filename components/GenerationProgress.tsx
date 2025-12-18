"use client";

interface GenerationProgressProps {
  elapsedSeconds: number;
  progressStep: number; // 0-3 (step index)
  finalStepComplete: boolean;
}

const STEPS = [
  "Sending job details",
  "Generating plan",
  "Rendering diagram",
  "Finalizing",
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
      className="flex flex-col items-center justify-center h-full min-h-[400px] p-8"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={isGenerating}
      aria-label="TCP generation progress"
    >
      {/* Spinner - decorative, hidden from screen readers */}
      <div 
        className="w-16 h-16 mb-6 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" 
        aria-hidden="true"
      />

      {/* Title */}
      <h3 className="text-xl font-semibold text-gray-800 mb-2">
        Generating draft TCP…
      </h3>

      {/* Subtext */}
      <p className="text-sm text-gray-500 mb-4">
        This typically takes 10–20 seconds.
      </p>

      {/* Timer - hidden from live announcements to avoid noise every second */}
      <div
        className="text-lg font-mono text-orange-600 mb-6"
        aria-hidden="true"
      >
        Elapsed: {formatTime(elapsedSeconds)}
      </div>

      {/* Step List */}
      <div className="w-full max-w-xs space-y-3" role="list" aria-label="Generation steps">
        {STEPS.map((step, index) => {
          const isComplete =
            index < progressStep || (index === 3 && finalStepComplete);
          const isCurrent = index === progressStep && !finalStepComplete;
          const isFinalizing = index === 3 && isCurrent;

          // Determine status text for screen readers
          const statusText = isComplete
            ? "completed"
            : isCurrent
              ? isFinalizing
                ? "in progress, waiting for server"
                : "in progress"
              : "pending";

          return (
            <div
              key={step}
              role="listitem"
              aria-label={`Step ${index + 1}: ${step}, ${statusText}`}
              className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-all ${
                isComplete
                  ? "bg-green-50 text-green-800"
                  : isCurrent
                    ? "bg-orange-50 text-orange-800"
                    : "bg-gray-50 text-gray-400"
              }`}
            >
              {/* Status Icon */}
              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center" aria-hidden="true">
                {isComplete ? (
                  <svg
                    className="w-5 h-5 text-green-600"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : isFinalizing ? (
                  // Pulse dots for finalizing step (waiting for API)
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
                  </span>
                ) : isCurrent ? (
                  <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <div className="w-4 h-4 border-2 border-gray-300 rounded-full" />
                )}
              </div>

              {/* Step Text */}
              <span className="text-sm font-medium">
                {step}
              </span>
            </div>
          );
        })}
      </div>
      
      {/* Live region for step announcements */}
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

