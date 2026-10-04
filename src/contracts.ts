import type { HexLatticeDetectionOptions, HexLatticeFit } from "./analysis/hex-grid/detector.js";

export const SurveyorApiVersion = "v1" as const;
export const HexGridDetectionCapability = "map.hex-grid.detect" as const;
export const SupportedRasterMediaTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export type SupportedRasterMediaType = typeof SupportedRasterMediaTypes[number];
export type HexGridDetectionStatus = "detected" | "inconclusive" | "gridless";

export type PublicHexGridDetectionOptions = Pick<
    HexLatticeDetectionOptions,
    "minimumSpacingPixels" | "maximumSpacingPixels" | "maximumEdgeSamples" | "minimumConfidence">;

export type SurveyorHexGridAnalysis = {
    apiVersion: typeof SurveyorApiVersion;
    capability: typeof HexGridDetectionCapability;
    status: HexGridDetectionStatus;
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
    fit: HexLatticeFit | null;
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
    capability: typeof HexGridDetectionCapability;
    error: {
        code: string;
        message: string;
    };
};
