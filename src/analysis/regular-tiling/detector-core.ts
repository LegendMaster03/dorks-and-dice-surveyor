import {
    detectHexLattice,
    type GrayscaleRaster,
    type HexLatticeDetectionOptions,
    type HexLatticeOrientation
} from "../hex-grid/detector.js";

export type { GrayscaleRaster } from "../hex-grid/detector.js";

export type RegularTilingGeometryId =
    | "regular.triangular"
    | "regular.square"
    | "regular.hexagonal";

export type RegularLatticeDetectionOptions = HexLatticeDetectionOptions;

export type RegularLatticeFit = {
    geometryId: RegularTilingGeometryId;
    rotationDegrees: number;
    edgeLengthPixels: number;
    anchorPixel: { x: number; y: number };
    confidence: number;
    residualPixels: number;
    supportCoverage: number;
    orientationSupport: number;
    translationScore: number;
    competingTranslationScore: number;
    linePeriodicityScore: number;
    phaseScore: number;
    orientation?: HexLatticeOrientation;
    centerSpacingPixels?: number;
};

export type RegularLatticeDetection = {
    status: "detected" | "inconclusive" | "gridless";
    fit: RegularLatticeFit | null;
    reason: string;
};

type EdgeSample = { x: number; y: number; normal: number };
type EdgeField = {
    width: number;
    height: number;
    samples: EdgeSample[];
};
type OrientationCandidate = {
    degrees: number;
    familySamples: [EdgeSample[], EdgeSample[]];
    support: number;
};
type PeriodCandidate = {
    pitch: number;
    score: number;
    competitorScore: number;
    correlations: [Float64Array, Float64Array];
};
type SquareModelCandidate = {
    orientation: OrientationCandidate;
    period: PeriodCandidate;
    preference: number;
};
type PhaseEstimate = {
    anchor: { x: number; y: number };
    coherence: number;
    coverage: number;
};
type ResidualEstimate = {
    rms: number;
    worst: number;
    supportedRegions: number;
};

const PI = Math.PI;
const DEG = PI / 180;
const SQRT3 = Math.sqrt(3);
const ORIENTATION_TOLERANCE = 7 * DEG;
const MAX_LAG = 320;
const DISTANT_TILES = 3;

export function detectRegularLattice(
    raster: GrayscaleRaster,
    geometryId: RegularTilingGeometryId,
    options: RegularLatticeDetectionOptions = {}): RegularLatticeDetection {
    if (geometryId === "regular.hexagonal") return adaptHexagonal(raster, options);
    if (geometryId === "regular.triangular") return adaptTriangular(raster, options);
    return detectSquareLattice(raster, options);
}

function adaptHexagonal(
    raster: GrayscaleRaster,
    options: RegularLatticeDetectionOptions): RegularLatticeDetection {
    const detection = detectHexLattice(raster, options);
    if (!detection.fit) {
        return { status: detection.status, fit: null, reason: detection.reason };
    }
    const fit = detection.fit;
    return {
        status: detection.status,
        reason: detection.reason,
        fit: {
            geometryId: "regular.hexagonal",
            orientation: fit.orientation,
            rotationDegrees: fit.rotationDegrees,
            centerSpacingPixels: fit.centerSpacingPixels,
            edgeLengthPixels: fit.centerSpacingPixels / SQRT3,
            anchorPixel: fit.anchorPixel,
            confidence: fit.confidence,
            residualPixels: fit.residualPixels,
            supportCoverage: fit.supportCoverage,
            orientationSupport: fit.orientationSupport,
            translationScore: fit.translationScore,
            competingTranslationScore: fit.competingTranslationScore,
            linePeriodicityScore: fit.linePeriodicityScore,
            phaseScore: fit.phaseScore
        }
    };
}

