/**
 * Backend API client for the FastAPI rules engine.
 * 
 * Replaces LLM-generated numbers with deterministic engine computation.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";

export interface SiteFactsInput {
  posted_or_statutory_speed_mph: number;
  speed_basis?: "posted" | "off_peak_85th" | "anticipated";
  road_context?: "urban_low_speed" | "urban_high_speed" | "rural" | "expressway_freeway";
  lane_count?: number;
  opposing_directions?: boolean;
  lane_width_ft?: number;
  shoulder_width_ft?: number | null;
  work_length_ft: number;
  is_night?: boolean;
  sight_distance_ft?: number | null;
  adt?: number | null;
}

export interface ComputedValue {
  value: number | string;
  unit: string | null;
  formula: string | null;
  citation: {
    source_doc: string;
    source_ref: string;
    source_url: string;
    notes: string | null;
  };
}

export interface SignSpec {
  mutcd_code: string;
  name: string;
  sequence_order: number;
  purpose: string;
  required: boolean;
}

export interface RulesEngineResult {
  layout_family: string;
  rules_pack_version: string;
  sign_sequence: SignSpec[];
  spacing_A_ft: ComputedValue;
  spacing_B_ft: ComputedValue;
  spacing_C_ft: ComputedValue;
  taper_type: string;
  taper_length_ft: ComputedValue;
  downstream_taper_length_ft: ComputedValue;
  taper_device_spacing_ft: ComputedValue;
  tangent_device_spacing_ft: ComputedValue;
  buffer_length_ft: ComputedValue;
  mutcd_ssd_ft: ComputedValue;
  flagger_count: ComputedValue;
  flagger_station_notes: string[];
  cones_per_taper: ComputedValue;
  cones_tangent: ComputedValue;
  signs_count: number;
  arrow_board_required: boolean;
  arrow_board_mode: string | null;
  refused_reasons: string[];
}

export interface PlanResponse {
  id: string;
  job_id: string;
  revision: number;
  status: string;
  layout_family: string;
  rules_pack_version: string;
  required_approver_kind: string;
  disclaimer: string;
  computation: RulesEngineResult | null;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
}

export class BackendAPIError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "BackendAPIError";
    this.status = status;
    this.details = details;
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}/v1${path}`;
  
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = await response.text();
    }
    throw new BackendAPIError(
      (details as { error?: string })?.error || `Request failed: ${response.status}`,
      response.status,
      details
    );
  }

  return response.json();
}

export const backendApi = {
  auth: {
    async login(email: string, password: string) {
      return apiRequest<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },

    async register(email: string, password: string, full_name: string) {
      return apiRequest<AuthUser>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, full_name }),
      });
    },

    async logout() {
      return apiRequest<{ message: string }>("/auth/logout", {
        method: "POST",
      });
    },

    async me() {
      return apiRequest<AuthUser>("/auth/me");
    },
  },

  plans: {
    async create(
      jobId: string,
      siteFacts: SiteFactsInput,
      layoutFamily = "ottch_320_mutcd_ta10"
    ): Promise<PlanResponse> {
      return apiRequest<PlanResponse>(`/jobs/${jobId}/plans`, {
        method: "POST",
        body: JSON.stringify({
          layout_family: layoutFamily,
          site_facts: siteFacts,
        }),
      });
    },

    async get(planId: string): Promise<PlanResponse> {
      return apiRequest<PlanResponse>(`/plans/${planId}`);
    },

    async submit(planId: string) {
      return apiRequest<{ message: string; status: string }>(
        `/plans/${planId}/submit`,
        { method: "POST" }
      );
    },

    async approve(
      planId: string,
      credentialId: string,
      attestation: string,
      decision: "approved" | "rejected",
      comments?: string
    ) {
      return apiRequest<{ message: string; status: string; disclaimer: string }>(
        `/plans/${planId}/approvals`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            credential_id: credentialId,
            attestation,
            comments,
          }),
        }
      );
    },
  },
};

/**
 * Standalone function to compute rules via the backend engine.
 * Use this when you only need the computation without creating a plan.
 */
export async function computeRulesFromBackend(
  siteFacts: SiteFactsInput
): Promise<RulesEngineResult> {
  // For Phase 1, we call the plan creation endpoint
  // In future, there could be a standalone /compute endpoint
  const response = await fetch(`${API_URL}/v1/compute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site_facts: siteFacts }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new BackendAPIError(
      error.error || "Computation failed",
      response.status,
      error
    );
  }

  return response.json();
}
