"use client";

import { useState, useCallback, useEffect } from "react";

export type RoadType = "2_lane_undivided" | "multilane_divided" | "intersection";
export type WorkType = "shoulder_work" | "lane_closure" | "one_lane_two_way_flaggers";

export interface JobDetails {
  roadType: RoadType;
  postedSpeedMph: number;
  workType: WorkType;
  workLengthFt: number;
  isNight: boolean;
  notes: string;
}

export interface JobDetailsFormProps {
  onChange: (details: JobDetails, isValid: boolean) => void;
}

const ROAD_TYPE_LABELS: Record<RoadType, string> = {
  "2_lane_undivided": "2-Lane Undivided",
  "multilane_divided": "Multilane Divided",
  "intersection": "Intersection",
};

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  "shoulder_work": "Shoulder Work",
  "lane_closure": "Lane Closure",
  "one_lane_two_way_flaggers": "One-Lane Two-Way (Flaggers)",
};

export default function JobDetailsForm({ onChange }: JobDetailsFormProps) {
  const [roadType, setRoadType] = useState<RoadType>("2_lane_undivided");
  const [postedSpeedMph, setPostedSpeedMph] = useState<string>("35");
  const [workType, setWorkType] = useState<WorkType>("lane_closure");
  const [workLengthFt, setWorkLengthFt] = useState<string>("500");
  const [isNight, setIsNight] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");

  // Validation state
  const [speedError, setSpeedError] = useState<string | null>(null);
  const [lengthError, setLengthError] = useState<string | null>(null);

  const validateAndNotify = useCallback(() => {
    const speed = Number(postedSpeedMph);
    const length = Number(workLengthFt);

    let speedErr: string | null = null;
    let lengthErr: string | null = null;

    if (isNaN(speed) || postedSpeedMph.trim() === "") {
      speedErr = "Speed is required";
    } else if (speed < 15) {
      speedErr = "Speed must be at least 15 mph";
    } else if (speed > 75) {
      speedErr = "Speed must be 75 mph or less";
    }

    if (isNaN(length) || workLengthFt.trim() === "") {
      lengthErr = "Work length is required";
    } else if (length <= 0) {
      lengthErr = "Work length must be greater than 0";
    }

    setSpeedError(speedErr);
    setLengthError(lengthErr);

    const isValid = speedErr === null && lengthErr === null;

    const details: JobDetails = {
      roadType,
      postedSpeedMph: isNaN(speed) ? 0 : speed,
      workType,
      workLengthFt: isNaN(length) ? 0 : length,
      isNight,
      notes,
    };

    onChange(details, isValid);
  }, [roadType, postedSpeedMph, workType, workLengthFt, isNight, notes, onChange]);

  useEffect(() => {
    validateAndNotify();
  }, [validateAndNotify]);

  const handleSpeedChange = (value: string) => {
    setPostedSpeedMph(value);
  };

  const handleLengthChange = (value: string) => {
    setWorkLengthFt(value);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Road Type */}
      <div>
        <label htmlFor="roadType" className="block text-sm font-medium text-gray-700 mb-1">
          Road Type
        </label>
        <select
          id="roadType"
          value={roadType}
          onChange={(e) => setRoadType(e.target.value as RoadType)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
        >
          {Object.entries(ROAD_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Posted Speed */}
      <div>
        <label htmlFor="postedSpeedMph" className="block text-sm font-medium text-gray-700 mb-1">
          Posted Speed (mph)
        </label>
        <input
          type="number"
          id="postedSpeedMph"
          value={postedSpeedMph}
          onChange={(e) => handleSpeedChange(e.target.value)}
          min={15}
          max={75}
          className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 ${
            speedError ? "border-red-500 bg-red-50" : "border-gray-300"
          }`}
          aria-invalid={speedError ? "true" : "false"}
          aria-describedby={speedError ? "speed-error" : undefined}
        />
        {speedError ? (
          <p id="speed-error" className="mt-1 text-sm text-red-600">
            {speedError}
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-500">Valid range: 15–75 mph</p>
        )}
      </div>

      {/* Work Type */}
      <div>
        <label htmlFor="workType" className="block text-sm font-medium text-gray-700 mb-1">
          Work Type
        </label>
        <select
          id="workType"
          value={workType}
          onChange={(e) => setWorkType(e.target.value as WorkType)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500"
        >
          {Object.entries(WORK_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Work Length */}
      <div>
        <label htmlFor="workLengthFt" className="block text-sm font-medium text-gray-700 mb-1">
          Work Length (ft)
        </label>
        <input
          type="number"
          id="workLengthFt"
          value={workLengthFt}
          onChange={(e) => handleLengthChange(e.target.value)}
          min={1}
          className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 ${
            lengthError ? "border-red-500 bg-red-50" : "border-gray-300"
          }`}
          aria-invalid={lengthError ? "true" : "false"}
          aria-describedby={lengthError ? "length-error" : undefined}
        />
        {lengthError && (
          <p id="length-error" className="mt-1 text-sm text-red-600">
            {lengthError}
          </p>
        )}
      </div>

      {/* Day/Night Toggle */}
      <div>
        <span className="block text-sm font-medium text-gray-700 mb-2">Time of Work</span>
        <div className="flex gap-4">
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="radio"
              name="timeOfWork"
              value="day"
              checked={!isNight}
              onChange={() => setIsNight(false)}
              className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
            />
            <span className="ml-2 text-sm text-gray-700">Day</span>
          </label>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="radio"
              name="timeOfWork"
              value="night"
              checked={isNight}
              onChange={() => setIsNight(true)}
              className="w-4 h-4 text-orange-500 border-gray-300 focus:ring-orange-500"
            />
            <span className="ml-2 text-sm text-gray-700">Night</span>
          </label>
        </div>
      </div>

      {/* Planner Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Planner Notes <span className="text-orange-600">(Important)</span>
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Describe anything that might affect the traffic control plan — special conditions, equipment limits, nearby hazards, crew preferences, access needs, or instructions from the city/utility.
        </p>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Example: School nearby, pedestrian detours required. Work must maintain driveway access. Limited shoulder width. City inspector requires advance warning signs."
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 resize-y"
        />
      </div>
    </div>
  );
}
