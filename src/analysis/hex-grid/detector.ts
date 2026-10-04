export type GrayscaleRaster = {
    width: number;
    height: number;
    pixels: Uint8Array;
};

export type HexLatticeOrientation = "PointyTop" | "FlatTop";

export type HexLatticeFit = {
    orientation: HexLatticeOrientation;
    rotationDegrees: number;
    centerSpacingPixels: number;
    anchorPixel: { x: number; y: number };
    confidence: number;
    residualPixels: number;
    supportCoverage: number;
    orientationSupport: number;
    translationScore: number;
    competingTranslationScore: number;
    linePeriodicityScore: number;
    phaseScore: number;
};

export type HexLatticeDetection = {
    status: "detected" | "inconclusive" | "gridless";
    fit: HexLatticeFit | null;
    reason: string;
};

export type HexLatticeDetectionOptions = {
    minimumSpacingPixels?: number;
    maximumSpacingPixels?: number;
    maximumEdgeSamples?: number;
    minimumConfidence?: number;
};

type EdgeSample = { x: number; y: number; normal: number };
type EdgeField = {
    width: number;
    height: number;
    strength: Float32Array;
    samples: EdgeSample[];
};
type HoughProfile = Float64Array;
type HoughCandidate = {
    baseNormalDegrees: number;
    carrierPitchPixels: number;
    score: number;
    combinedCorrelation: Float64Array;
};
type SpatialLatticeEvaluation = {
    baseNormalDegrees: number;
    carrierPitchPixels: number;
    score: number;
    supportedChecks: number;
    totalChecks: number;
};
type DistantPhaseResidual = {
    residualPixels: number;
    worstRegionResidualPixels: number;
    supportedRegions: number;
    totalRegions: number;
};
type PhaseFit = {
    anchor: { x: number; y: number };
    score: number;
    coverage: number;
};
type FinalLatticeCandidate = {
    spatial: SpatialLatticeEvaluation;
    model: { orientation: HexLatticeOrientation; rotationDegrees: number };
    centerSpacingPixels: number;
    phase: PhaseFit;
    distantResidual: DistantPhaseResidual;
    canonicalStepPixels: number | null;
};

type PhaseAccumulator = {
    x: number;
    y: number;
    count: number;
};

const PI = Math.PI;
const DEG = PI / 180;
const SQRT3 = Math.sqrt(3);
const HOUGH_ORIENTATION_TOLERANCE = 7 * DEG;
// Carrier pitch is half the hex-center spacing, and ranking needs the second
// harmonic to stay inside the sampled autocorrelation curve. A 120 px lag cap
// silently excluded valid grids above 120 px center spacing, including the
// approximately 132.7 px Bellowing Wilds lattice.
const HOUGH_MAX_LAG = 160;
const HOUGH_HARMONIC_WEIGHTS = [1, 0.8, 0.6, 0.4] as const;
const SPATIAL_REFINEMENT_TILES = 5;
const DISTANT_RESIDUAL_TILES = 3;
const SPATIAL_REFINEMENT_SAMPLE_LIMIT = 90_000;
const CANONICAL_CENTER_SPACING_STEPS = [0.25, 0.01] as const;

