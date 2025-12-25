import { z } from "zod";

export const geometryTypeSchema = z.union([
  z.literal("bbox"),
  z.literal("polygon"),
]);

export type GeometryType = z.infer<typeof geometryTypeSchema>;

// Coordinate pair [lng, lat]
const coordinateSchema = z.array(z.number()).length(2);

// Bbox [west, south, east, north]
const bboxSchema = z.array(z.number()).length(4);

export const tcpGeometrySchema = z.object({
  type: geometryTypeSchema,
  bbox: bboxSchema.optional(),
  polygon: z
    .array(z.array(coordinateSchema))
    .optional(), // single unclosed ring: [ [ [lng,lat], ... ] ]
});

// Re-export compatible types for external use
export type Bbox = [number, number, number, number];
export type Coordinate = [number, number];
export type PolygonRing = Coordinate[];
export type TcpGeometry = {
  type: "bbox" | "polygon";
  bbox?: Bbox;
  polygon?: PolygonRing[];
};

// Job Owner schema (company/contractor information)
export const jobOwnerSchema = z.object({
  companyName: z.string(),
  contractorName: z.string(),
  phone: z.string(),
  jobNumber: z.string().optional(),
  jobAssignedDate: z.string().optional(), // ISO format: yyyy-mm-dd
});

export type JobOwner = z.infer<typeof jobOwnerSchema>;

export const tcpDraftRequestSchema = z.object({
  geometry: tcpGeometrySchema,
  locationLabel: z.string().optional(),
  roadType: z.union([
    z.literal("2_lane_undivided"),
    z.literal("multilane_divided"),
    z.literal("intersection"),
  ]),
  postedSpeedMph: z.number(),
  workType: z.union([
    z.literal("shoulder_work"),
    z.literal("lane_closure"),
    z.literal("one_lane_two_way_flaggers"),
  ]),
  workLengthFt: z.number(),
  isNight: z.boolean(),
  notes: z.string().optional(),
  jobOwner: jobOwnerSchema.optional(), // Company/contractor info
});

export type TcpDraftRequest = z.infer<typeof tcpDraftRequestSchema>;

export const signSpacingSchema = z.object({
  label: z.union([z.literal("A"), z.literal("B"), z.literal("C")]),
  distanceFt: z.number(),
});

export const devicesSchema = z.object({
  cones: z.number(),
  signs: z.number(),
  arrowBoard: z.boolean(),
  flaggers: z.number(),
});

export const tcpPlanSchema = z.object({
  recommendedLayout: z.string(),
  signSpacing: z.array(signSpacingSchema),
  taperLengthFt: z.number(),
  bufferLengthFt: z.number(),
  devices: devicesSchema,
});

// Coverage Gate: Tracks which critical handbook categories were found
export const coverageCitationSchema = z.object({
  category: z.enum(["spacing", "taper", "buffer", "devices"]),
  docName: z.string(),
  page: z.number().optional(),
  snippet: z.string().optional(),
});

export const coverageInfoSchema = z.object({
  spacing: z.boolean(),
  taper: z.boolean(),
  buffer: z.boolean(),
  devices: z.boolean(),
  citations: z.array(coverageCitationSchema),
});

export type CoverageCitation = z.infer<typeof coverageCitationSchema>;
export type CoverageInfo = z.infer<typeof coverageInfoSchema>;

export const tcpDraftResponseSchema = z.object({
  summary: z.string(),
  plan: tcpPlanSchema,
  assumptions: z.array(z.string()),
  references: z.array(z.string()),
  svgContent: z.string(),
  coverage: coverageInfoSchema.optional(), // Added for UI confidence display
});

export type SignSpacing = z.infer<typeof signSpacingSchema>;
export type Devices = z.infer<typeof devicesSchema>;
export type TcpPlan = z.infer<typeof tcpPlanSchema>;
export type TcpDraftResponse = z.infer<typeof tcpDraftResponseSchema>;

// Coverage gate error response type
export interface CoverageGateError {
  error: "Missing handbook guidance";
  details: {
    missing: ("spacing" | "taper" | "buffer")[];
    coverage: CoverageInfo;
  };
}

export const MAX_SVG_LENGTH = 50_000;


