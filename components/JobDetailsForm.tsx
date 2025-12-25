"use client";

import { useState, useCallback, useEffect } from "react";

export type RoadType = "2_lane_undivided" | "multilane_divided" | "intersection";
export type WorkType = "shoulder_work" | "lane_closure" | "one_lane_two_way_flaggers";

/**
 * Job Owner / Company structured data
 */
export interface JobOwner {
  companyName: string;
  contractorName: string;
  phone: string;
  jobNumber?: string;
  jobAssignedDate?: string; // ISO format: yyyy-mm-dd
}

export interface JobDetails {
  roadType: RoadType;
  postedSpeedMph: number;
  workType: WorkType;
  workLengthFt: number;
  isNight: boolean;
  notes: string;
  // Job owner / company info (structured)
  jobOwner: JobOwner;
}

export interface JobDetailsFormProps {
  onChange: (details: JobDetails, isValid: boolean) => void;
}

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  "shoulder_work": "Shoulder Work",
  "lane_closure": "Lane Closure",
  "one_lane_two_way_flaggers": "One-Lane Two-Way (Flaggers)",
};

/**
 * Extract digits from a phone number string
 */
function extractDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Validate phone number (at least 10 digits)
 */
function isValidPhone(phone: string): boolean {
  const digits = extractDigits(phone);
  return digits.length >= 10;
}