export function detectHexLattice(
    raster: GrayscaleRaster,
    options: HexLatticeDetectionOptions = {}): HexLatticeDetection {
    validateRaster(raster);
    const minimumCenterSpacing = Math.max(8, Math.floor(options.minimumSpacingPixels ?? 12));
    const maximumCenterSpacing = Math.min(
        Math.floor(Math.min(raster.width, raster.height) / 2),
        Math.floor(options.maximumSpacingPixels ?? Number.POSITIVE_INFINITY));
    if (maximumCenterSpacing <= minimumCenterSpacing + 2) {
        return inconclusive("The raster is too small to establish repeated hex-grid spacing.");
    }

    const field = buildEdgeField(raster, options.maximumEdgeSamples ?? 90_000);
    if (field.samples.length < 500) {
        return gridless("The raster does not contain enough edge evidence for a hex lattice.");
    }

    const hough = fitHoughLattice(field, minimumCenterSpacing, maximumCenterSpacing);
    if (!hough.best || hough.best.score < 0.34) {
        return gridless(
            "Raster edges do not form three repeated line families with a stable hex-lattice period.");
    }

    const refinedHough = refineHoughCandidate(
        field,
        hough.best,
        minimumCenterSpacing,
        maximumCenterSpacing);
    const houghCarrierPitch = refinePeak(
        refinedHough.combinedCorrelation,
        refinedHough.carrierPitchPixels);

    // The global autocorrelation gives a good seed but can be biased by artwork after
    // browser down-sampling. Refine angle and pitch against phase consistency across
    // widely separated image regions so a locally plausible period can not accumulate
    // visible drift at the opposite side of the raster.
    const spatialSeed = refineSpatialLattice(
        field,
        refinedHough.baseNormalDegrees,
        houghCarrierPitch);

    // Test nearby quarter-pixel and hundredth-pixel spacing hypotheses as complete
    // rigid lattices, but do not round merely to simplify the stored value. Re-fit the
    // small rotation and phase/origin for each candidate and retain a snapped value only
    // when it actually improves the final multi-region fit over the continuous solution.
    const selected = selectFinalLattice(field, spatialSeed);
    const spatial = selected.spatial;
    const model = selected.model;
    const centerSpacing = selected.centerSpacingPixels;
    const phase = selected.phase;
    const distantResidual = selected.distantResidual;

    const periodicityConfidence = clamp01((refinedHough.score - 0.30) / 0.52);
    const uniqueness = clamp01(
        (refinedHough.score - hough.competitorScore) / 0.18);
    const spatialConfidence = clamp01((spatial.score - 0.30) / 0.55);
    const phaseConfidence = clamp01((phase.score - 0.10) / 0.32);
    const coverageConfidence = clamp01((phase.coverage - 0.10) / 0.60);
    const distantCoverageConfidence = clamp01(
        (distantResidual.supportedRegions - 4) / Math.max(1, distantResidual.totalRegions - 4));
    const residualScale = Math.max(1.5, centerSpacing * 0.10);
    const residualConfidence = clamp01(
        1 - distantResidual.worstRegionResidualPixels / residualScale);
    const confidence = clamp01(
        periodicityConfidence * 0.26
        + uniqueness * 0.12
        + spatialConfidence * 0.20
        + phaseConfidence * 0.14
        + coverageConfidence * 0.10
        + distantCoverageConfidence * 0.08
        + residualConfidence * 0.10);

    const fit: HexLatticeFit = {
        orientation: model.orientation,
        rotationDegrees: model.rotationDegrees,
        centerSpacingPixels: centerSpacing,
        anchorPixel: phase.anchor,
        confidence,
        // residualPixels is deliberately the worst supported distant-region error.
        // This keeps the existing public/UI field conservative instead of reporting an
        // average that can hide a visibly drifting corner.
        residualPixels: distantResidual.worstRegionResidualPixels,
        supportCoverage: phase.coverage,
        orientationSupport: refinedHough.score,
        translationScore: spatial.score,
        competingTranslationScore: hough.competitorScore,
        linePeriodicityScore: refinedHough.score,
        phaseScore: phase.score
    };

    const threshold = options.minimumConfidence ?? 0.52;
    const maximumWorstRegionResidual = Math.max(2, centerSpacing * 0.08);
    const insufficientDistantSupport = distantResidual.supportedRegions < 6;
    const excessiveDistantResidual =
        distantResidual.worstRegionResidualPixels > maximumWorstRegionResidual;
    if (confidence < threshold
        || phase.coverage < 0.10
        || insufficientDistantSupport
        || excessiveDistantResidual) {
        return {
            status: "inconclusive",
            fit,
            reason: confidence < threshold
                ? `A repeated hex lattice was found, but confidence ${confidence.toFixed(2)} is below the ${threshold.toFixed(2)} automatic-apply threshold.`
                : insufficientDistantSupport
                    ? "A repeated local pattern was found, but too few distant image regions support one stable rigid lattice."
                    : excessiveDistantResidual
                        ? `A repeated hex lattice was found, but the final rigid overlay misses at least one distant region by ${distantResidual.worstRegionResidualPixels.toFixed(2)} px.`
                        : "A repeated hex lattice was found, but too little of the raster supports the fitted phase."
        };
    }

    return {
        status: "detected",
        fit,
        reason: `Detected a ${model.orientation === "PointyTop" ? "pointy-top" : "flat-top"} hex lattice with ${centerSpacing.toFixed(2)} px center spacing.`
    };
}

function validateRaster(raster: GrayscaleRaster): void {
    if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height)
        || raster.width < 8 || raster.height < 8) {
        throw new Error("Raster dimensions must be integers of at least 8×8 pixels.");
    }
    if (raster.pixels.length !== raster.width * raster.height) {
        throw new Error("Grayscale raster pixel count does not match its dimensions.");
    }
}

function buildEdgeField(raster: GrayscaleRaster, maxSamples: number): EdgeField {
    const { width, height, pixels } = raster;
    const rawMagnitude = new Float32Array(width * height);
    const rawNormal = new Float32Array(width * height);
    const sampledMagnitudes: number[] = [];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const top = i - width;
            const bottom = i + width;
            const gx = -pixels[top - 1] + pixels[top + 1]
                - 2 * pixels[i - 1] + 2 * pixels[i + 1]
                - pixels[bottom - 1] + pixels[bottom + 1];
            const gy = -pixels[top - 1] - 2 * pixels[top] - pixels[top + 1]
                + pixels[bottom - 1] + 2 * pixels[bottom] + pixels[bottom + 1];
            const magnitude = Math.hypot(gx, gy);
            rawMagnitude[i] = magnitude;
            rawNormal[i] = normalizeHalfTurn(Math.atan2(gy, gx));
            if ((x & 1) === 0 && (y & 1) === 0 && magnitude > 0) {
                sampledMagnitudes.push(magnitude);
            }
        }
    }

    if (sampledMagnitudes.length === 0) {
        return { width, height, strength: new Float32Array(width * height), samples: [] };
    }

    sampledMagnitudes.sort((a, b) => a - b);
    // Baked map grids are often deliberately faint. A high edge threshold drops the
    // grid and leaves roads, labels, coastlines, and borders as the dominant signal.
    // Use broad gradient evidence, then let the global three-family Hough model reject
    // unrelated edges by geometry and periodicity.
    const threshold = Math.max(6, quantile(sampledMagnitudes, 0.55));
    const normalizer = Math.max(threshold, quantile(sampledMagnitudes, 0.90));
    const strength = new Float32Array(width * height);
    const candidates: EdgeSample[] = [];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = y * width + x;
            const magnitude = rawMagnitude[i];
            strength[i] = Math.min(1, magnitude / normalizer);
            if (magnitude >= threshold) {
                candidates.push({ x, y, normal: rawNormal[i] });
            }
        }
    }

    if (candidates.length <= maxSamples) {
        return { width, height, strength, samples: candidates };
    }

    // Keep a deterministic, spatially distributed sample. Sorting by magnitude would
    // recreate the original failure mode by preferentially retaining map artwork.
    const samples: EdgeSample[] = [];
    const step = candidates.length / maxSamples;
    for (let index = 0; index < maxSamples; index++) {
        samples.push(candidates[Math.floor(index * step)]);
    }
    return { width, height, strength, samples };
}