function adaptTriangular(
    raster: GrayscaleRaster,
    options: RegularLatticeDetectionOptions): RegularLatticeDetection {
    // A triangular grid and a hexagonal grid expose the same three 60-degree edge
    // families. Reuse the proven three-family detector, but convert its natural
    // hex-centre spacing to the triangular edge length before returning the fit.
    const scaledOptions: RegularLatticeDetectionOptions = {
        ...options,
        ...(options.minimumSpacingPixels == null
            ? {}
            : { minimumSpacingPixels: options.minimumSpacingPixels * SQRT3 }),
        ...(options.maximumSpacingPixels == null
            ? {}
            : { maximumSpacingPixels: options.maximumSpacingPixels * SQRT3 })
    };
    const detection = detectHexLattice(raster, scaledOptions);
    if (!detection.fit) {
        return {
            status: detection.status,
            fit: null,
            reason: triangularReason(detection.reason)
        };
    }

    const fit = detection.fit;
    const absoluteNormal = fit.orientation === "PointyTop"
        ? fit.rotationDegrees
        : 30 + fit.rotationDegrees;
    return {
        status: detection.status,
        reason: detection.status === "detected"
            ? `Detected a triangular lattice with ${(fit.centerSpacingPixels / SQRT3).toFixed(2)} px edge length.`
            : triangularReason(detection.reason),
        fit: {
            geometryId: "regular.triangular",
            rotationDegrees: normalizeCentered(absoluteNormal, 60),
            edgeLengthPixels: fit.centerSpacingPixels / SQRT3,
            anchorPixel: fit.anchorPixel,
            confidence: fit.confidence,
            residualPixels: fit.residualPixels,
            supportCoverage: fit.supportCoverage,
            orientationSupport: fit.orientationSupport,
            translationScore: fit.translationScore,
            competingTranslationScore: fit.competingTranslationScore,
            linePeriodicityScore: fit.linePeriodicityScore,
            phaseScore: fit.phaseScore
        }
    };
}

function triangularReason(reason: string): string {
    return reason
        .replace(/hex(?:agonal)?[- ]grid/gi, "triangular lattice")
        .replace(/hex(?:agonal)?[- ]lattice/gi, "triangular lattice");
}

