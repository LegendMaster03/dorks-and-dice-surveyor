import type { HexLatticeFit } from "./analysis/hex-grid/detector.js";
import type {
    RegularLatticeDetectionOptions,
    RegularLatticeFit
} from "./analysis/regular-tiling/detector.js";

export const SurveyorApiVersion = "v2" as const;
export const PeriodicTilingDetectionCapability = "map.periodic-tiling.detect" as const;
export const PeriodicMotifInvestigationCapability = "map.periodic-tiling.investigate" as const;
export const PeriodicMotifInvestigationApiVersion = "v3" as const;
export const SupportedRasterMediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export type SupportedRasterMediaType = typeof SupportedRasterMediaTypes[number];
export type PeriodicTilingDetectionStatus = "detected" | "inconclusive" | "gridless";

export type PublicPeriodicTilingDetectionOptions = Pick<
    RegularLatticeDetectionOptions,
    "minimumSpacingPixels" | "maximumSpacingPixels" | "maximumEdgeSamples" | "minimumConfidence">;

export type PeriodicTilingIdentity = {
    dsSymbol: string;
};

export type SurveyorPeriodicTilingAnalysis = {
    apiVersion: typeof SurveyorApiVersion;
    capability: typeof PeriodicTilingDetectionCapability;
    tiling: PeriodicTilingIdentity | null;
    status: PeriodicTilingDetectionStatus;
    reason: string;
    source: {
        width: number;
        height: number;
        mediaType: SupportedRasterMediaType;
    };
    analysis: {
        width: number;
        height: number;
        scale: number;
        sourceResolutionVerified: boolean;
    };
    fit: RegularLatticeFit | null;
    timing: SurveyorTiming;
};

export type SurveyorTiming = {
    decodeMs: number;
    preparationMs: number;
    grayscaleMs: number;
    edgeFieldMs: number;
    detectorMs: number;
    totalMs: number;
};

export type SurveyorErrorResponse = {
    apiVersion: typeof SurveyorApiVersion | typeof PeriodicMotifInvestigationApiVersion;
    capability: string;
    error: {
        code: string;
        message: string;
    };
};

// Transitional aliases preserve source compatibility for callers that still use the
// pre-resource hex-grid names. The legacy analysis alias deliberately keeps the old
// exact hex identity and HexLatticeFit rather than widening to the generalized fit.
export type PublicHexGridDetectionOptions = PublicPeriodicTilingDetectionOptions;
export type SurveyorHexGridAnalysis = Omit<SurveyorPeriodicTilingAnalysis, "tiling" | "fit"> & {
    tiling: { dsSymbol: "<1:1,1,1:6,3>" } | null;
    fit: HexLatticeFit | null;
};

/**
 * Non-authoritative research contract. Never use a candidate as a detected or
 * accepted world tiling. All dimensional measurements refer to source pixels.
 */
export type SurveyorPeriodicMotifInvestigation = {
    apiVersion: typeof PeriodicMotifInvestigationApiVersion;
    capability: typeof PeriodicMotifInvestigationCapability;
    maturity: "experimental";
    authoritative: false;
    status: "consistent-candidate" | "inconclusive" | "ambiguous";
    reason: string;
    candidate: null | {
        dsSymbol: string;
        translationBasisSourcePixels: [
            { x: number; y: number }, { x: number; y: number }
        ];
        /** Provisional observations, not canonical cells or trusted world IDs. */
        motifCells: {
            provisionalId: string;
            polygonSourcePixels: { x: number; y: number }[];
            boundaries: {
                sideIndex: number;
                targetProvisionalId: string;
                targetSideIndex: number;
                translation: { u: number; v: number };
                supportingObservations: number;
            }[];
        }[];
    };
    evidence: null | {
        matchedHypotheses: number;
        checkedHypotheses: number;
        rejectedHypotheses: number;
        minimumEdgeObservations: number;
        originalRasterEdgeSupport: number;
        maximumRigidVertexResidualSourcePixels: number;
        translationRefinementResidualSourcePixels: number | null;
        /** Independently fitted polygon evidence; never an accepted world geometry. */
        metricRegistration?: {
            status: "registered" | "inconclusive" | "unsupported";
            reason: string | null;
            maximumContourResidualSourcePixels: number | null;
            rmsContourResidualSourcePixels: number | null;
            originalRasterEdgeSupport: number | null;
            /** Mathematical symmetry alone never implies original-image evidence. */
            mathematicalMetricSymmetries: number | null;
            rasterSymmetriesChecked: number;
            rasterSymmetriesSupported: number;
            /** Held-out whole-image projected geometry, separate from contour fitting. */
            sourceProjection?: {
                status: "supported" | "inconclusive" | "unsupported";
                reason: string | null;
                edgeSupport: number | null;
                interiorSupport: number | null;
                checkedRegions: number | null;
                supportedRegions: number | null;
            };
        };
    };
    source: {
        width: number;
        height: number;
        mediaType: SupportedRasterMediaType;
    };
    analysis: {
        width: number;
        height: number;
        scale: number;
        sourceResolutionVerified: boolean;
    };
    timing: Pick<SurveyorTiming, "decodeMs" | "preparationMs" | "grayscaleMs" | "detectorMs" | "totalMs">;
};