function fitHoughLattice(
    field: EdgeField,
    minimumCenterSpacing: number,
    maximumCenterSpacing: number): {
    best: HoughCandidate | null;
    competitorScore: number;
} {
    const maxLag = Math.min(
        HOUGH_MAX_LAG,
        Math.floor(Math.min(field.width, field.height) / 3));
    const minimumPitch = Math.max(3, Math.floor(minimumCenterSpacing / 2));
    const maximumPitch = Math.min(
        Math.floor(maximumCenterSpacing / 2),
        Math.floor(maxLag / 2));
    if (maximumPitch <= minimumPitch + 1) {
        return { best: null, competitorScore: 0 };
    }

    const candidates: HoughCandidate[] = [];
    for (let degrees = 0; degrees < 60; degrees += 1) {
        const candidate = evaluateHoughOrientation(
            field,
            degrees,
            minimumPitch,
            maximumPitch,
            maxLag);
        if (candidate) candidates.push(candidate);
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0] ?? null;
    const competitor = best
        ? candidates.find(candidate => isDistinctHoughFit(best, candidate)) ?? null
        : null;
    return {
        best,
        competitorScore: competitor?.score ?? 0
    };
}

function isDistinctHoughFit(best: HoughCandidate, candidate: HoughCandidate): boolean {
    if (candidate === best) return false;
    const rawAngleDifference = Math.abs(best.baseNormalDegrees - candidate.baseNormalDegrees);
    const angleDifference = Math.min(rawAngleDifference, 60 - rawAngleDifference);
    const pitchDifference = Math.abs(best.carrierPitchPixels - candidate.carrierPitchPixels);
    return angleDifference >= 4
        || pitchDifference >= Math.max(2, best.carrierPitchPixels * 0.12);
}

function refineHoughCandidate(
    field: EdgeField,
    coarse: HoughCandidate,
    minimumCenterSpacing: number,
    maximumCenterSpacing: number): HoughCandidate {
    const maxLag = Math.min(
        HOUGH_MAX_LAG,
        Math.floor(Math.min(field.width, field.height) / 3));
    const minimumPitch = Math.max(3, Math.floor(minimumCenterSpacing / 2));
    const maximumPitch = Math.min(
        Math.floor(maximumCenterSpacing / 2),
        Math.floor(maxLag / 2));
    let best = coarse;
    for (let delta = -1; delta <= 1.0001; delta += 0.25) {
        const degrees = normalizePeriod(coarse.baseNormalDegrees + delta, 60);
        const candidate = evaluateHoughOrientation(
            field,
            degrees,
            minimumPitch,
            maximumPitch,
            maxLag);
        if (candidate && candidate.score > best.score) best = candidate;
    }
    return best;
}

function evaluateHoughOrientation(
    field: EdgeField,
    baseNormalDegrees: number,
    minimumPitch: number,
    maximumPitch: number,
    maxLag: number): HoughCandidate | null {
    const familyCurves: Float64Array[] = [];
    for (let family = 0; family < 3; family++) {
        const angle = (baseNormalDegrees * DEG) + (family * PI / 3);
        const profile = buildHoughProfile(field, angle);
        if (!profile) return null;
        familyCurves.push(normalizedAutocorrelation(profile, maxLag));
    }

    const combined = new Float64Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
        const familyScores = familyCurves.map(curve => curve[lag]).sort((a, b) => a - b);
        combined[lag] =
            (familyScores[1] * 0.55)
            + (familyScores[2] * 0.30)
            + (familyScores[0] * 0.15);
    }

    let bestPitch = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let pitch = minimumPitch; pitch <= maximumPitch; pitch++) {
        const score = harmonicTrainScore(combined, pitch);
        if (score > bestScore) {
            bestScore = score;
            bestPitch = pitch;
        }
    }
    if (!Number.isFinite(bestScore) || bestPitch <= 0) return null;
    return {
        baseNormalDegrees,
        carrierPitchPixels: bestPitch,
        score: bestScore,
        combinedCorrelation: combined
    };
}

