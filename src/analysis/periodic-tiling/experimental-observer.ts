import type { GrayscaleRaster } from "../hex-grid/detector.js";
import { inspectDSymbol } from "../../resources/periodic-tiling/topology/d-symbol.js";
import { projectChambers } from "../../resources/periodic-tiling/topology/equivalence.js";
import { evaluateOriginalRasterTranslations } from "./original-edge-candidates.js";
import { observeMotifInteriors, type InteriorOptions } from "./motif-interiors.js";
import { deriveObservedTopology, type ObservedTopologyOptions, type ObservedBoundary } from "./observed-topology.js";
import type { ObservedPoint } from "./motif-interiors.js";
import { verifyRigidMotifFit, type RigidFitOptions } from "./global-motif-fit.js";
import { refineRigidTranslationBasis, type BasisRefinementOptions } from "./rigid-basis-refinement.js";
import { registerObservedMetric } from "./observed-metric-registration.js";
import { crossCheckMetricSymmetryWithOriginalRaster } from "./original-raster-isometry.js";
import { verifyProjectedPolygonsInOriginalRaster, type SourcePolygonProjection } from "./original-polygon-projection.js";
import { deriveInteriorMasksFromOriginalEdges, derivePeriodicallyCorroboratedInteriorMask } from "./edge-derived-interiors.js";
import { buildEdgeField, type EdgeField } from "../hex-grid/detector.js";
import type { TranslationOptions, TranslationHypothesis } from "./translations.js";
import { recoverPrimitiveObservedLattice } from "./primitive-lattice.js";

/**
 * Unreleased research pipeline: current Sobel evidence -> original-image rigid
 * translation hypotheses -> geometric regions -> reciprocal incidence -> D-symbol.
 * Unlike production v2, even a consistent result is NOT a detected pattern:
 * canonical symmetry reduction, calibrated global pixel residual, and general
 * raster support have not been established.
 */
export type ExperimentalMotifCell = {
    classId: number;
    /** Sampled white-region polygon; uncertain geometry in analysis-image pixels. */
    polygonAnalysisPixels: readonly ObservedPoint[];
    /** Derived reciprocal periodic neighbor interfaces; untrusted until acceptance. */
    boundaries: readonly ObservedBoundary[];
};

export type ExperimentalMetricEvidence = {
    status: "registered" | "inconclusive" | "unsupported";
    reason: string | null;
    maximumContourResidualPixels: number | null;
    rmsContourResidualPixels: number | null;
    originalRasterEdgeSupport: number | null;
    mathematicalMetricSymmetries: number | null;
    rasterSymmetriesChecked: number;
    rasterSymmetriesSupported: number;
    sourceProjection?: SourcePolygonProjection;
};

/** An exact polygon witness is distinct from a noisy raster geometry observation. */
export type ExperimentalMotifResult =
    | {
        status: "consistent-candidate";
        candidateDsSymbol: string;
        basis: TranslationHypothesis["basis"];
        motifCells: readonly ExperimentalMotifCell[];
        matchedHypotheses: number;
        checkedHypotheses: number;
        rejectedHypotheses: number;
        minimumEdgeObservations: number;
        originalRasterEdgeSupport: number;
        maximumRigidVertexResidualPixels: number;
        translationRefinementResidualPixels: number | null;
        metricRegistration?: ExperimentalMetricEvidence;
        segmentationProvenance?: "original-closed-line" | "original-sobel-gradient-mask";
    }
    | { status: "inconclusive" | "ambiguous"; reason: string; checkedHypotheses: number };

