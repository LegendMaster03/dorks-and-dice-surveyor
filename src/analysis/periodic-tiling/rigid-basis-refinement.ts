import type { InteriorObservation } from "./motif-interiors.js";
import type { TranslationVector } from "./translations.js";

export type RefinedTranslationBasis =
    | { status: "refined"; basis: readonly [TranslationVector, TranslationVector];
        residualPixels: number; initialResidualPixels: number; maxResidualPixels: number;
        samples: number; translationSpread: number }
    | { status: "inconclusive" | "unsupported"; reason: string };

export type BasisRefinementOptions = {
    maximumCorrectionPixels?: number;
    minimumSamples?: number;
    maximumCentroidResidualPixels?: number;
};

/**
 * Fits both translation vectors simultaneously against original-raster cell
 * centroids, with a separate intercept per observed motif cell class.
 * The integer lattice addresses are frozen from the original candidate: there
 * is no image resampling, chain of local refits or incremental image drift.
 * This is an evidence stage, not a certificate of a valid embedded tiling.
 */
export function refineRigidTranslationBasis(
    observation: InteriorObservation,
    initialBasis: readonly [TranslationVector, TranslationVector],
    options: BasisRefinementOptions = {}
): RefinedTranslationBasis {
    const reject = (reason: string): RefinedTranslationBasis => ({ status: "inconclusive", reason });
    const unsupported = (reason: string): RefinedTranslationBasis => ({ status: "unsupported", reason });
    const maxCorrection = options.maximumCorrectionPixels ?? 3;
    const minimumSamples = options.minimumSamples ?? 12;
    const maxResidual = options.maximumCentroidResidualPixels ?? 3;
    if (!Number.isFinite(maxCorrection) || maxCorrection <= 0 || maxCorrection > 12
        || !Number.isSafeInteger(minimumSamples) || minimumSamples < 6 || minimumSamples > 500
        || !Number.isFinite(maxResidual) || maxResidual < 0.2 || maxResidual > 15)
        return unsupported("Invalid bounded translation refinement parameters");
    if (observation.status !== "observed") return reject("No complete observed cell interiors");
    const cells = observation.interiors;
    const [a, b] = initialBasis;
    if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite)
        || !cells.length || cells.length > 500 || observation.classes.length > 24)
        return unsupported("Invalid or excessive translation refinement inputs");
    const det = a.x * b.y - a.y * b.x;
    if (!Number.isFinite(det) || Math.abs(det) < 4) return unsupported("Translation vectors are dependent");

    type Sample = { classId: number; x: number; y: number; u: number; v: number };
    const anchors = observation.classes.map(kind => cells.find(cell => cell.motifClass === kind.id)?.centroid);
    if (anchors.some(anchor => !anchor)) return reject("Motif classes lack translation anchors");
    const samples: Sample[] = [];
    for (const cell of cells) {
        const anchor = anchors[cell.motifClass];
        if (!anchor || !Number.isFinite(cell.centroid.x) || !Number.isFinite(cell.centroid.y))
            return unsupported("Nonfinite or unclassified centroid");
        const dx = cell.centroid.x - anchor.x, dy = cell.centroid.y - anchor.y;
        const fu = (dx * b.y - dy * b.x) / det;
        const fv = (a.x * dy - a.y * dx) / det;
        const u = Math.round(fu), v = Math.round(fv);
        if (!Number.isSafeInteger(u) || !Number.isSafeInteger(v)
            || Math.max(Math.abs(fu - u), Math.abs(fv - v)) > 0.12)
            return reject("Cell addresses do not repeat reliably under the original candidate");
        samples.push({ classId: cell.motifClass, x: cell.centroid.x, y: cell.centroid.y, u, v });
    }
    if (samples.length < minimumSamples) return reject("Too few independent repeated cell observations");

    const means = observation.classes.map(() => ({ x: 0, y: 0, u: 0, v: 0, n: 0 }));
    for (const sample of samples) {
        const mean = means[sample.classId];
        mean.x += sample.x; mean.y += sample.y; mean.u += sample.u; mean.v += sample.v; mean.n++;
    }
    for (const mean of means) {
        if (mean.n < 3) return reject("A motif class lacks repeated observations");
        mean.x /= mean.n; mean.y /= mean.n; mean.u /= mean.n; mean.v /= mean.n;
    }
    let uu = 0, uv = 0, vv = 0, ux = 0, vx = 0, uy = 0, vy = 0;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const sample of samples) {
        const mean = means[sample.classId];
        const u = sample.u - mean.u, v = sample.v - mean.v;
        const x = sample.x - mean.x, y = sample.y - mean.y;
        uu += u * u; uv += u * v; vv += v * v;
        ux += u * x; vx += v * x; uy += u * y; vy += v * y;
        minU = Math.min(minU, sample.u); maxU = Math.max(maxU, sample.u);
        minV = Math.min(minV, sample.v); maxV = Math.max(maxV, sample.v);
    }
    const gramDet = uu * vv - uv * uv;
    if (!Number.isFinite(gramDet) || gramDet < 0.01 * uu * vv || uu < 1 || vv < 1)
        return reject("Repetitions do not independently constrain both translation directions");
    const fittedA: TranslationVector = { x: (vv * ux - uv * vx) / gramDet, y: (vv * uy - uv * vy) / gramDet };
    const fittedB: TranslationVector = { x: (uu * vx - uv * ux) / gramDet, y: (uu * vy - uv * uy) / gramDet };
    const correction = Math.max(Math.hypot(fittedA.x - a.x, fittedA.y - a.y),
        Math.hypot(fittedB.x - b.x, fittedB.y - b.y));
    if (!Number.isFinite(correction) || correction > maxCorrection)
        return reject("Continuous rigid translation refinement exceeds the bounded candidate neighborhood");
    const finalDet = fittedA.x * fittedB.y - fittedA.y * fittedB.x;
    if (!Number.isFinite(finalDet) || det * finalDet <= 0 || Math.abs(finalDet / det - 1) > 0.12)
        return reject("Refinement changed the translation cell orientation or area");

    const measure = (basisA: TranslationVector, basisB: TranslationVector): { rms: number; worst: number } => {
        let squares = 0, worst = 0;
        for (const sample of samples) {
            const mean = means[sample.classId];
            const du = sample.u - mean.u, dv = sample.v - mean.v;
            const residual = Math.hypot(sample.x - mean.x - du * basisA.x - dv * basisB.x,
                sample.y - mean.y - du * basisA.y - dv * basisB.y);
            squares += residual * residual;
            worst = Math.max(worst, residual);
        }
        return { rms: Math.sqrt(squares / samples.length), worst };
    };
    const before = measure(a, b), after = measure(fittedA, fittedB);
    if (after.worst > maxResidual) return reject("Repetitions cannot share one rigid translation model");
    if (after.rms > before.rms + 1e-7) return reject("Global centroid refinement did not improve the original candidate");
    return { status: "refined", basis: [fittedA, fittedB], residualPixels: after.rms,
        initialResidualPixels: before.rms, maxResidualPixels: after.worst,
        samples: samples.length, translationSpread: Math.min(maxU - minU, maxV - minV) };
}