function buildHoughProfile(field: EdgeField, normal: number): HoughProfile | null {
    const diagonal = Math.ceil(Math.hypot(field.width, field.height));
    const profile = new Float64Array((diagonal * 2) + 5);
    const offset = diagonal + 2;
    const cos = Math.cos(normal);
    const sin = Math.sin(normal);
    let votes = 0;

    for (const sample of field.samples) {
        if (halfTurnDistance(sample.normal, normal) > HOUGH_ORIENTATION_TOLERANCE) continue;
        const rho = (sample.x * cos) + (sample.y * sin);
        const index = Math.round(rho) + offset;
        if (index < 0 || index >= profile.length) continue;
        profile[index] += 1;
        votes++;
    }
    if (votes < 120) return null;
    return smoothProfile(smoothProfile(profile));
}

function normalizedAutocorrelation(profile: HoughProfile, maxLag: number): Float64Array {
    const baseline = movingAverage(profile, 8);
    const residual = new Float64Array(profile.length);
    let sumSquares = 0;
    for (let index = 0; index < profile.length; index++) {
        const value = profile[index] - baseline[index];
        residual[index] = value;
        sumSquares += value * value;
    }
    const standardDeviation = Math.sqrt(sumSquares / Math.max(1, profile.length));
    const clip = Math.max(1e-9, standardDeviation * 3);
    for (let index = 0; index < residual.length; index++) {
        residual[index] = Math.max(-clip, Math.min(clip, residual[index]));
    }

    const result = new Float64Array(maxLag + 1);
    for (let lag = 3; lag <= maxLag; lag++) {
        let numerator = 0;
        let leftSquares = 0;
        let rightSquares = 0;
        for (let index = 0; index < residual.length - lag; index++) {
            const left = residual[index];
            const right = residual[index + lag];
            numerator += left * right;
            leftSquares += left * left;
            rightSquares += right * right;
        }
        const denominator = Math.sqrt(leftSquares * rightSquares);
        result[lag] = denominator > 1e-12 ? numerator / denominator : 0;
    }
    return result;
}

function harmonicTrainScore(curve: Float64Array, pitch: number): number {
    let weighted = 0;
    let weightTotal = 0;
    let first = 0;
    let maximum = 0;

    for (let harmonic = 1; harmonic <= HOUGH_HARMONIC_WEIGHTS.length; harmonic++) {
        const center = pitch * harmonic;
        const weight = HOUGH_HARMONIC_WEIGHTS[harmonic - 1];
        let value = 0;
        if (center < curve.length) {
            for (let offset = -1; offset <= 1; offset++) {
                const index = center + offset;
                if (index >= 3 && index < curve.length) {
                    value = Math.max(value, curve[index]);
                }
            }
        }
        value = Math.max(0, value);
        if (harmonic === 1) first = value;
        maximum = Math.max(maximum, value);
        weighted += value * weight;
        weightTotal += weight;
    }

    if (weightTotal <= 0 || maximum <= 0) return 0;
    const fundamentalSupport = clamp01((first + 0.10) / (maximum + 0.10));
    return (weighted / weightTotal) * (0.65 + (0.35 * fundamentalSupport));
}

function smoothProfile(values: Float64Array): Float64Array {
    const result = new Float64Array(values.length);
    for (let index = 0; index < values.length; index++) {
        const previous = values[Math.max(0, index - 1)];
        const current = values[index];
        const next = values[Math.min(values.length - 1, index + 1)];
        result[index] = (previous + (2 * current) + next) / 4;
    }
    return result;
}

function movingAverage(values: Float64Array, radius: number): Float64Array {
    const result = new Float64Array(values.length);
    const prefix = new Float64Array(values.length + 1);
    for (let index = 0; index < values.length; index++) {
        prefix[index + 1] = prefix[index] + values[index];
    }
    for (let index = 0; index < values.length; index++) {
        const start = Math.max(0, index - radius);
        const end = Math.min(values.length, index + radius + 1);
        result[index] = (prefix[end] - prefix[start]) / Math.max(1, end - start);
    }
    return result;
}

function refineSpatialLattice(
    field: EdgeField,
    baseNormalDegrees: number,
    carrierPitchPixels: number): SpatialLatticeEvaluation {
    const originalDegrees = normalizePeriod(baseNormalDegrees, 60);
    let best = evaluateSpatialLattice(field, originalDegrees, carrierPitchPixels);
    let bestPreference = spatialPreference(best, originalDegrees);

    const stages = [
        { angleRadius: 0.30, angleStep: 0.15, pitchRadius: 0.015, pitchStep: 0.0015 },
        { angleRadius: 0.08, angleStep: 0.04, pitchRadius: 0.003, pitchStep: 0.0005 }
    ] as const;

    for (const stage of stages) {
        const seedDegrees = best.baseNormalDegrees;
        const seedPitch = best.carrierPitchPixels;
        let stageBest = best;
        let stagePreference = bestPreference;
        for (let angleOffset = -stage.angleRadius;
            angleOffset <= stage.angleRadius + 1e-9;
            angleOffset += stage.angleStep) {
            for (let pitchOffset = -stage.pitchRadius;
                pitchOffset <= stage.pitchRadius + 1e-9;
                pitchOffset += stage.pitchStep) {
                const degrees = normalizePeriod(seedDegrees + angleOffset, 60);
                const pitch = seedPitch * (1 + pitchOffset);
                if (!Number.isFinite(pitch) || pitch <= 2) continue;
                const candidate = evaluateSpatialLattice(field, degrees, pitch);
                const preference = spatialPreference(candidate, originalDegrees);
                if (preference > stagePreference + 1e-9) {
                    stageBest = candidate;
                    stagePreference = preference;
                }
            }
        }
        best = stageBest;
        bestPreference = stagePreference;
    }

    return best;
}

