import assert from "node:assert/strict";
import test from "node:test";
import type {
    SurveyorHexGridAnalysis,
    SurveyorPeriodicTilingAnalysis
} from "../src/contracts.js";

test("legacy SurveyorHexGridAnalysis preserves the pre-generalization hex fit contract", () => {
    const legacy: SurveyorHexGridAnalysis = {
        apiVersion: "v1",
        capability: "map.periodic-tiling.detect",
        tiling: {
            periodicTilingType: "Regular",
            crNotation: "6^3",
            gjhNotation: "6/m30/r(h1)"
        },
        status: "detected",
        reason: "fixture",
        source: { width: 100, height: 80, mediaType: "image/png" },
        analysis: { width: 100, height: 80, scale: 1, sourceResolutionVerified: true },
        fit: {
            orientation: "PointyTop",
            rotationDegrees: 0,
            centerSpacingPixels: 40,
            anchorPixel: { x: 10, y: 12 },
            confidence: 0.9,
            residualPixels: 0.5,
            supportCoverage: 0.7,
            orientationSupport: 0.8,
            translationScore: 0.85,
            competingTranslationScore: 0.1,
            linePeriodicityScore: 0.82,
            phaseScore: 0.75
        },
        timing: {
            decodeMs: 1,
            preparationMs: 1,
            grayscaleMs: 1,
            edgeFieldMs: 2,
            detectorMs: 4,
            totalMs: 9
        }
    };

    assert.equal(legacy.fit?.orientation, "PointyTop");
    assert.equal(legacy.fit?.centerSpacingPixels, 40);
});

test("generalized periodic analysis exposes geometry-neutral Regular fit fields", () => {
    const generalized: SurveyorPeriodicTilingAnalysis = {
        apiVersion: "v1",
        capability: "map.periodic-tiling.detect",
        tiling: {
            periodicTilingType: "Regular",
            crNotation: "4^4",
            gjhNotation: "4/m45/r(h1)"
        },
        status: "detected",
        reason: "fixture",
        source: { width: 100, height: 80, mediaType: "image/png" },
        analysis: { width: 100, height: 80, scale: 1, sourceResolutionVerified: true },
        fit: {
            geometryId: "regular.square",
            rotationDegrees: 3,
            edgeLengthPixels: 24,
            anchorPixel: { x: 8, y: 11 },
            confidence: 0.8,
            residualPixels: 0.75,
            supportCoverage: 0.6,
            orientationSupport: 0.7,
            translationScore: 0.72,
            competingTranslationScore: 0.12,
            linePeriodicityScore: 0.77,
            phaseScore: 0.68
        },
        timing: {
            decodeMs: 1,
            preparationMs: 1,
            grayscaleMs: 1,
            edgeFieldMs: 2,
            detectorMs: 4,
            totalMs: 9
        }
    };

    assert.equal(generalized.fit?.geometryId, "regular.square");
    assert.equal(generalized.fit?.edgeLengthPixels, 24);
});