// Road Type Icons
const RoadTypeIcon = ({ type, selected }: { type: RoadType; selected: boolean }) => {
  const color = selected ? "text-[#FFB300]" : "text-slate-400";
  
  switch (type) {
    case "2_lane_undivided":
      return (
        <svg className={`w-8 h-8 ${color}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M16 4V28M16 4L16 28" strokeDasharray="4 4" />
          <path d="M8 24L8 8M8 8L5 11M8 8L11 11" />
          <path d="M24 8L24 24M24 24L21 21M24 24L27 21" />
        </svg>
      );
    case "multilane_divided":
      return (
        <svg className={`w-8 h-8 ${color}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="14" y="4" width="4" height="24" fill="currentColor" className="opacity-20" stroke="none" />
          <path d="M8 24L8 8M8 8L5 11M8 8L11 11" />
          <path d="M24 8L24 24M24 24L21 21M24 24L27 21" />
        </svg>
      );
    case "intersection":
      return (
        <svg className={`w-8 h-8 ${color}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M16 4V28" />
          <path d="M4 16H28" />
          <rect x="12" y="12" width="8" height="8" fill="currentColor" className="opacity-20" stroke="none" />
        </svg>
      );
  }
};

export default function JobDetailsForm({ onChange }: JobDetailsFormProps) {
  // Road configuration
  const [roadType, setRoadType] = useState<RoadType>("2_lane_undivided");
  const [postedSpeedMph, setPostedSpeedMph] = useState<string>("35");
  
  // Work zone parameters
  const [workType, setWorkType] = useState<WorkType>("lane_closure");
  const [workLengthFt, setWorkLengthFt] = useState<string>("500");
  const [isNight, setIsNight] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>("");
  
  // Job owner / company info (all fields now in structured group)
  const [companyName, setCompanyName] = useState<string>("");
  const [contractorName, setContractorName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [jobNumber, setJobNumber] = useState<string>("");
  const [jobAssignedDate, setJobAssignedDate] = useState<string>("");

  // Validation state
  const [speedError, setSpeedError] = useState<string | null>(null);
  const [lengthError, setLengthError] = useState<string | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [contractorError, setContractorError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  
  // Track if fields have been touched (for blur-based validation display)
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  const markTouched = (field: string) => {
    setTouchedFields(prev => new Set(prev).add(field));
  };

  const validateAndNotify = useCallback(() => {
    const speed = Number(postedSpeedMph);
    const length = Number(workLengthFt);

    let speedErr: string | null = null;
    let lengthErr: string | null = null;
    let companyErr: string | null = null;
    let contractorErr: string | null = null;
    let phoneErr: string | null = null;

    // Speed validation
    if (isNaN(speed) || postedSpeedMph.trim() === "") {
      speedErr = "Speed is required";
    } else if (speed < 15) {
      speedErr = "Speed must be at least 15 mph";
    } else if (speed > 75) {
      speedErr = "Speed must be 75 mph or less";
    }

    // Work length validation
    if (isNaN(length) || workLengthFt.trim() === "") {
      lengthErr = "Work length is required";
    } else if (length <= 0) {
      lengthErr = "Work length must be greater than 0";
    }
    
    // Company name validation (required)
    if (!companyName.trim()) {
      companyErr = "Company name is required";
    }
    
    // Contractor name validation (required)
    if (!contractorName.trim()) {
      contractorErr = "Contractor/Foreman name is required";
    }
    
    // Phone validation (required, at least 10 digits)
    if (!phone.trim()) {
      phoneErr = "Phone number is required";
    } else if (!isValidPhone(phone)) {
      phoneErr = "Phone must have at least 10 digits";
    }

    setSpeedError(speedErr);
    setLengthError(lengthErr);
    setCompanyError(companyErr);
    setContractorError(contractorErr);
    setPhoneError(phoneErr);

    const isValid = 
      speedErr === null && 
      lengthErr === null && 
      companyErr === null &&
      contractorErr === null &&
      phoneErr === null;

    // Build structured jobOwner object
    const jobOwner: JobOwner = {
      companyName: companyName.trim(),
      contractorName: contractorName.trim(),
      phone: phone.trim(),
      jobNumber: jobNumber.trim() || undefined,
      jobAssignedDate: jobAssignedDate || undefined,
    };

    const details: JobDetails = {
      roadType,
      postedSpeedMph: isNaN(speed) ? 0 : speed,
      workType,
      workLengthFt: isNaN(length) ? 0 : length,
      isNight,
      notes,
      jobOwner,
    };

    onChange(details, isValid);
  }, [
    roadType, postedSpeedMph, workType, workLengthFt, isNight, notes, 
    companyName, contractorName, phone, jobNumber, jobAssignedDate, 
    onChange
  ]);

  useEffect(() => {
    validateAndNotify();
  }, [validateAndNotify]);

  const handleSpeedChange = (value: string) => {
    setPostedSpeedMph(value);
  };

  const handleLengthChange = (value: string) => {
    setWorkLengthFt(value);
  };
  
  // Round work length to nearest integer on blur (prevent meaningless precision)
  const handleLengthBlur = () => {
    markTouched("workLengthFt");
    const num = Number(workLengthFt);
    if (!isNaN(num) && num > 0) {
      setWorkLengthFt(Math.round(num).toString());
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* SECTION 1: ROAD SETTINGS */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2">
          Road Configuration
        </h3>
        
        {/* Road Type Selector - Icon Grid */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
            Road Type
          </label>
          <div className="grid grid-cols-3 gap-3">
            {(["2_lane_undivided", "multilane_divided", "intersection"] as RoadType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setRoadType(type)}
                aria-pressed={roadType === type}
                className={`flex flex-col items-center justify-center p-3 rounded-sm border transition-all ${
                  roadType === type
                    ? "bg-[#FFB300]/10 border-[#FFB300] shadow-sm"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <RoadTypeIcon type={type} selected={roadType === type} />
                <span className={`mt-2 text-[10px] font-bold uppercase text-center leading-tight ${
                  roadType === type ? "text-slate-900" : "text-slate-500"
                }`}>
                  {type.replace(/_/g, " ")}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Posted Speed */}
        <div>
          <label htmlFor="postedSpeedMph" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Posted Speed (mph)
          </label>
          <div className="relative">
            <input
              type="number"
              id="postedSpeedMph"
              value={postedSpeedMph}
              onChange={(e) => handleSpeedChange(e.target.value)}
              onBlur={() => markTouched("postedSpeedMph")}
              min={15}
              max={75}
              className={`w-full px-3 py-2 bg-slate-50 border rounded-sm text-slate-900 font-mono text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300] transition-colors ${
                speedError && touchedFields.has("postedSpeedMph") ? "border-red-300 bg-red-50" : "border-slate-200"
              }`}
              aria-invalid={speedError ? "true" : "false"}
              aria-describedby={speedError ? "speed-error" : undefined}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <span className="text-slate-400 text-xs font-mono">MPH</span>
            </div>
          </div>
          {speedError && touchedFields.has("postedSpeedMph") ? (
            <p id="speed-error" className="mt-1 text-xs text-red-600 font-medium">
              {speedError}
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-slate-400">Range: 15–75 mph</p>
          )}
        </div>
      </div>

      {/* SECTION 2: WORK SETTINGS */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mt-2">
          Work Zone Parameters
        </h3>

        {/* Work Type */}
        <div>
          <label htmlFor="workType" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Operation Type
          </label>
          <select
            id="workType"
            value={workType}
            onChange={(e) => setWorkType(e.target.value as WorkType)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-sm text-slate-900 text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300]"
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
          <label htmlFor="workLengthFt" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Work Zone Length (ft)
          </label>
          <div className="relative">
            <input
              type="number"
              id="workLengthFt"
              value={workLengthFt}
              onChange={(e) => handleLengthChange(e.target.value)}
              onBlur={handleLengthBlur}
              min={1}
              step={1}
              className={`w-full px-3 py-2 bg-slate-50 border rounded-sm text-slate-900 font-mono text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300] transition-colors ${
                lengthError && touchedFields.has("workLengthFt") ? "border-red-300 bg-red-50" : "border-slate-200"
              }`}
              aria-invalid={lengthError ? "true" : "false"}
              aria-describedby={lengthError ? "length-error" : undefined}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <span className="text-slate-400 text-xs font-mono">FT</span>
            </div>
          </div>
          {lengthError && touchedFields.has("workLengthFt") && (
            <p id="length-error" className="mt-1 text-xs text-red-600 font-medium">
              {lengthError}
            </p>
          )}
        </div>

        {/* Day/Night Toggle */}
        <div>
          <span className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Time of Operation</span>
          <div className="flex bg-slate-100 p-1 rounded-sm border border-slate-200">
            <button
              type="button"
              onClick={() => setIsNight(false)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-sm transition-all ${
                !isNight 
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200" 
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              ☀ Day
            </button>
            <button
              type="button"
              onClick={() => setIsNight(true)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-sm transition-all ${
                isNight 
                  ? "bg-slate-800 text-white shadow-sm border border-slate-700" 
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              ☾ Night
            </button>
          </div>
        </div>

        {/* Planner Notes */}
        <div>
          <label htmlFor="notes" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Planner Notes <span className="text-[#FFB300] ml-1 opacity-80">(Critical Context)</span>
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="e.g. School zone nearby, maintain driveway access, limited shoulder..."
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-sm text-slate-900 text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300] resize-y placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* SECTION 3: JOB OWNER / COMPANY */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 pb-2 mt-2">
          Job Owner / Company
        </h3>

        {/* Company Name (Required) */}
        <div>
          <label htmlFor="companyName" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Company Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            onBlur={() => markTouched("companyName")}
            placeholder="e.g. ABC Construction, Inc."
            className={`w-full px-3 py-2 bg-slate-50 border rounded-sm text-slate-900 text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300] transition-colors ${
              companyError && touchedFields.has("companyName") ? "border-red-300 bg-red-50" : "border-slate-200"
            }`}
            aria-invalid={companyError ? "true" : "false"}
            aria-describedby={companyError ? "company-error" : "company-helper"}
          />
          {companyError && touchedFields.has("companyName") ? (
            <p id="company-error" className="mt-1 text-xs text-red-600 font-medium">
              {companyError}
            </p>
          ) : (
            <p id="company-helper" className="mt-1 text-[10px] text-slate-400">
              This name will appear on the TCP and exported PDF.
            </p>
          )}
        </div>

        {/* Contractor / Foreman Name (Required) */}
        <div>
          <label htmlFor="contractorName" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Contractor / Foreman Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="contractorName"
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
            onBlur={() => markTouched("contractorName")}
            placeholder="e.g. John Smith"
            className={`w-full px-3 py-2 bg-slate-50 border rounded-sm text-slate-900 text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300] transition-colors ${
              contractorError && touchedFields.has("contractorName") ? "border-red-300 bg-red-50" : "border-slate-200"
            }`}
            aria-invalid={contractorError ? "true" : "false"}
            aria-describedby={contractorError ? "contractor-error" : undefined}
          />
          {contractorError && touchedFields.has("contractorName") && (
            <p id="contractor-error" className="mt-1 text-xs text-red-600 font-medium">
              {contractorError}
            </p>
          )}
        </div>

        {/* Phone Number (Required) */}
        <div>
          <label htmlFor="phone" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Phone Number <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => markTouched("phone")}
            placeholder="e.g. (555) 123-4567"
            className={`w-full px-3 py-2 bg-slate-50 border rounded-sm text-slate-900 text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300] transition-colors ${
              phoneError && touchedFields.has("phone") ? "border-red-300 bg-red-50" : "border-slate-200"
            }`}
            aria-invalid={phoneError ? "true" : "false"}
            aria-describedby={phoneError ? "phone-error" : undefined}
          />
          {phoneError && touchedFields.has("phone") && (
            <p id="phone-error" className="mt-1 text-xs text-red-600 font-medium">
              {phoneError}
            </p>
          )}
        </div>

        {/* Job Number (Optional) */}
        <div>
          <label htmlFor="jobNumber" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Job Number <span className="text-slate-400 text-[10px]">(Optional)</span>
          </label>
          <input
            type="text"
            id="jobNumber"
            value={jobNumber}
            onChange={(e) => setJobNumber(e.target.value)}
            placeholder="e.g. JOB-2025-041"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-sm text-slate-900 text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300]"
          />
        </div>

        {/* Job Assigned Date (Optional) */}
        <div>
          <label htmlFor="jobAssignedDate" className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
            Job Assigned Date <span className="text-slate-400 text-[10px]">(Optional)</span>
          </label>
          <input
            type="date"
            id="jobAssignedDate"
            value={jobAssignedDate}
            onChange={(e) => setJobAssignedDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-sm text-slate-900 text-sm focus:ring-1 focus:ring-[#FFB300] focus:border-[#FFB300]"
          />
        </div>
      </div>
    </div>
  );
}