function detectSquareLattice(
    raster: GrayscaleRaster,
    options: RegularLatticeDetectionOptions): RegularLatticeDetection {
    validateRaster(raster);
    const minimumSpacing = Math.max(8, Math.floor(options.minimumSpacingPixels ?? 12));
    const maximumSpacing = Math.min(
        Math.floor(Math.min(raster.width, raster.height) / 2),
        Math.floor(options.maximumSpacingPixels ?? Number.POSITIVE_INFINITY));
    if (maximumSpacing <= minimumSpacing + 2) {
        return { status: "inconclusive", fit: null, reason: "The raster is too small to establish repeated square-grid spacing." };
    }

    const started = performance.now();
    const field = buildEdgeField(raster, options.maximumEdgeSamples ?? 90_000);
    options.timingSink?.("edge-field", performance.now() - started);
    if (field.samples.length < 500) {
        return { status: "gridless", fit: null, reason: "The raster does not contain enough edge evidence for a square lattice." };
    }

    const modelCandidate = findSquareModel(field, minimumSpacing, maximumSpacing);
    if (!modelCandidate || modelCandidate.orientation.support < 0.08) {
        return { status: "gridless", fit: null, reason: "Raster edges do not form two strong perpendicular line families with a stable shared period." };
    }
    const refinedOrientation = modelCandidate.orientation;
    const period = modelCandidate.period;
    if (period.score < 0.30) {
        return { status: "gridless", fit: null, reason: "Perpendicular edge families do not share a stable square-grid period." };
    }

    const pitch = refineSharedPitch(period);
    const phase = estimateSquarePhase(refinedOrientation, pitch, raster.width, raster.height);
    const residual = measureSquareResidual(field, refinedOrientation.degrees, pitch, phase.anchor);
    const orientationConfidence = clamp01((refinedOrientation.support - 0.08) / 0.55);
    const periodicityConfidence = clamp01((period.score - 0.25) / 0.55);
    const phaseConfidence = clamp01((phase.coherence - 0.20) / 0.70);
    const residualConfidence = clamp01(1 - residual.worst / Math.max(1.5, pitch * 0.10));
    const uniqueness = clamp01((period.score - period.competitorScore) / 0.18);
    const confidence = clamp01(
        orientationConfidence * 0.22
        + periodicityConfidence * 0.24
        + phaseConfidence * 0.18
        + residualConfidence * 0.20
        + uniqueness * 0.10
        + phase.coverage * 0.06);

    const fit: RegularLatticeFit = {
        geometryId: "regular.square",
        rotationDegrees: normalizeCentered(refinedOrientation.degrees, 90),
        edgeLengthPixels: pitch,
        anchorPixel: phase.anchor,
        confidence,
        residualPixels: residual.worst,
        supportCoverage: phase.coverage,
        orientationSupport: refinedOrientation.support,
        translationScore: phase.coherence,
        competingTranslationScore: period.competitorScore,
        linePeriodicityScore: period.score,
        phaseScore: phase.coherence
    };

    const threshold = options.minimumConfidence ?? 0.52;
    const excessiveResidual = residual.worst > Math.max(2, pitch * 0.08);
    if (confidence < threshold || residual.supportedRegions < 6 || excessiveResidual) {
        return {
            status: "inconclusive",
            fit,
            reason: confidence < threshold
                ? `A repeated square lattice was found, but confidence ${confidence.toFixed(2)} is below the ${threshold.toFixed(2)} automatic-apply threshold.`
                : residual.supportedRegions < 6
                    ? "A repeated local square pattern was found, but too few distant image regions support one stable rigid lattice."
                    : `A repeated square lattice was found, but the final rigid overlay misses at least one distant region by ${residual.worst.toFixed(2)} px.`
        };
    }

    return {
        status: "detected",
        fit,
        reason: `Detected a square lattice with ${pitch.toFixed(2)} px edge length.`
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
    const magnitudes = new Float32Array(raster.width * raster.height);
    const normals = new Float32Array(raster.width * raster.height);
    const sampled: number[] = [];
    for (let y = 1; y < raster.height - 1; y++) {
        for (let x = 1; x < raster.width - 1; x++) {
            const i = y * raster.width + x;
            const top = i - raster.width;
            const bottom = i + raster.width;
            const gx = -raster.pixels[top - 1] + raster.pixels[top + 1]
                - 2 * raster.pixels[i - 1] + 2 * raster.pixels[i + 1]
                - raster.pixels[bottom - 1] + raster.pixels[bottom + 1];
            const gy = -raster.pixels[top - 1] - 2 * raster.pixels[top] - raster.pixels[top + 1]
                + raster.pixels[bottom - 1] + 2 * raster.pixels[bottom] + raster.pixels[bottom + 1];
            const magnitude = Math.hypot(gx, gy);
            magnitudes[i] = magnitude;
            normals[i] = normalizeHalfTurn(Math.atan2(gy, gx));
            if ((x & 1) === 0 && (y & 1) === 0 && magnitude > 0) sampled.push(magnitude);
        }
    }
    if (sampled.length === 0) return { width: raster.width, height: raster.height, samples: [] };
    sampled.sort((a, b) => a - b);
    const threshold = Math.max(6, quantile(sampled, 0.55));
    const candidates: EdgeSample[] = [];
    for (let y = 1; y < raster.height - 1; y++) {
        for (let x = 1; x < raster.width - 1; x++) {
            const i = y * raster.width + x;
            if (magnitudes[i] >= threshold) candidates.push({ x, y, normal: normals[i] });
        }
    }
    if (candidates.length <= maxSamples) return { width: raster.width, height: raster.height, samples: candidates };
    const result: EdgeSample[] = [];
    const step = candidates.length / maxSamples;
    for (let index = 0; index < maxSamples; index++) result.push(candidates[Math.floor(index * step)]);
    return { width: raster.width, height: raster.height, samples: result };
}

function findSquareModel(
    field: EdgeField,
    minimumSpacing: number,
    maximumSpacing: number): SquareModelCandidate | null {
    const orientations = Array.from({ length: 90 }, (_, degrees) =>
        evaluateSquareOrientation(field, degrees));
    const maximumSupport = Math.max(...orientations.map(candidate => candidate.support));
    if (maximumSupport <= 0) return null;

    let best: SquareModelCandidate | null = null;
    for (const orientation of orientations) {
        if (orientation.support < maximumSupport * 0.40) continue;
        const period = fitSquarePeriod(field, orientation, minimumSpacing, maximumSpacing);
        if (!period) continue;
        const preference = squareModelPreference(orientation, period, maximumSupport);
        if (!best || preference > best.preference) best = { orientation, period, preference };
    }
    if (!best) return null;

    const seed = best.orientation.degrees;
    for (let delta = -1; delta <= 1.0001; delta += 0.25) {
        const orientation = evaluateSquareOrientation(field, normalizePeriod(seed + delta, 90));
        if (orientation.support < maximumSupport * 0.40) continue;
        const period = fitSquarePeriod(field, orientation, minimumSpacing, maximumSpacing);
        if (!period) continue;
        const preference = squareModelPreference(orientation, period, maximumSupport);
        if (preference > best.preference) best = { orientation, period, preference };
    }
    return best;
}

function squareModelPreference(
    orientation: OrientationCandidate,
    period: PeriodCandidate,
    maximumSupport: number): number {
    const supportRatio = clamp01(orientation.support / Math.max(1e-9, maximumSupport));
    return period.score * (0.35 + 0.65 * supportRatio);
}

function evaluateSquareOrientation(field: EdgeField, degrees: number): OrientationCandidate {
    const first = degrees * DEG;
    const second = first + PI / 2;
    const families: [EdgeSample[], EdgeSample[]] = [[], []];
    for (const sample of field.samples) {
        const firstDistance = halfTurnDistance(sample.normal, first);
        const secondDistance = halfTurnDistance(sample.normal, second);
        const distance = Math.min(firstDistance, secondDistance);
        if (distance > ORIENTATION_TOLERANCE) continue;
        families[firstDistance <= secondDistance ? 0 : 1].push(sample);
    }
    const low = Math.min(families[0].length, families[1].length);
    const high = Math.max(families[0].length, families[1].length);
    const support = (low * 0.65 + high * 0.35) / Math.max(1, field.samples.length / 2);
    return {
        degrees,
        familySamples: families,
        support: clamp01(support)
    };
}

function fitSquarePeriod(
    field: EdgeField,
    orientation: OrientationCandidate,
    minimumSpacing: number,
    maximumSpacing: number): PeriodCandidate | null {
    const maxLag = Math.min(MAX_LAG, Math.floor(Math.min(field.width, field.height) / 2));
    const minimumPitch = Math.max(4, minimumSpacing);
    const maximumPitch = Math.min(maximumSpacing, Math.floor(maxLag / 2));
    if (maximumPitch <= minimumPitch + 1) return null;
    const correlations = orientation.familySamples.map((samples, family) =>
        projectionAutocorrelation(samples, (orientation.degrees * DEG) + family * PI / 2, maxLag)) as [Float64Array, Float64Array];

    const scored: Array<{ pitch: number; score: number }> = [];
    for (let pitch = minimumPitch; pitch <= maximumPitch; pitch++) {
        const first = harmonicScore(correlations[0], pitch);
        const second = harmonicScore(correlations[1], pitch);
        scored.push({ pitch, score: Math.min(first, second) * 0.60 + Math.max(first, second) * 0.40 });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return null;
    const competitor = scored.find(candidate => Math.abs(candidate.pitch - best.pitch) >= Math.max(2, best.pitch * 0.12));
    return {
        pitch: best.pitch,
        score: best.score,
        competitorScore: competitor?.score ?? 0,
        correlations
    };
}

function projectionAutocorrelation(samples: EdgeSample[], normal: number, maxLag: number): Float64Array {
    const rhos = samples.map(sample => sample.x * Math.cos(normal) + sample.y * Math.sin(normal));
    if (rhos.length < 120) return new Float64Array(maxLag + 1);
    let minimumRho = Number.POSITIVE_INFINITY;
    let maximumRho = Number.NEGATIVE_INFINITY;
    for (const rho of rhos) {
        minimumRho = Math.min(minimumRho, rho);
        maximumRho = Math.max(maximumRho, rho);
    }
    const minimum = Math.floor(minimumRho);
    const maximum = Math.ceil(maximumRho);
    const profile = new Float64Array(Math.max(1, maximum - minimum + 5));
    for (const rho of rhos) {
        const index = Math.round(rho) - minimum + 2;
        if (index >= 0 && index < profile.length) profile[index] += 1;
    }
    const smooth = smoothProfile(smoothProfile(profile));
    const baseline = movingAverage(smooth, 8);
    const residual = new Float64Array(smooth.length);
    for (let index = 0; index < smooth.length; index++) residual[index] = smooth[index] - baseline[index];
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

function harmonicScore(curve: Float64Array, pitch: number): number {
    let weighted = 0;
    let totalWeight = 0;
    for (let harmonic = 1; harmonic <= 3; harmonic++) {
        const weight = 1 / harmonic;
        const center = pitch * harmonic;
        let value = 0;
        for (let offset = -1; offset <= 1; offset++) {
            const index = center + offset;
            if (index >= 3 && index < curve.length) value = Math.max(value, curve[index]);
        }
        weighted += Math.max(0, value) * weight;
        totalWeight += weight;
    }
    return totalWeight > 0 ? weighted / totalWeight : 0;
}

function refineSharedPitch(period: PeriodCandidate): number {
    const pitch = period.pitch;
    const curve = new Float64Array(Math.max(period.correlations[0].length, period.correlations[1].length));
    for (let i = 0; i < curve.length; i++) {
        curve[i] = ((period.correlations[0][i] ?? 0) + (period.correlations[1][i] ?? 0)) / 2;
    }
    if (pitch <= 0 || pitch >= curve.length - 1) return pitch;
    const left = curve[pitch - 1];
    const center = curve[pitch];
    const right = curve[pitch + 1];
    const denominator = left - 2 * center + right;
    if (Math.abs(denominator) < 1e-9) return pitch;
    return pitch + Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator));
}

function estimateSquarePhase(
    orientation: OrientationCandidate,
    pitch: number,
    width: number,
    height: number): PhaseEstimate {
    const radians = orientation.degrees * DEG;
    const normals = [
        { x: Math.cos(radians), y: Math.sin(radians) },
        { x: Math.cos(radians + PI / 2), y: Math.sin(radians + PI / 2) }
    ] as const;
    const offsets: number[] = [];
    const coherences: number[] = [];
    for (let family = 0; family < 2; family++) {
        let x = 0;
        let y = 0;
        for (const sample of orientation.familySamples[family]) {
            const rho = sample.x * normals[family].x + sample.y * normals[family].y;
            const phase = 2 * PI * rho / pitch;
            x += Math.cos(phase);
            y += Math.sin(phase);
        }
        const count = orientation.familySamples[family].length;
        const phase = Math.atan2(y, x);
        offsets.push(normalizePeriod(phase / (2 * PI) * pitch, pitch));
        coherences.push(count > 0 ? Math.hypot(x, y) / count : 0);
    }
    const anchor = {
        x: (offsets[0] + pitch / 2) * normals[0].x + (offsets[1] + pitch / 2) * normals[1].x,
        y: (offsets[0] + pitch / 2) * normals[0].y + (offsets[1] + pitch / 2) * normals[1].y
    };
    return {
        anchor: wrapAnchor(anchor, normals, pitch, width, height),
        coherence: (coherences[0] + coherences[1]) / 2,
        coverage: clamp01((orientation.familySamples[0].length + orientation.familySamples[1].length)
            / Math.max(1, width * height * 0.08))
    };
}

function wrapAnchor(
    anchor: { x: number; y: number },
    normals: readonly [{ x: number; y: number }, { x: number; y: number }],
    pitch: number,
    width: number,
    height: number): { x: number; y: number } {
    let best = anchor;
    let bestDistance = Number.POSITIVE_INFINITY;
    const target = { x: width / 2, y: height / 2 };
    for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
            const candidate = {
                x: anchor.x + i * pitch * normals[0].x + j * pitch * normals[1].x,
                y: anchor.y + i * pitch * normals[0].y + j * pitch * normals[1].y
            };
            const distance = Math.hypot(candidate.x - target.x, candidate.y - target.y);
            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
    }
    return best;
}

