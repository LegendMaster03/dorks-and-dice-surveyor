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
import { deriveInteriorMasksFromOriginalEdges } from "./edge-derived-interiors.js";
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
        basis: TranslationHypothesis["basis"];
        minimum: number;
        rasterSupport: number;
        rigidResidual: number;
        refinementResidual: number | null;
        motifCells: readonly ExperimentalMotifCell[];
        interior: import("./motif-interiors.js").InteriorObservation;
        topology: Extract<ReturnType<typeof deriveObservedTopology>, { status: "derived" }>;
    }[] = [];
    // Source-image gradient contours are only a segmentation FALLBACK when
    // the older white-interior probe cannot operate on multitone cells.
    // The existing Sobel/translation detector and unchanged-raster metric
    // verification remain the only sources of periodicity and image support.
    let fallbackMasks: readonly GrayscaleRaster[] | null = null;
    for (const [hypothesisIndex,hypothesis] of translations.hypotheses.entries()) {
        const ordinary=observeMotifInteriors(raster,hypothesis.basis,options.interiors);
        const observations: {
            interior: import("./motif-interiors.js").InteriorObservation;
            segmentationProvenance: "original-closed-line" | "original-sobel-gradient-mask";
        }[]=[{interior:ordinary,segmentationProvenance:"original-closed-line"}];
        if(ordinary.status==="inconclusive"
            &&ordinary.reason.includes("not a sufficiently high-contrast closed-line raster")){
            if(fallbackMasks===null){
                const masks:GrayscaleRaster[]=[];
                for(const radius of [0,1]){
                    const generated=deriveInteriorMasksFromOriginalEdges(raster,{dilationRadius:radius});
                    if(generated.status==="generated")
                        masks.push(...generated.masks.map(m=>m.raster));
                }
                fallbackMasks=masks;
            }
            for(const mask of fallbackMasks)
                observations.push({
                    interior:observeMotifInteriors(mask,hypothesis.basis,options.interiors),
                    segmentationProvenance:"original-sobel-gradient-mask"
                });
        }
        for(const observed of observations){
            const {interior,segmentationProvenance}=observed;
            if(interior.status!=="observed")continue;
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
            if(topology.status!=="derived")continue;
            const globalFit=verifyRigidMotifFit(raster,interior,chosenBasis,options.globalFit);
            if(globalFit.status!=="supported")continue;
            const motifCells:ExperimentalMotifCell[]=topology.cells.map(cell=>({
                classId:cell.classId,
                polygonAnalysisPixels:interior.interiors.find(example=>example.motifClass===cell.classId)!.polygon,
                boundaries:cell.boundaries
            }));
            verified.push({symbol:topology.dsSymbol,hypothesisIndex,
                segmentationProvenance,basis:chosenBasis,motifCells,
                minimum:topology.minimumEdgeObservations,
                rasterSupport:globalFit.originalRasterEdgeSupport,
                rigidResidual:globalFit.maxVertexResidualPixels,
                refinementResidual:refined.status==="refined"?refined.residualPixels:null,
                interior,topology});
        }
    }
    const checked = translations.hypotheses.length;
    if (verified.length === 0)
        return { status: "inconclusive", reason: "No translation candidate reconstructed a complete reciprocal chamber graph", checkedHypotheses: checked };
    // A nonprimitive translation sublattice repeats a larger motif and has a
    // different D-symbol *presentation*. Select the smallest independently
    // reconstructed quotient only if every other complete candidate projects
    // onto it as a chamber cover. A size difference alone is not such proof.
    const sorted = [...verified].sort((a, b) => {
        const an = inspectDSymbol(a.symbol, 2048), bn = inspectDSymbol(b.symbol, 2048);
        return (an.status === "euclidean" ? an.symbol.chamberCount : Infinity)
             - (bn.status === "euclidean" ? bn.symbol.chamberCount : Infinity);
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
            rasterSupport:candidate.rasterSupport,rigidResidual:candidate.rigidResidual,
            motifCells:candidate.topology.cells.map(cell=>({
                classId:cell.classId,
                polygonAnalysisPixels:candidate.interior.interiors.find(example=>
                    example.motifClass===cell.classId)!.polygon,
                boundaries:cell.boundaries
            }))};
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
    const geometry = registerObservedMetric(raster, preferred.interior, preferred.topology, preferred.basis);
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
    // Retain an observed minimal presentation, never assert that the absolute
    // maximal symmetry quotient was reconstructed from this evidence alone.
    return {
        status: "consistent-candidate",
        candidateDsSymbol: preferred.symbol,
        basis: preferred.basis,
        motifCells: preferred.motifCells,
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
