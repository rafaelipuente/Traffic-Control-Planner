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

export const tcpDraftResponseSchema = z.object({
  summary: z.string(),
  plan: tcpPlanSchema,
  assumptions: z.array(z.string()),
  references: z.array(z.string()),
  svgContent: z.string(),
});

export type SignSpacing = z.infer<typeof signSpacingSchema>;
export type Devices = z.infer<typeof devicesSchema>;
export type TcpPlan = z.infer<typeof tcpPlanSchema>;
export type TcpDraftResponse = z.infer<typeof tcpDraftResponseSchema>;

export const MAX_SVG_LENGTH = 50_000;


