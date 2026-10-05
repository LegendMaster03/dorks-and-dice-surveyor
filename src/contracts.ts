import type { HexLatticeFit } from "./analysis/hex-grid/detector.js";
import type {
    RegularLatticeDetectionOptions,
    RegularLatticeFit
} from "./analysis/regular-tiling/detector.js";
import type { PeriodicTilingType } from "./resources/periodic-tiling/types.js";

export const SurveyorApiVersion = "v1" as const;
export const PeriodicTilingDetectionCapability = "map.periodic-tiling.detect" as const;
export const SupportedRasterMediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export type SupportedRasterMediaType = typeof SupportedRasterMediaTypes[number];
export type PeriodicTilingDetectionStatus = "detected" | "inconclusive" | "gridless";

export type PublicPeriodicTilingDetectionOptions = Pick<
    RegularLatticeDetectionOptions,
    "minimumSpacingPixels" | "maximumSpacingPixels" | "maximumEdgeSamples" | "minimumConfidence">;

export type PeriodicTilingIdentity = {
    periodicTilingType: PeriodicTilingType;
    crNotation: string;
    gjhNotation: string;
};

export type SurveyorPeriodicTilingAnalysis = {
    apiVersion: typeof SurveyorApiVersion;
    capability: typeof PeriodicTilingDetectionCapability;
    tiling: PeriodicTilingIdentity;
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
    apiVersion: typeof SurveyorApiVersion;
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
    tiling: {
        periodicTilingType: "Regular";
        crNotation: "6^3";
        gjhNotation: "6/m30/r(h1)";
    };
    fit: HexLatticeFit | null;
};
