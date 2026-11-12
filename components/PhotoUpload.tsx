"use client";

import { useState, useRef, useCallback } from "react";

export interface VisionExtraction {
  road_context: "urban_low_speed" | "urban_high_speed" | "rural" | "expressway_freeway" | null;
  estimated_lanes: number | null;
  visible_speed_limit: number | null;
  shoulder_present: boolean | null;
  hazards: string[];
  notes: string;
  confidence: number;
  raw_description: string;
}

export interface PhotoUploadProps {
  onExtraction: (extraction: VisionExtraction) => void;
  onConfirm: (extraction: VisionExtraction, userEdits: VisionExtraction) => void;
  onCancel: () => void;
  backendUrl: string;
}

export default function PhotoUpload({
  onExtraction,
  onConfirm,
  onCancel,
  backendUrl,
}: PhotoUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<VisionExtraction | null>(null);
  const [userEdits, setUserEdits] = useState<VisionExtraction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (JPEG, PNG, etc.)");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB");
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
    setExtraction(null);
    setUserEdits(null);
  }, []);

  const handleExtract = useCallback(async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setIsExtracting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(`${backendUrl}/api/vision/extract`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "Failed to analyze image");
      }

      const data = await response.json();
      const extracted: VisionExtraction = {
        road_context: data.road_context,
        estimated_lanes: data.estimated_lanes,
        visible_speed_limit: data.visible_speed_limit,
        shoulder_present: data.shoulder_present,
        hazards: data.hazards || [],
        notes: data.notes || "",
        confidence: data.confidence || 0.5,
        raw_description: data.raw_description || "",
      };

      setExtraction(extracted);
      setUserEdits({ ...extracted });
      onExtraction(extracted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze image");
    } finally {
      setIsUploading(false);
      setIsExtracting(false);
    }
  }, [selectedFile, backendUrl, onExtraction]);

  const handleConfirmFindings = useCallback(() => {
    if (extraction && userEdits) {
      onConfirm(extraction, userEdits);
    }
  }, [extraction, userEdits, onConfirm]);

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setExtraction(null);
    setUserEdits(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return (
    <div className="bg-white border border-slate-200 rounded-sm shadow-sm overflow-hidden">
      <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
          Site Photo Analysis
        </h3>
        <span className="text-[10px] font-mono text-slate-400">VISION-01</span>
      </div>

      <div className="p-4 space-y-4">
        {/* File Input */}
        {!selectedFile && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-sm p-8 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50/20 transition-colors"
          >
            <svg
              className="w-12 h-12 text-slate-400 mx-auto mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm text-slate-600 font-medium">
              Click to upload a site photo
            </p>
            <p className="text-xs text-slate-400 mt-1">
              JPEG, PNG up to 10MB
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Preview */}
        {previewUrl && (
          <div className="relative">
            <img
              src={previewUrl}
              alt="Site photo preview"
              className="w-full h-48 object-cover rounded-sm border border-slate-200"
            />
            <button
              onClick={handleClear}
              className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-sm text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Extract Button */}
        {selectedFile && !extraction && (
          <button
            onClick={handleExtract}
            disabled={isExtracting}
            className="w-full py-2.5 bg-amber-500 text-white font-semibold rounded-sm hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {isExtracting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Analyzing with Claude Vision...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Analyze Photo
              </>
            )}
          </button>
        )}

        {/* Extraction Results with Edit */}
        {extraction && userEdits && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-2 rounded-sm border border-amber-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">
                Review and confirm the AI findings below
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Confidence</span>
                <span className={`text-sm font-mono ${extraction.confidence >= 0.7 ? "text-emerald-600" : extraction.confidence >= 0.5 ? "text-amber-600" : "text-red-600"}`}>
                  {(extraction.confidence * 100).toFixed(0)}%
                </span>
              </div>

              {/* Road Context */}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Road Context
                </label>
                <select
                  value={userEdits.road_context || ""}
                  onChange={(e) => setUserEdits({ ...userEdits, road_context: e.target.value as VisionExtraction["road_context"] || null })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                >
                  <option value="">Unknown</option>
                  <option value="urban_low_speed">Urban Low Speed (&le;35 mph)</option>
                  <option value="urban_high_speed">Urban High Speed (&gt;35 mph)</option>
                  <option value="rural">Rural</option>
                  <option value="expressway_freeway">Expressway/Freeway</option>
                </select>
              </div>

              {/* Lanes */}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Estimated Lanes
                </label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={userEdits.estimated_lanes || ""}
                  onChange={(e) => setUserEdits({ ...userEdits, estimated_lanes: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                />
              </div>

              {/* Speed Limit */}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Visible Speed Limit (mph)
                </label>
                <input
                  type="number"
                  min="15"
                  max="75"
                  step="5"
                  value={userEdits.visible_speed_limit || ""}
                  onChange={(e) => setUserEdits({ ...userEdits, visible_speed_limit: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                />
              </div>

              {/* Shoulder */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="shoulder"
                  checked={userEdits.shoulder_present || false}
                  onChange={(e) => setUserEdits({ ...userEdits, shoulder_present: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <label htmlFor="shoulder" className="text-xs font-medium text-slate-600">
                  Shoulder Present
                </label>
              </div>

              {/* Hazards */}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">
                  Hazards Detected
                </label>
                <input
                  type="text"
                  value={userEdits.hazards.join(", ")}
                  onChange={(e) => setUserEdits({ ...userEdits, hazards: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="e.g., construction, school zone, curve"
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                />
              </div>

              {/* AI Description */}
              {extraction.raw_description && (
                <div>
                  <label className="text-xs font-medium text-slate-500 block mb-1">
                    AI Description
                  </label>
                  <p className="text-xs text-slate-600 bg-white p-2 rounded border border-slate-100">
                    {extraction.raw_description}
                  </p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 py-2 border border-slate-300 text-slate-700 font-medium rounded-sm hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmFindings}
                className="flex-1 py-2 bg-emerald-600 text-white font-semibold rounded-sm hover:bg-emerald-700 transition flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Confirm & Use
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
