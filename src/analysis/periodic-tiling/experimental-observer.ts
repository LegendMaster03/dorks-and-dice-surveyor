import type { GrayscaleRaster } from "../hex-grid/detector.js";
import { inspectDSymbol } from "../../resources/periodic-tiling/topology/d-symbol.js";
import { projectChambers } from "../../resources/periodic-tiling/topology/equivalence.js";
import { evaluateOriginalRasterTranslations } from "./original-edge-candidates.js";
import { observeMotifInteriors, type InteriorOptions } from "./motif-interiors.js";
import { deriveObservedTopology, type ObservedTopologyOptions } from "./observed-topology.js";
import { verifyRigidMotifFit, type RigidFitOptions } from "./global-motif-fit.js";
import type { TranslationOptions, TranslationHypothesis } from "./translations.js";

/**
 * Unreleased research pipeline: current Sobel evidence -> original-image rigid
 * translation hypotheses -> geometric regions -> reciprocal incidence -> D-symbol.
 * Unlike production v2, even a consistent result is NOT a detected pattern:
 * canonical symmetry reduction, calibrated global pixel residual, and general
 * raster support have not been established.
 */
export type ExperimentalMotifResult =
    | {
        status: "consistent-candidate";
        candidateDsSymbol: string;
        basis: TranslationHypothesis["basis"];
        matchedHypotheses: number;
        checkedHypotheses: number;
        rejectedHypotheses: number;
        minimumEdgeObservations: number;
        originalRasterEdgeSupport: number;
        maximumRigidVertexResidualPixels: number;
    }
    | { status: "inconclusive" | "ambiguous"; reason: string; checkedHypotheses: number };

export function investigatePeriodicMotif(
    raster: GrayscaleRaster,
    options: {
        translation?: TranslationOptions & { maxEdgeSamples?: number };
        interiors?: InteriorOptions;
        topology?: ObservedTopologyOptions;
        globalFit?: RigidFitOptions;
    } = {}
): ExperimentalMotifResult {
    const translations = evaluateOriginalRasterTranslations(raster, {
        maxHypotheses: 5, ...options.translation
    });
    if (translations.status !== "candidates")
        return { status: "inconclusive", reason: translations.reason, checkedHypotheses: 0 };
    const verified: {
        symbol: string;
        basis: TranslationHypothesis["basis"];
        minimum: number;
        rasterSupport: number;
        rigidResidual: number;
    }[] = [];
    for (const hypothesis of translations.hypotheses) {
        const interior = observeMotifInteriors(raster, hypothesis.basis, options.interiors);
        if (interior.status !== "observed") continue;
        const topology = deriveObservedTopology(interior, hypothesis.basis, options.topology);
        if (topology.status !== "derived") continue;
        const globalFit = verifyRigidMotifFit(raster, interior, hypothesis.basis, options.globalFit);
        if (globalFit.status !== "supported") continue;
        verified.push({ symbol: topology.dsSymbol, basis: hypothesis.basis,
            minimum: topology.minimumEdgeObservations,
            rasterSupport: globalFit.originalRasterEdgeSupport,
            rigidResidual: globalFit.maxVertexResidualPixels });
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
    const preferred = sorted[0];
    const base = inspectDSymbol(preferred.symbol, 2048);
    if (base.status !== "euclidean")
        return { status: "inconclusive", reason: "The minimal candidate is not a valid Euclidean D-symbol", checkedHypotheses: checked };
    for (const candidate of sorted) {
        if (candidate.symbol === preferred.symbol) continue;
        const symbol = inspectDSymbol(candidate.symbol, 2048);
        if (symbol.status !== "euclidean" || !projectChambers(symbol.symbol, base.symbol))
            return { status: "ambiguous", reason: "Complete motif hypotheses are not proven covers of one common observed quotient", checkedHypotheses: checked };
    }
    // Retain an observed minimal presentation, never assert that the absolute
    // maximal symmetry quotient was reconstructed from this evidence alone.
    return {
        status: "consistent-candidate",
        candidateDsSymbol: preferred.symbol,
        basis: preferred.basis,
        matchedHypotheses: verified.length,
        checkedHypotheses: checked,
        rejectedHypotheses: checked - verified.length,
        minimumEdgeObservations: Math.min(...verified.map(h => h.minimum)),
        originalRasterEdgeSupport: preferred.rasterSupport,
        maximumRigidVertexResidualPixels: preferred.rigidResidual
    };
}
