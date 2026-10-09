import type { GrayscaleRaster } from "../hex-grid/detector.js";
import type { InteriorObservation, ObservedPoint } from "./motif-interiors.js";
import type { TranslationVector } from "./translations.js";

export type RigidMotifFit =
    | { status: "supported"; maxVertexResidualPixels: number; rmsVertexResidualPixels: number;
        originalRasterEdgeSupport: number; supportedRegions: number; checkedCells: number }
    | { status: "inconclusive" | "unsupported"; reason: string };

export type RigidFitOptions = {
    maxVertexResidualPixels?: number;
    minimumRasterEdgeSupport?: number;
};

/**
 * Check an entire proposed translation motif against the untouched image.
 * One representative per motif class fixes every translated polygon vertex:
 * NO local refits, cumulative corrections, or synthetic image transformations.
 * This checks rigid registration, NOT full probabilistic image interpretation.
 */
export function verifyRigidMotifFit(
    raster: GrayscaleRaster,
    observation: InteriorObservation,
    basis: readonly [TranslationVector, TranslationVector],
    options: RigidFitOptions = {}
): RigidMotifFit {
    const inconclusive = (reason: string): RigidMotifFit => ({ status: "inconclusive", reason });
    const unsupported = (reason: string): RigidMotifFit => ({ status: "unsupported", reason });
    const maxResidual = options.maxVertexResidualPixels ?? 5.0;
    const minRasterSupport = options.minimumRasterEdgeSupport ?? 0.83;
    if (!Number.isFinite(maxResidual) || maxResidual < 0.5 || maxResidual > 12 ||
        !Number.isFinite(minRasterSupport) || minRasterSupport < 0.5 || minRasterSupport > 1)
        return unsupported("Invalid bounded metric verification options");
    const { width, height, pixels } = raster;
    if (observation.status !== "observed" || !observation.interiors.length ||
        !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || pixels.length !== width * height ||
        width * height > 1_500_000 || observation.interiors.length > 600)
        return unsupported("No bounded original raster and complete geometric observations");
    const [a, b] = basis, det = a.x * b.y - a.y * b.x;
    if (!Number.isFinite(det) || Math.abs(det) < 4)
        return unsupported("Invalid translation basis");
    const p = (x: number, y: number): ObservedPoint => ({ x, y });
    const representative = observation.classes.map(kind => observation.interiors.find(cell => cell.motifClass === kind.id));
    if (representative.some(x => !x)) return inconclusive("Unknown observed motif class");
    let worst = 0, sumSq = 0, vertexCount = 0, supported = 0, tested = 0;
    const seenRegions = new Set<number>();
    // Use samples distributed along every predicted side. Pixels within three
    // of its white-region contour should contain part of the original ink stroke.
    const darkNear = (x: number, y: number): boolean => {
        const cx = Math.round(x), cy = Math.round(y);
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const xx = cx + dx, yy = cy + dy;
            if (xx >= 0 && xx < width && yy >= 0 && yy < height && pixels[yy * width + xx] < 100)
                return true;
        }
        return false;
    };
    for (const cell of observation.interiors) {
        const example = representative[cell.motifClass];
        if (!example || cell.polygon.length !== example.polygon.length)
            return inconclusive("A motif class has inconsistent polygon corners");
        const dx = cell.centroid.x - example.centroid.x, dy = cell.centroid.y - example.centroid.y;
        const u = Math.round((dx * b.y - dy * b.x) / det);
        const v = Math.round((a.x * dy - a.y * dx) / det);
        const shift = p(u * a.x + v * b.x, u * a.y + v * b.y);
        for (let i = 0; i < cell.polygon.length; i++) {
            const predicted = p(example.polygon[i].x + shift.x, example.polygon[i].y + shift.y);
            const actual = cell.polygon[i];
            const residual = Math.hypot(actual.x - predicted.x, actual.y - predicted.y);
            if (!Number.isFinite(residual)) return unsupported("Nonfinite contour coordinate");
            worst = Math.max(worst, residual); sumSq += residual * residual; vertexCount++;
            const next = example.polygon[(i + 1) % example.polygon.length];
            // Do not mistake missing image evidence for a successful rigid fit.
            for (const t of [0.25, 0.5, 0.75]) {
                const x = predicted.x + (next.x - example.polygon[i].x) * t;
                const y = predicted.y + (next.y - example.polygon[i].y) * t;
                if (x < 4 || x >= width - 4 || y < 4 || y >= height - 4) continue;
                tested++;
                if (darkNear(x, y)) supported++;
            }
        }
        const region = Math.min(2, Math.floor(3 * cell.centroid.x / width)) +
            3 * Math.min(2, Math.floor(3 * cell.centroid.y / height));
        seenRegions.add(region);
    }
    if (tested < 100 || vertexCount < 24 || seenRegions.size < 4)
        return inconclusive("Too few distant original-image motif samples");
    if (worst > maxResidual)
        return inconclusive(`One rigid repeated motif drifts ${worst.toFixed(2)} pixels against the original raster`);
    const support = supported / tested;
    if (support < minRasterSupport)
        return inconclusive("Rigid motif edges are not consistently supported by source raster ink");
    return { status: "supported", maxVertexResidualPixels: worst,
        rmsVertexResidualPixels: Math.sqrt(sumSq / vertexCount), originalRasterEdgeSupport: support,
        supportedRegions: seenRegions.size, checkedCells: observation.interiors.length };
}