function measureSquareResidual(
    field: EdgeField,
    degrees: number,
    pitch: number,
    anchor: { x: number; y: number }): ResidualEstimate {
    const radians = degrees * DEG;
    const normals = [radians, radians + PI / 2];
    const regionResiduals: number[][] = Array.from({ length: DISTANT_TILES * DISTANT_TILES }, () => []);
    for (let family = 0; family < 2; family++) {
        const normal = normals[family];
        const cos = Math.cos(normal);
        const sin = Math.sin(normal);
        const expected = 2 * PI * (((anchor.x * cos + anchor.y * sin) / pitch) + 0.5);
        for (let ty = 0; ty < DISTANT_TILES; ty++) {
            for (let tx = 0; tx < DISTANT_TILES; tx++) {
                let x = 0;
                let y = 0;
                let count = 0;
                for (const sample of field.samples) {
                    if (halfTurnDistance(sample.normal, normal) > ORIENTATION_TOLERANCE) continue;
                    if (sample.x < tx * field.width / DISTANT_TILES
                        || sample.x >= (tx + 1) * field.width / DISTANT_TILES
                        || sample.y < ty * field.height / DISTANT_TILES
                        || sample.y >= (ty + 1) * field.height / DISTANT_TILES) continue;
                    const phase = 2 * PI * (sample.x * cos + sample.y * sin) / pitch;
                    x += Math.cos(phase);
                    y += Math.sin(phase);
                    count++;
                }
                if (count < 20) continue;
                const coherence = Math.hypot(x, y) / count;
                if (coherence < 0.04) continue;
                const local = Math.atan2(y, x);
                const residual = Math.abs(circularDistance(local, expected)) / (2 * PI) * pitch;
                regionResiduals[ty * DISTANT_TILES + tx].push(residual);
            }
        }
    }
    const supported = regionResiduals
        .filter(values => values.length === 2)
        .map(values => (values[0] + values[1]) / 2);
    const rms = supported.length
        ? Math.sqrt(supported.reduce((sum, value) => sum + value * value, 0) / supported.length)
        : pitch / 2;
    return {
        rms,
        worst: supported.length ? Math.max(...supported) : pitch / 2,
        supportedRegions: supported.length
    };
}

function smoothProfile(values: Float64Array): Float64Array {
    const result = new Float64Array(values.length);
    for (let index = 0; index < values.length; index++) {
        result[index] = (values[Math.max(0, index - 1)] + 2 * values[index]
            + values[Math.min(values.length - 1, index + 1)]) / 4;
    }
    return result;
}

function movingAverage(values: Float64Array, radius: number): Float64Array {
    const result = new Float64Array(values.length);
    const prefix = new Float64Array(values.length + 1);
    for (let index = 0; index < values.length; index++) prefix[index + 1] = prefix[index] + values[index];
    for (let index = 0; index < values.length; index++) {
        const start = Math.max(0, index - radius);
        const end = Math.min(values.length, index + radius + 1);
        result[index] = (prefix[end] - prefix[start]) / Math.max(1, end - start);
    }
    return result;
}

function circularDistance(a: number, b: number): number {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
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

function normalizeCentered(value: number, period: number): number {
    const normalized = normalizePeriod(value, period);
    return normalized <= period / 2 ? normalized : normalized - period;
}

function quantile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
    return sorted[index];
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