function selectFinalLattice(
    field: EdgeField,
    spatialSeed: SpatialLatticeEvaluation): FinalLatticeCandidate {
    const continuous = evaluateFinalLatticeCandidate(field, spatialSeed, null);
    const candidates: FinalLatticeCandidate[] = [continuous];

    for (const step of CANONICAL_CENTER_SPACING_STEPS) {
        const snappedSpacing = roundToStep(continuous.centerSpacingPixels, step);
        if (!Number.isFinite(snappedSpacing) || snappedSpacing <= 4) continue;
        if (candidates.some(candidate =>
            Math.abs(candidate.centerSpacingPixels - snappedSpacing) <= 1e-9)) continue;

        const snappedSpatial = refineAngleAtFixedPitch(
            field,
            spatialSeed.baseNormalDegrees,
            snappedSpacing / 2);
        candidates.push(evaluateFinalLatticeCandidate(field, snappedSpatial, step));
    }

    let best = candidates[0];
    for (let index = 1; index < candidates.length; index++) {
        if (isBetterFinalLatticeCandidate(candidates[index], best)) {
            best = candidates[index];
        }
    }
    return best;
}

function evaluateFinalLatticeCandidate(
    field: EdgeField,
    spatial: SpatialLatticeEvaluation,
    canonicalStepPixels: number | null): FinalLatticeCandidate {
    const model = classifyOrientation(spatial.baseNormalDegrees * DEG);
    const centerSpacingPixels = spatial.carrierPitchPixels * 2;
    const coarsePhase = fitPhase(
        field.strength,
        field.width,
        field.height,
        model.orientation,
        model.rotationDegrees,
        centerSpacingPixels);
    const phase = refinePhaseAnchor(
        field,
        model.orientation,
        model.rotationDegrees,
        spatial.baseNormalDegrees,
        spatial.carrierPitchPixels,
        centerSpacingPixels,
        coarsePhase);
    const distantResidual = measureDistantOverlayResidual(
        field,
        spatial.baseNormalDegrees,
        spatial.carrierPitchPixels,
        phase.anchor);
    return {
        spatial,
        model,
        centerSpacingPixels,
        phase,
        distantResidual,
        canonicalStepPixels
    };
}

function refineAngleAtFixedPitch(
    field: EdgeField,
    baseNormalDegrees: number,
    carrierPitchPixels: number): SpatialLatticeEvaluation {
    const originalDegrees = normalizePeriod(baseNormalDegrees, 60);
    let best = evaluateSpatialLattice(field, originalDegrees, carrierPitchPixels);
    let bestPreference = spatialPreference(best, originalDegrees);

    for (let angleOffset = -0.08; angleOffset <= 0.080001; angleOffset += 0.04) {
        const degrees = normalizePeriod(originalDegrees + angleOffset, 60);
        const candidate = evaluateSpatialLattice(field, degrees, carrierPitchPixels);
        const preference = spatialPreference(candidate, originalDegrees);
        if (preference > bestPreference + 1e-9) {
            best = candidate;
            bestPreference = preference;
        }
    }
    return best;
}

function isBetterFinalLatticeCandidate(
    candidate: FinalLatticeCandidate,
    current: FinalLatticeCandidate): boolean {
    const candidateBroad = candidate.distantResidual.supportedRegions >= 6;
    const currentBroad = current.distantResidual.supportedRegions >= 6;
    if (candidateBroad !== currentBroad) return candidateBroad;

    const candidateWorst = candidate.distantResidual.worstRegionResidualPixels;
    const currentWorst = current.distantResidual.worstRegionResidualPixels;
    if (candidateWorst < currentWorst - 1e-6) return true;
    if (candidateWorst > currentWorst + 1e-6) return false;

    const candidateRms = candidate.distantResidual.residualPixels;
    const currentRms = current.distantResidual.residualPixels;
    if (candidateRms < currentRms - 1e-6) return true;
    if (candidateRms > currentRms + 1e-6) return false;

    if (candidate.distantResidual.supportedRegions
        !== current.distantResidual.supportedRegions) {
        return candidate.distantResidual.supportedRegions
            > current.distantResidual.supportedRegions;
    }
    if (candidate.phase.score !== current.phase.score) {
        return candidate.phase.score > current.phase.score;
    }
    return candidate.spatial.score > current.spatial.score;
}

function roundToStep(value: number, step: number): number {
    return Math.round(value / step) * step;
}

function spatialPreference(
    evaluation: SpatialLatticeEvaluation,
    originalDegrees: number): number {
    // Global Hough orientation is already strong. Penalize tiny angle excursions unless
    // distant phase consistency materially improves, while allowing pitch to move freely.
    const angleDistance = periodDistance(evaluation.baseNormalDegrees, originalDegrees, 60);
    return evaluation.score - (angleDistance * 0.06);
}