export function investigatePeriodicMotif(
    raster: GrayscaleRaster,
    options: {
        translation?: TranslationOptions & { maxEdgeSamples?: number };
        interiors?: InteriorOptions;
        topology?: ObservedTopologyOptions;
        globalFit?: RigidFitOptions;
        refinement?: BasisRefinementOptions;
    } = {}
): ExperimentalMotifResult {
    const translations = evaluateOriginalRasterTranslations(raster, {
        maxHypotheses: 5, ...options.translation
    });
    if (translations.status !== "candidates")
        return { status: "inconclusive", reason: translations.reason, checkedHypotheses: 0 };
    const verified: {
        symbol: string;
        hypothesisIndex: number;
        segmentationProvenance: "original-closed-line" | "original-sobel-gradient-mask";
        contourRecovered: boolean;
        basis: TranslationHypothesis["basis"];
        minimum: number;
        rasterSupport: number;
        rigidResidual: number;
        refinementResidual: number | null;
        interior: import("./motif-interiors.js").InteriorObservation;
        topology: Extract<ReturnType<typeof deriveObservedTopology>, { status: "derived" }>;
    }[] = [];
    // Report the deepest failed proof stage when no candidate can be verified.
    // This remains advisory; a partial contour or topology is never promoted.
    let deepestFailure = { stage: 0, reason: "No repeated contour observations" };
    const noteFailure = (stage: number, reason: string): void => {
        if (stage > deepestFailure.stage) deepestFailure = { stage, reason };
    };
    // Periodicity supported by the original image must not be discarded only
    // because one contour substrate cannot reconstruct individual cells.
    // Every successful branch still validates topology, rigid geometry, and
    // held-out original-image projection before reporting a candidate.
    let sharedEdgeField:EdgeField|null=null;
    let globalMasks:readonly GrayscaleRaster[]|null=null;
    const edgeField=():EdgeField=>sharedEdgeField??=buildEdgeField(raster,60_000);
    for(const [hypothesisIndex,hypothesis] of translations.hypotheses.entries()){
        const ordinary=observeMotifInteriors(raster,hypothesis.basis,options.interiors);
        const before=verified.length;
        const evaluate=(interior: import("./motif-interiors.js").InteriorObservation,
            segmentationProvenance:"original-closed-line"|"original-sobel-gradient-mask",
            contourRecovered=false):void=>{
            if(interior.status!=="observed"){
                noteFailure(1,interior.reason);
                return;
            }
            if(segmentationProvenance==="original-sobel-gradient-mask"){
                // A crop frame closes components too, but its inset is not a
                // repeated cell boundary. Withhold these border observations
                // from fitting; full-image projection still checks that area.
                interior={...interior,interiors:interior.interiors.filter(cell=>
                    cell.polygon.every(p=>p.x>8&&p.y>8&&p.x<raster.width-9&&p.y<raster.height-9))};
            }
            // All positions share the same integral lattice addresses and one
            // rigid period fit. Sobel-derived masks cannot vote as source ink.
            const refined=refineRigidTranslationBasis(interior,hypothesis.basis,options.refinement);
            const chosenBasis=refined.status==="refined"?refined.basis:hypothesis.basis;
            const topology=deriveObservedTopology(interior,chosenBasis,{
                ...options.topology,
                ...(segmentationProvenance==="original-sobel-gradient-mask"
                    && options.topology?.maxInkGapPixels === undefined
                    ? {maxInkGapPixels:12} : {})
            });
            if(topology.status!=="derived"){
                noteFailure(2,topology.reason);
                return;
            }
            // A higher contour simplification tolerance can stabilize a
            // genuinely repeated polygon but move its arbitrary first anchor.
            // Use an actual least-drift raster contour only for this retry.
            const recovered=segmentationProvenance==="original-closed-line"
                && contourRecovered;
            const globalFit=verifyRigidMotifFit(raster,interior,chosenBasis,{
                ...options.globalFit,
            });
            if(globalFit.status!=="supported"){
                noteFailure(3,globalFit.reason);
                return;
            }
            verified.push({symbol:topology.dsSymbol,hypothesisIndex,
                segmentationProvenance,contourRecovered:recovered,basis:chosenBasis,
                minimum:topology.minimumEdgeObservations,
                rasterSupport:globalFit.originalRasterEdgeSupport,
                rigidResidual:globalFit.maxVertexResidualPixels,
                refinementResidual:refined.status==="refined"?refined.residualPixels:null,
                interior,topology});

        };
        evaluate(ordinary,"original-closed-line");
        if(verified.length>before)continue;
        if(ordinary.status==="inconclusive"
            &&ordinary.reason==="Repeated cell contours disagree on junction subdivision"
            &&options.interiors?.contourTolerancePixels===undefined)
            evaluate(observeMotifInteriors(raster,hypothesis.basis,{
                ...options.interiors,contourTolerancePixels:6
            }),"original-closed-line",true);
        if(verified.length>before)continue;
        // Repair a fragmented *segmentation substrate* by corroborating
        // original source gradients at independently repeated lattice sites.
        // This shape-neutral recovery is cheaper than trying all gradient
        // thresholds when the repeated boundary is only locally interrupted.
        const periodic=derivePeriodicallyCorroboratedInteriorMask(raster,
            hypothesis.basis,{edgeField:edgeField()});
        if(periodic.status==="generated"){
            for(const mask of periodic.masks){
                evaluate(observeMotifInteriors(mask.raster,hypothesis.basis,options.interiors),
                    "original-sobel-gradient-mask");
                if(verified.length>before)break;
            }
        }else if(periodic.status==="inconclusive")noteFailure(1,periodic.reason);
        if(verified.length>before)continue;
        // Use observed original gradient contours whenever an ordinary contour
        // fails at ANY stage, not only when grayscale contrast is insufficient.
        if(globalMasks===null){
            const masks:GrayscaleRaster[]=[];
            for(const radius of [0,1]){
                const generated=deriveInteriorMasksFromOriginalEdges(raster,{
                    dilationRadius:radius,edgeField:edgeField()
                });
                if(generated.status==="generated")
                    masks.push(...generated.masks.map(m=>m.raster));
            }
            globalMasks=masks;
        }
        for(const mask of globalMasks){
            evaluate(observeMotifInteriors(mask,hypothesis.basis,options.interiors),
                "original-sobel-gradient-mask");
            if(verified.length>before)break;
        }
        if(verified.length>before)continue;
    }
    const checked = translations.hypotheses.length;
    if (verified.length === 0)
        return { status: "inconclusive",
            reason: `Automatic grid registration could not be verified. ${deepestFailure.reason}. Use manual image placement, or provide an image with clearly separated, unbroken printed boundaries and cell interiors.`,
            checkedHypotheses: checked };
    // A nonprimitive translation sublattice repeats a larger motif and has a
    // different D-symbol *presentation*. Select the smallest independently
    // reconstructed quotient only if every other complete candidate projects
    // onto it as a chamber cover. A size difference alone is not such proof.
    const sorted = [...verified].sort((a, b) => {
        const an = inspectDSymbol(a.symbol, 2048), bn = inspectDSymbol(b.symbol, 2048);
        const size = (an.status === "euclidean" ? an.symbol.chamberCount : Infinity)
             - (bn.status === "euclidean" ? bn.symbol.chamberCount : Infinity);
        // Equivalent lattice presentations can be extremely sheared. Prefer
        // the best-conditioned observed basis at equal chamber count instead
        // of arbitrary vote order, without changing any measured vector.
        const condition = (basis: typeof a.basis): number => {
            const [u,v]=basis;
            return (u.x*u.x+u.y*u.y+v.x*v.x+v.y*v.y)/Math.abs(u.x*v.y-u.y*v.x);
        };
        return size || condition(a.basis)-condition(b.basis);
    });
    let preferred = sorted[0];
    // The Sobel candidate basis may span a strict translation sublattice.
    // Test all prime-index reductions supported by the observed cells, not
    // the written D-symbol or a catalogued pattern family.
    const primitive = recoverPrimitiveObservedLattice(raster, {
        basis:preferred.basis,interior:preferred.interior,
        topology:preferred.topology,rasterSupport:preferred.rasterSupport,
        rigidResidual:preferred.rigidResidual
    }, {topology:options.topology,refinement:options.refinement,globalFit:options.globalFit});
    if (primitive.status==="ambiguous")
        return {status:"ambiguous",reason:primitive.reason,checkedHypotheses:checked};
    if (primitive.reductions) {
        const candidate=primitive.candidate;
        preferred={...preferred,symbol:candidate.topology.dsSymbol,
            basis:candidate.basis,interior:candidate.interior,topology:candidate.topology,
            rasterSupport:candidate.rasterSupport,rigidResidual:candidate.rigidResidual};
    }
    const base = inspectDSymbol(preferred.symbol, 2048);
    if (base.status !== "euclidean")
        return { status: "inconclusive", reason: "The minimal candidate is not a valid Euclidean D-symbol", checkedHypotheses: checked };
    for (const candidate of sorted) {
        if (candidate.symbol === preferred.symbol) continue;
        const symbol = inspectDSymbol(candidate.symbol, 2048);
        if (symbol.status !== "euclidean" || !projectChambers(symbol.symbol, base.symbol))
            return { status: "ambiguous", reason: "Complete motif hypotheses are not proven covers of one common observed quotient", checkedHypotheses: checked };
    }
    // Independently try to obtain a complete *metric* realization from
    // original raster contours. This is bounded research evidence only:
    // an inconclusive metric fit MUST NOT turn a valid topology observation
    // into a false authoritative result or silently alter its D-symbol.
    // A six-pixel source-contour simplification and three-pixel line stroke
    // have a geometric corner uncertainty below sqrt(6²+3²) + rounding.
    // Allow a seven-pixel bound only for this measured contour-recovery path;
    // original image projection and independent metric closure remain mandatory.
    // A Sobel/dilation contour can be inset five pixels along BOTH incident
    // sides: its corner uncertainty is ceil(sqrt(5²+5²)) = 8px. This is not
    // the permitted final overlay error; whole-image source projection below
    // retains its original 3px ink search and all regional support thresholds.
    const geometry = registerObservedMetric(raster, preferred.interior, preferred.topology,
        preferred.basis, preferred.segmentationProvenance==="original-sobel-gradient-mask"
            ? {maximumContourResidualPixels:8}
            : preferred.contourRecovered ? {maximumContourResidualPixels:7} : {});
    const crossCheck = geometry.status === "registered"
        ? crossCheckMetricSymmetryWithOriginalRaster(raster, geometry.cover)
        : null;
    const sourceProjection: SourcePolygonProjection = geometry.status === "registered"
        ? verifyProjectedPolygonsInOriginalRaster(raster, geometry.cover)
        : {status:"inconclusive",reason:"An exact image-registered polygon witness is required"};
    const metricRegistration: ExperimentalMetricEvidence = {
        status: geometry.status,
        reason: geometry.status === "registered" ? null : geometry.reason,
        maximumContourResidualPixels: geometry.status === "registered"
            ? geometry.maximumContourResidualPixels : null,
        rmsContourResidualPixels: geometry.status === "registered"
            ? geometry.rmsContourResidualPixels : null,
        originalRasterEdgeSupport: geometry.status === "registered"
            ? geometry.originalRasterEdgeSupport : null,
        mathematicalMetricSymmetries: crossCheck?.status === "evaluated"
            ? crossCheck.metricSymmetries : null,
        rasterSymmetriesChecked: crossCheck?.status === "evaluated"
            ? crossCheck.checkedNontrivialSymmetries : 0,
        rasterSymmetriesSupported: crossCheck?.status === "evaluated"
            ? crossCheck.supportedNontrivialSymmetries : 0,
        sourceProjection
    };
    // A topology-only observation is not a complete qualified raster result.
    // The candidate contract requires a jointly registered metric and a
    // separately supported projection back onto the unchanged source image.
    // Returning an identity without either proof would let clients mistake
    // a plausible chamber graph for a fully evidenced image observation.
    if (geometry.status !== "registered" || sourceProjection.status !== "supported")
        return {
            status: "inconclusive",
            reason: geometry.status !== "registered"
                ? `Incomplete metric witness: ${geometry.reason}`
                : `Incomplete source polygon projection: ${sourceProjection.status === "supported" ? "Proof unavailable" : sourceProjection.reason}`,
            checkedHypotheses: checked
        };
    // A candidate MUST publish the exact same jointly fitted polygon cover
    // independently checked against the unchanged raster. Previously the
    // output used the FIRST noisy interior contour of each motif class, while
    // metric registration and full-image projection proved a DIFFERENT,
    // normalized shared-vertex cover. That inconsistency can produce a preview
    // shifted by several pixels even when the evidence says "registered".
    //
    // The validated cover also derives its own reciprocal boundary lattice
    // offsets after normalizing each motif class's integer periodic origin.
    // Never combine fitted polygons with offsets from the prefit observation.
    const metricCells:ExperimentalMotifCell[]=[];
    const byId=new Map(geometry.cover.cells.map(cell=>[cell.id,cell]));
    for(const cell of geometry.cover.cells){
        if(!/^observed-(0|[1-9][0-9]*)$/.test(cell.id))
            return {status:"inconclusive",
                reason:"Metric registration returned an unrecognized observed cell identity",
                checkedHypotheses:checked};
        const classId=Number(cell.id.slice("observed-".length));
        const sourceCell=preferred.topology.cells[classId];
        // The published v3 polygon contract allows one atomic interface per
        // vertex-to-vertex side. Never silently discard a subdivided interface.
        if(!sourceCell||sourceCell.classId!==classId
            ||cell.boundary.length!==cell.polygon.length
            ||cell.boundary.some((edge,i)=>edge.edgeIndex!==i||edge.sideIndex!==i))
            return {status:"inconclusive",
                reason:"Verified polygon interfaces cannot be represented as one boundary per side",
                checkedHypotheses:checked};
        const boundaries:ObservedBoundary[]=[];
        for(const edge of cell.boundary){
            const target=byId.get(edge.target.motifCell);
            const reciprocal=target?.boundary[edge.reciprocalEdgeIndex];
            if(!target||!reciprocal
                ||!/^observed-(0|[1-9][0-9]*)$/.test(target.id)
                ||reciprocal.edgeIndex!==reciprocal.sideIndex
                ||reciprocal.target.motifCell!==cell.id
                ||reciprocal.reciprocalEdgeIndex!==edge.edgeIndex)
                return {status:"inconclusive",
                    reason:"Verified metric cover has an unrepresentable reciprocal interface",
                    checkedHypotheses:checked};
            boundaries.push({
                sideIndex:edge.sideIndex,
                targetClass:Number(target.id.slice("observed-".length)),
                targetSide:reciprocal.sideIndex,
                translation:edge.target.lattice,
                supportingObservations:sourceCell.boundaries[edge.sideIndex]?.supportingObservations??0
            });
        }
        metricCells.push({
            classId,polygonAnalysisPixels:cell.polygon,boundaries
        });
    }
    if(metricCells.length!==preferred.topology.cells.length)
        return {status:"inconclusive",
            reason:"Verified metric cover omitted an observed motif class",
            checkedHypotheses:checked};
    // Retain an observed minimal presentation, never assert that the absolute
    // maximal symmetry quotient was reconstructed from this evidence alone.
    return {
        status: "consistent-candidate",
        candidateDsSymbol: preferred.symbol,
        basis: preferred.basis,
        motifCells: metricCells,
        matchedHypotheses: new Set(verified.map(h=>h.hypothesisIndex)).size,
        checkedHypotheses: checked,
        rejectedHypotheses: checked - new Set(verified.map(h=>h.hypothesisIndex)).size,
        minimumEdgeObservations: Math.min(...verified.map(h => h.minimum)),
        originalRasterEdgeSupport: preferred.rasterSupport,
        maximumRigidVertexResidualPixels: preferred.rigidResidual,
        translationRefinementResidualPixels: preferred.refinementResidual,
        segmentationProvenance: preferred.segmentationProvenance,
        metricRegistration
    };
}
