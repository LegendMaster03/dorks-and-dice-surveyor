import assert from "node:assert/strict";
import test from "node:test";
import type { ExperimentalMotifResult } from "../src/analysis/periodic-tiling/experimental-observer.js";
import { mapExperimentalMotifToSource } from "../src/resources/periodic-tiling/source-candidate.js";

test("candidate motif geometry and reciprocal interface references use source pixels", () => {
    const sample: Extract<ExperimentalMotifResult, { status: "consistent-candidate" }> = {
        status: "consistent-candidate",
        candidateDsSymbol: "<1:1,1,1:4,4>",
        basis: [{ x: 20, y: 0 }, { x: 0, y: 20 }],
        motifCells: [
            {
                classId: 0,
                polygonAnalysisPixels: [{ x: 4, y: 6 }, { x: 14, y: 6 }, { x: 14, y: 16 }, { x: 4, y: 16 }],
                boundaries: [{ sideIndex: 0, targetClass: 1, targetSide: 2,
                    translation: [1, -1], supportingObservations: 8 }]
            },
            {
                classId: 1,
                polygonAnalysisPixels: [{ x: 24, y: 6 }, { x: 34, y: 6 }, { x: 34, y: 16 }, { x: 24, y: 16 }],
                boundaries: [{ sideIndex: 2, targetClass: 0, targetSide: 0,
                    translation: [-1, 1], supportingObservations: 9 }]
            }
        ],
        matchedHypotheses: 1, checkedHypotheses: 3, rejectedHypotheses: 2,
        minimumEdgeObservations: 8, originalRasterEdgeSupport: 0.92,
        maximumRigidVertexResidualPixels: 2.5,
        translationRefinementResidualPixels: 1.25,
        metricRegistration: {
            status: "registered", reason: null,
            maximumContourResidualPixels: 3, rmsContourResidualPixels: 1.5,
            originalRasterEdgeSupport: 0.96,
            mathematicalMetricSymmetries: 4,
            rasterSymmetriesChecked: 3, rasterSymmetriesSupported: 2
        }
    };
    const { candidate, evidence } = mapExperimentalMotifToSource(sample, 0.5);
    assert.deepEqual(candidate.translationBasisSourcePixels, [{ x: 40, y: 0 }, { x: 0, y: 40 }]);
    assert.deepEqual(candidate.motifCells.map(c => c.provisionalId), ["candidate-0", "candidate-1"]);
    assert.deepEqual(candidate.motifCells[0].polygonSourcePixels[0], { x: 8, y: 12 });
    assert.deepEqual(candidate.motifCells[0].boundaries[0], {
        sideIndex: 0, targetProvisionalId: "candidate-1",
        targetSideIndex: 2, translation: { u: 1, v: -1 }, supportingObservations: 8
    });
    assert.deepEqual(candidate.motifCells[1].boundaries[0].translation, { u: -1, v: 1 });
    assert.equal(evidence.maximumRigidVertexResidualSourcePixels, 5);
    assert.equal(evidence.translationRefinementResidualSourcePixels, 2.5);
    assert.equal(evidence.originalRasterEdgeSupport, 0.92);
});
test("mapping rejects invalid scale to prevent deceptive coordinate claims", () => {
    const sample: Extract<ExperimentalMotifResult, { status: "consistent-candidate" }> = {
        status: "consistent-candidate", candidateDsSymbol: "x",
        basis: [{ x: 1, y: 0 }, { x: 0, y: 1 }], motifCells: [],
        matchedHypotheses: 1, checkedHypotheses: 1, rejectedHypotheses: 0,
        minimumEdgeObservations: 1, originalRasterEdgeSupport: 0.9,
        maximumRigidVertexResidualPixels: 0.5, translationRefinementResidualPixels: null
    };
    assert.throws(() => mapExperimentalMotifToSource(sample, 0), /Invalid image analysis scale/);
    assert.throws(() => mapExperimentalMotifToSource(sample, 1.01), /Invalid image analysis scale/);
});