function evaluateSpatialLattice(
    field: EdgeField,
    baseNormalDegrees: number,
    carrierPitchPixels: number): SpatialLatticeEvaluation {
    const tiles = SPATIAL_REFINEMENT_TILES;
    const familyTileCount = 3 * tiles * tiles;
    const accumulators: PhaseAccumulator[] = Array.from(
        { length: familyTileCount },
        () => ({ x: 0, y: 0, count: 0 }));
    const stride = Math.max(
        1,
        Math.ceil(field.samples.length / SPATIAL_REFINEMENT_SAMPLE_LIMIT));

    for (let index = 0; index < field.samples.length; index += stride) {
        const sample = field.samples[index];
        let bestFamily = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let family = 0; family < 3; family++) {
            const normal = ((baseNormalDegrees * DEG) + (family * PI / 3));
            const distance = halfTurnDistance(sample.normal, normal);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestFamily = family;
            }
        }
        if (bestFamily < 0 || bestDistance > HOUGH_ORIENTATION_TOLERANCE) continue;

        const normal = (baseNormalDegrees * DEG) + (bestFamily * PI / 3);
        const rho = (sample.x * Math.cos(normal)) + (sample.y * Math.sin(normal));
        const phase = (2 * PI * rho) / carrierPitchPixels;
        const tileX = Math.min(tiles - 1, Math.floor(sample.x * tiles / field.width));
        const tileY = Math.min(tiles - 1, Math.floor(sample.y * tiles / field.height));
        const accumulator = accumulators[
            bestFamily * tiles * tiles + tileY * tiles + tileX];
        accumulator.x += Math.cos(phase);
        accumulator.y += Math.sin(phase);
        accumulator.count++;
    }

    let alignmentTotal = 0;
    let alignmentWeight = 0;
    let supportedChecks = 0;

    for (let family = 0; family < 3; family++) {
        const local: Array<{ phase: number; coherence: number; count: number }> = [];
        for (let tile = 0; tile < tiles * tiles; tile++) {
            const accumulator = accumulators[family * tiles * tiles + tile];
            if (accumulator.count < 8) continue;
            const coherence = Math.hypot(accumulator.x, accumulator.y) / accumulator.count;
            if (coherence < 0.06) continue;
            local.push({
                phase: Math.atan2(accumulator.y, accumulator.x),
                coherence,
                count: accumulator.count
            });
        }
        if (local.length < 4) continue;

        const globalPhase = weightedCircularMean(local, null);

        for (let index = 0; index < local.length; index++) {
            const item = local[index];
            const delta = circularDistance(item.phase, globalPhase);
            const weight = phaseTileWeight(item.coherence, item.count);
            alignmentTotal += Math.cos(delta) * weight;
            alignmentWeight += weight;
            supportedChecks++;
        }
    }

    const alignment = alignmentWeight > 0 ? alignmentTotal / alignmentWeight : -1;
    const coverage = supportedChecks / familyTileCount;
    const score = clamp01(alignment * 0.92 + coverage * 0.08);
    return {
        baseNormalDegrees: normalizePeriod(baseNormalDegrees, 60),
        carrierPitchPixels,
        score,
        supportedChecks,
        totalChecks: familyTileCount
    };
}

function weightedCircularMean(
    values: ReadonlyArray<{ phase: number; coherence: number; count: number }>,
    multipliers: readonly number[] | null): number {
    let x = 0;
    let y = 0;
    for (let index = 0; index < values.length; index++) {
        const item = values[index];
        const weight = phaseTileWeight(item.coherence, item.count)
            * (multipliers?.[index] ?? 1);
        x += Math.cos(item.phase) * weight;
        y += Math.sin(item.phase) * weight;
    }
    return Math.atan2(y, x);
}

function phaseTileWeight(coherence: number, count: number): number {
    return Math.max(0.02, coherence)
        * Math.min(20, Math.sqrt(count));
}

function refinePhaseAnchor(
    field: EdgeField,
    orientation: HexLatticeOrientation,
    rotationDegrees: number,
    baseNormalDegrees: number,
    carrierPitchPixels: number,
    spacing: number,
    coarse: PhaseFit): PhaseFit {
    const basisAngle = ((orientation === "PointyTop" ? 0 : 30) + rotationDegrees) * DEG;
    const u = { x: spacing * Math.cos(basisAngle), y: spacing * Math.sin(basisAngle) };
    const v = { x: spacing * Math.cos(basisAngle + PI / 3), y: spacing * Math.sin(basisAngle + PI / 3) };
    let best = {
        phase: coarse,
        residual: measureDistantOverlayResidual(
            field,
            baseNormalDegrees,
            carrierPitchPixels,
            coarse.anchor)
    };

    for (const divisor of [48, 192]) {
        const center = { ...best.phase.anchor };
        for (let ai = -2; ai <= 2; ai++) {
            for (let bi = -2; bi <= 2; bi++) {
                const anchor = {
                    x: center.x + (ai / divisor) * u.x + (bi / divisor) * v.x,
                    y: center.y + (ai / divisor) * u.y + (bi / divisor) * v.y
                };
                const residual = measureDistantOverlayResidual(
                    field,
                    baseNormalDegrees,
                    carrierPitchPixels,
                    anchor);
                if (!isBetterDistantResidual(residual, best.residual)) continue;
                const scored = scorePhase(
                    field.strength,
                    field.width,
                    field.height,
                    orientation,
                    rotationDegrees,
                    spacing,
                    anchor,
                    u,
                    v);
                // Preserve the parity selected by the coarse hex-edge score. A candidate
                // may improve line-family phase while crossing into the wrong half-cell.
                if (scored.score < coarse.score * 0.88) continue;
                best = {
                    phase: { anchor, ...scored },
                    residual
                };
            }
        }
    }

    return best.phase;
}

