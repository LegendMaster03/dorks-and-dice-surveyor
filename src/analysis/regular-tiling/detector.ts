import {
    detectRegularLattice as detectRegularLatticeCore,
    type GrayscaleRaster,
    type RegularLatticeDetection,
    type RegularLatticeDetectionOptions,
    type RegularLatticeFit,
    type RegularTilingGeometryId
} from "./detector-core.js";

export type {
    GrayscaleRaster,
    RegularLatticeDetection,
    RegularLatticeDetectionOptions,
    RegularLatticeFit,
    RegularTilingGeometryId
} from "./detector-core.js";

const PI = Math.PI;
const DEG = PI / 180;
const SQRT3 = Math.sqrt(3);
const OCCUPANCY_ORIENTATION_TOLERANCE = 20 * DEG;
const MINIMUM_OCCUPANCY_SUPPORT = 0.10;
const TRIANGULAR_CONTINUITY_MINIMUM = 0.62;
const HEXAGONAL_CONTINUITY_MAXIMUM = 0.52;

type OrientedEdgeEvidence = {
    width: number;
    height: number;
    strength: Float32Array;
    normal: Float32Array;
};

type HoneycombOccupancy = {
    edgeSupport: number;
    gapSupport: number;
    continuityRatio: number;
    edgeSamples: number;
    gapSamples: number;
};

export function detectRegularLattice(
    raster: GrayscaleRaster,
    geometryId: RegularTilingGeometryId,
    options: RegularLatticeDetectionOptions = {}): RegularLatticeDetection {
    assertRegularGeometryId(geometryId);
    const detection = detectRegularLatticeCore(raster, geometryId, options);
    if (geometryId === "regular.square" || detection.status !== "detected" || !detection.fit) {
        return detection;
    }

    const model = threeFamilyModel(detection.fit, geometryId);
    const evidence = buildOrientedEdgeEvidence(raster);
    const occupancy = measureHoneycombOccupancy(
        evidence,
        model.baseNormalDegrees,
        model.centerSpacingPixels,
        detection.fit.anchorPixel);

    if (occupancy.edgeSamples < 24
        || occupancy.gapSamples < 24
        || occupancy.edgeSupport < MINIMUM_OCCUPANCY_SUPPORT) {
        return detection;
    }

    if (geometryId === "regular.hexagonal"
        && occupancy.continuityRatio > TRIANGULAR_CONTINUITY_MINIMUM) {
        return {
            ...detection,
            status: "inconclusive",
            reason: "The three-family period fits a Regular lattice, but edge evidence continues through locations where a hexagonal honeycomb should contain gaps. The raster is more consistent with the triangular 3^6 tiling."
        };
    }

    if (geometryId === "regular.triangular"
        && occupancy.continuityRatio < HEXAGONAL_CONTINUITY_MAXIMUM) {
        return {
            ...detection,
            status: "inconclusive",
            reason: "The three-family period fits a Regular lattice, but edge evidence is segmented at locations where triangular carrier lines should remain continuous. The raster is more consistent with the hexagonal 6^3 tiling."
        };
    }

    return detection;
}

function assertRegularGeometryId(value: unknown): asserts value is RegularTilingGeometryId {
    if (value !== "regular.triangular"
        && value !== "regular.square"
        && value !== "regular.hexagonal") {
        throw new Error(`Unsupported Regular tiling geometry '${String(value)}'.`);
    }
}

function threeFamilyModel(
    fit: RegularLatticeFit,
    geometryId: "regular.triangular" | "regular.hexagonal"): {
    baseNormalDegrees: number;
    centerSpacingPixels: number;
} {
    if (geometryId === "regular.triangular") {
        return {
            baseNormalDegrees: fit.rotationDegrees,
            centerSpacingPixels: fit.edgeLengthPixels * SQRT3
        };
    }

    if (fit.orientation == null || fit.centerSpacingPixels == null) {
        throw new Error("Hexagonal Regular fit is missing its legacy orientation or center spacing.");
    }
    return {
        baseNormalDegrees: fit.orientation === "PointyTop"
            ? fit.rotationDegrees
            : 30 + fit.rotationDegrees,
        centerSpacingPixels: fit.centerSpacingPixels
    };
}

function buildOrientedEdgeEvidence(raster: GrayscaleRaster): OrientedEdgeEvidence {
    validateRaster(raster);
    const size = raster.width * raster.height;
    const magnitude = new Float32Array(size);
    const normal = new Float32Array(size);
    const sampledMagnitudes: number[] = [];

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
            const value = Math.hypot(gx, gy);
            magnitude[i] = value;
            normal[i] = normalizeHalfTurn(Math.atan2(gy, gx));
            if ((x & 1) === 0 && (y & 1) === 0 && value > 0) sampledMagnitudes.push(value);
        }
    }

    sampledMagnitudes.sort((left, right) => left - right);
    const normalizer = Math.max(1, quantile(sampledMagnitudes, 0.90));
    const strength = new Float32Array(size);
    for (let index = 0; index < size; index++) {
        strength[index] = Math.min(1, magnitude[index] / normalizer);
    }
    return { width: raster.width, height: raster.height, strength, normal };
}

