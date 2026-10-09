import type { ExperimentalMotifResult } from "../../analysis/periodic-tiling/experimental-observer.js";
import type { SurveyorPeriodicMotifInvestigation } from "../../contracts.js";

type Candidate = NonNullable<SurveyorPeriodicMotifInvestigation["candidate"]>;
type Evidence = NonNullable<SurveyorPeriodicMotifInvestigation["evidence"]>;

/** Convert analysis pixel measurements back to source-image pixel coordinates. */
export function mapExperimentalMotifToSource(
    observation: Extract<ExperimentalMotifResult, { status: "consistent-candidate" }>,
    analysisScale: number
): { candidate: Candidate; evidence: Evidence } {
    if (!Number.isFinite(analysisScale) || analysisScale <= 0 || analysisScale > 1)
        throw new Error("Invalid image analysis scale.");
    const point = (p: { x: number; y: number }) => ({
        x: p.x / analysisScale, y: p.y / analysisScale
    });
    const candidate: Candidate = {
        dsSymbol: observation.candidateDsSymbol,
        translationBasisSourcePixels: [
            point(observation.basis[0]), point(observation.basis[1])
        ],
        motifCells: observation.motifCells.map(cell => ({
            provisionalId: `candidate-${cell.classId}`,
            polygonSourcePixels: cell.polygonAnalysisPixels.map(point),
            boundaries: cell.boundaries.map(edge => ({
                sideIndex: edge.sideIndex,
                targetProvisionalId: `candidate-${edge.targetClass}`,
                targetSideIndex: edge.targetSide,
                translation: { u: edge.translation[0], v: edge.translation[1] },
                supportingObservations: edge.supportingObservations
            }))
        }))
    };
    const evidence: Evidence = {
        matchedHypotheses: observation.matchedHypotheses,
        checkedHypotheses: observation.checkedHypotheses,
        rejectedHypotheses: observation.rejectedHypotheses,
        minimumEdgeObservations: observation.minimumEdgeObservations,
        originalRasterEdgeSupport: observation.originalRasterEdgeSupport,
        maximumRigidVertexResidualSourcePixels:
            observation.maximumRigidVertexResidualPixels / analysisScale,
        translationRefinementResidualSourcePixels:
            observation.translationRefinementResidualPixels == null ? null
                : observation.translationRefinementResidualPixels / analysisScale
    };
    return { candidate, evidence };
}