function isBetterDistantResidual(
    candidate: DistantPhaseResidual,
    current: DistantPhaseResidual): boolean {
    const candidateHasBroadSupport = candidate.supportedRegions >= 6;
    const currentHasBroadSupport = current.supportedRegions >= 6;
    if (candidateHasBroadSupport !== currentHasBroadSupport) {
        return candidateHasBroadSupport;
    }
    if (candidate.worstRegionResidualPixels < current.worstRegionResidualPixels - 1e-6) {
        return true;
    }
    if (Math.abs(candidate.worstRegionResidualPixels - current.worstRegionResidualPixels) <= 1e-6) {
        if (candidate.residualPixels < current.residualPixels - 1e-6) return true;
        if (Math.abs(candidate.residualPixels - current.residualPixels) <= 1e-6) {
            return candidate.supportedRegions > current.supportedRegions;
        }
    }
    return false;
}

function measureDistantOverlayResidual(
    field: EdgeField,
    baseNormalDegrees: number,
    carrierPitchPixels: number,
    anchor: { x: number; y: number }): DistantPhaseResidual {
    const tiles = DISTANT_RESIDUAL_TILES;
    const totalRegions = tiles * tiles;
    const regionResiduals: number[][] = Array.from({ length: totalRegions }, () => []);
    const regionWeights: number[][] = Array.from({ length: totalRegions }, () => []);

    for (let family = 0; family < 3; family++) {
        const normal = (baseNormalDegrees * DEG) + (family * PI / 3);
        const cos = Math.cos(normal);
        const sin = Math.sin(normal);
        const samples = field.samples.filter(
            sample => halfTurnDistance(sample.normal, normal) <= HOUGH_ORIENTATION_TOLERANCE);
        if (samples.length < 120) continue;

        const expectedPhase = (2 * PI * ((anchor.x * cos) + (anchor.y * sin)))
            / carrierPitchPixels;
        for (let tileY = 0; tileY < tiles; tileY++) {
            for (let tileX = 0; tileX < tiles; tileX++) {
                const minX = tileX * field.width / tiles;
                const maxX = (tileX + 1) * field.width / tiles;
                const minY = tileY * field.height / tiles;
                const maxY = (tileY + 1) * field.height / tiles;
                let localX = 0;
                let localY = 0;
                let count = 0;
                for (const sample of samples) {
                    if (sample.x < minX || sample.x >= maxX
                        || sample.y < minY || sample.y >= maxY) continue;
                    const rho = (sample.x * cos) + (sample.y * sin);
                    const phase = (2 * PI * rho) / carrierPitchPixels;
                    localX += Math.cos(phase);
                    localY += Math.sin(phase);
                    count++;
                }
                if (count < 20) continue;
                const coherence = Math.hypot(localX, localY) / count;
                if (coherence < 0.04) continue;

                const localPhase = Math.atan2(localY, localX);
                const delta = circularDistance(localPhase, expectedPhase);
                const residual = Math.abs(delta) / (2 * PI) * carrierPitchPixels;
                const region = tileY * tiles + tileX;
                regionResiduals[region].push(residual);
                regionWeights[region].push(phaseTileWeight(coherence, count));
            }
        }
    }

    const supported: Array<{ residual: number; weight: number }> = [];
    for (let region = 0; region < totalRegions; region++) {
        const values = regionResiduals[region];
        // Two agreeing line families are enough to constrain a 2D rigid lattice while
        // tolerating one family being obscured by labels, roads, coastlines, or borders.
        if (values.length < 2) continue;
        values.sort((a, b) => a - b);
        const residual = values.length % 2 === 0
            ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
        supported.push({
            residual,
            weight: regionWeights[region].reduce((sum, value) => sum + value, 0)
        });
    }

    const totalWeight = supported.reduce((sum, region) => sum + region.weight, 0);
    const residualPixels = totalWeight > 0
        ? Math.sqrt(supported.reduce(
            (sum, region) => sum + region.weight * region.residual * region.residual,
            0) / totalWeight)
        : carrierPitchPixels / 2;
    const worstRegionResidualPixels = supported.length > 0
        ? Math.max(...supported.map(region => region.residual))
        : carrierPitchPixels / 2;
    return {
        residualPixels,
        worstRegionResidualPixels,
        supportedRegions: supported.length,
        totalRegions
    };
}

function classifyOrientation(baseNormal: number): { orientation: HexLatticeOrientation; rotationDegrees: number } {
    const degrees = normalizePeriod(baseNormal / DEG, 60);
    if (Math.min(degrees, 60 - degrees) <= 15) {
        return {
            orientation: "PointyTop",
            rotationDegrees: normalizeSigned(degrees <= 30 ? degrees : degrees - 60)
        };
    }
    return {
        orientation: "FlatTop",
        rotationDegrees: normalizeSigned(degrees - 30)
    };
}