function measureHoneycombOccupancy(
    evidence: OrientedEdgeEvidence,
    baseNormalDegrees: number,
    centerSpacingPixels: number,
    anchor: { x: number; y: number }): HoneycombOccupancy {
    if (!Number.isFinite(centerSpacingPixels) || centerSpacingPixels <= 0) {
        return {
            edgeSupport: 0,
            gapSupport: 0,
            continuityRatio: 1,
            edgeSamples: 0,
            gapSamples: 0
        };
    }

    const basis = baseNormalDegrees * DEG;
    const u = {
        x: centerSpacingPixels * Math.cos(basis),
        y: centerSpacingPixels * Math.sin(basis)
    };
    const v = {
        x: centerSpacingPixels * Math.cos(basis + PI / 3),
        y: centerSpacingPixels * Math.sin(basis + PI / 3)
    };
    const radius = centerSpacingPixels / SQRT3;
    const cornerStart = basis - PI / 6;
    const reach = Math.ceil(Math.hypot(evidence.width, evidence.height) / centerSpacingPixels) + 4;

    let edgeTotal = 0;
    let edgeSamples = 0;
    let gapTotal = 0;
    let gapSamples = 0;

    for (let i = -reach; i <= reach; i++) {
        for (let j = -reach; j <= reach; j++) {
            const center = {
                x: anchor.x + i * u.x + j * v.x,
                y: anchor.y + i * u.y + j * v.y
            };
            if (center.x < -centerSpacingPixels || center.y < -centerSpacingPixels
                || center.x > evidence.width + centerSpacingPixels
                || center.y > evidence.height + centerSpacingPixels) continue;

            const corners = Array.from({ length: 6 }, (_, index) => {
                const angle = cornerStart + index * PI / 3;
                return {
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                };
            });

            for (let edge = 0; edge < 6; edge++) {
                const a = corners[edge];
                const b = corners[(edge + 1) % 6];
                const edgeNormal = normalizeHalfTurn(Math.atan2(b.y - a.y, b.x - a.x) + PI / 2);

                for (const t of [0.25, 0.5, 0.75]) {
                    const point = pointAlong(a, b, t);
                    const support = orientedStrengthAt(evidence, point.x, point.y, edgeNormal);
                    if (support == null) continue;
                    edgeTotal += support;
                    edgeSamples++;
                }

                // A honeycomb edge stops at each vertex. The collinear continuation
                // immediately beyond the edge is empty until the next separated segment,
                // whereas a triangular tiling continues along the same carrier line.
                for (const t of [1.30, 1.55, 1.80]) {
                    const point = pointAlong(a, b, t);
                    const support = orientedStrengthAt(evidence, point.x, point.y, edgeNormal);
                    if (support == null) continue;
                    gapTotal += support;
                    gapSamples++;
                }
            }
        }
    }

    const edgeSupport = edgeSamples > 0 ? edgeTotal / edgeSamples : 0;
    const gapSupport = gapSamples > 0 ? gapTotal / gapSamples : 0;
    return {
        edgeSupport,
        gapSupport,
        continuityRatio: gapSupport / Math.max(0.05, edgeSupport),
        edgeSamples,
        gapSamples
    };
}

function pointAlong(
    a: { x: number; y: number },
    b: { x: number; y: number },
    t: number): { x: number; y: number } {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t
    };
}

function orientedStrengthAt(
    evidence: OrientedEdgeEvidence,
    x: number,
    y: number,
    expectedNormal: number): number | null {
    if (x < 3 || y < 3 || x >= evidence.width - 3 || y >= evidence.height - 3) return null;
    const cx = Math.round(x);
    const cy = Math.round(y);
    let best = 0;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const index = (cy + dy) * evidence.width + (cx + dx);
            const distance = halfTurnDistance(evidence.normal[index], expectedNormal);
            if (distance > OCCUPANCY_ORIENTATION_TOLERANCE) continue;
            const orientationWeight = Math.max(0, Math.cos(distance));
            best = Math.max(best, evidence.strength[index] * orientationWeight);
        }
    }
    return best;
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

function halfTurnDistance(a: number, b: number): number {
    const delta = Math.abs(normalizeHalfTurn(a) - normalizeHalfTurn(b));
    return Math.min(delta, PI - delta);
}

function normalizeHalfTurn(value: number): number {
    let result = value % PI;
    if (result < 0) result += PI;
    return result;
}

function quantile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.floor((sorted.length - 1) * fraction)));
    return sorted[index];
}