function fitPhase(
    strength: Float32Array,
    width: number,
    height: number,
    orientation: HexLatticeOrientation,
    rotationDegrees: number,
    spacing: number): PhaseFit {
    const basisAngle = ((orientation === "PointyTop" ? 0 : 30) + rotationDegrees) * DEG;
    const u = { x: spacing * Math.cos(basisAngle), y: spacing * Math.sin(basisAngle) };
    const v = { x: spacing * Math.cos(basisAngle + PI / 3), y: spacing * Math.sin(basisAngle + PI / 3) };
    let best: PhaseFit = { anchor: { x: 0, y: 0 }, score: -1, coverage: 0 };

    for (let ai = 0; ai < 12; ai++) {
        for (let bi = 0; bi < 12; bi++) {
            const anchor = {
                x: (ai / 12) * u.x + (bi / 12) * v.x,
                y: (ai / 12) * u.y + (bi / 12) * v.y
            };
            const result = scorePhase(
                strength,
                width,
                height,
                orientation,
                rotationDegrees,
                spacing,
                anchor,
                u,
                v);
            if (result.score > best.score
                || (Math.abs(result.score - best.score) <= 1e-9
                    && result.coverage > best.coverage)) {
                best = { anchor, ...result };
            }
        }
    }
    return best;
}

function scorePhase(
    strength: Float32Array,
    width: number,
    height: number,
    orientation: HexLatticeOrientation,
    rotationDegrees: number,
    spacing: number,
    anchor: { x: number; y: number },
    u: { x: number; y: number },
    v: { x: number; y: number }): { score: number; coverage: number } {
    const radius = spacing / SQRT3;
    const cornerStart = ((orientation === "PointyTop" ? -30 : 0) + rotationDegrees) * DEG;
    const reach = Math.ceil(Math.hypot(width, height) / spacing) + 4;
    let total = 0;
    let count = 0;
    let supported = 0;

    for (let i = -reach; i <= reach; i++) {
        for (let j = -reach; j <= reach; j++) {
            const cx = anchor.x + i * u.x + j * v.x;
            const cy = anchor.y + i * u.y + j * v.y;
            if (cx < -spacing || cy < -spacing || cx > width + spacing || cy > height + spacing) continue;
            const corners = Array.from({ length: 6 }, (_, index) => {
                const angle = cornerStart + index * PI / 3;
                return {
                    x: cx + radius * Math.cos(angle),
                    y: cy + radius * Math.sin(angle)
                };
            });
            for (let edge = 0; edge < 6; edge++) {
                const a = corners[edge];
                const b = corners[(edge + 1) % 6];
                for (const t of [0.25, 0.5, 0.75]) {
                    const x = a.x + (b.x - a.x) * t;
                    const y = a.y + (b.y - a.y) * t;
                    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
                    const value = bilinear(strength, width, height, x, y);
                    total += value;
                    count++;
                    if (value >= 0.22) supported++;
                }
            }
        }
    }
    return {
        score: count ? total / count : 0,
        coverage: count ? supported / count : 0
    };
}

function refinePeak(scores: Float64Array, spacing: number): number {
    const rounded = Math.round(spacing);
    if (rounded <= 0 || rounded >= scores.length - 1) return spacing;
    const left = scores[rounded - 1];
    const center = scores[rounded];
    const right = scores[rounded + 1];
    const denominator = left - (2 * center) + right;
    if (Math.abs(denominator) < 1e-9) return spacing;
    return rounded + Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator));
}

function bilinear(values: Float32Array, width: number, height: number, x: number, y: number): number {
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return 0;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const i = y0 * width + x0;
    const top = values[i] * (1 - tx) + values[i + 1] * tx;
    const bottom = values[i + width] * (1 - tx) + values[i + width + 1] * tx;
    return top * (1 - ty) + bottom * ty;
}

function circularDistance(a: number, b: number): number {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function periodDistance(a: number, b: number, period: number): number {
    const delta = Math.abs(normalizePeriod(a, period) - normalizePeriod(b, period));
    return Math.min(delta, period - delta);
}

function halfTurnDistance(a: number, b: number): number {
    const delta = Math.abs(normalizeHalfTurn(a) - normalizeHalfTurn(b));
    return Math.min(delta, PI - delta);
}

function normalizeHalfTurn(value: number): number {
    let result = value % PI;
    if (result < 0) result += PI;
    return result;
}

function normalizePeriod(value: number, period: number): number {
    let result = value % period;
    if (result < 0) result += period;
    return result;
}

function normalizeSigned(value: number): number {
    let result = ((value + 180) % 360 + 360) % 360 - 180;
    if (Object.is(result, -0)) result = 0;
    return result;
}

function quantile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.floor((sorted.length - 1) * fraction)));
    return sorted[index];
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function inconclusive(reason: string): HexLatticeDetection {
    return { status: "inconclusive", fit: null, reason };
}

function gridless(reason: string): HexLatticeDetection {
    return { status: "gridless", fit: null, reason };
}