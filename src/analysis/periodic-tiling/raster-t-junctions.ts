import type { ObservedPoint } from "./motif-interiors.js";

type Point = ObservedPoint;
type Side = { owner: number; from: Point; to: Point; length: number };
export type TJunctionSplitting =
    | { status: "split"; polygons: Point[][]; restoredVertices: number }
    | { status: "inconclusive"; reason: string };

const CELL_SIZE = 48;
const pointKey = (x: number, y: number): string => `${x}:${y}`;
const len = (p: Point): number => Math.hypot(p.x, p.y);
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;

/**
 * Reconstruct explicitly subdivided long sides of a non-edge-to-edge periodic
 * tiling from independent opposing closed-cell contours. This never infers
 * boundaries from a pattern catalog and never locally warps the source raster.
 * A candidate split must be witnessed by a substantially overlapping,
 * antiparallel opposing side in another observed cell.
 */
export function splitObservedTJunctionSides(
    polygons: readonly (readonly Point[])[],
    options: { maxInkGapPixels?: number; maxPolygonSides?: number } = {}
): TJunctionSplitting {
    const maxInkGap = options.maxInkGapPixels ?? 6;
    const maxSides = options.maxPolygonSides ?? 12;
    if (!Number.isFinite(maxInkGap) || maxInkGap < 1 || maxInkGap > 10 ||
        !Number.isSafeInteger(maxSides) || maxSides < 3 || maxSides > 32 ||
        polygons.length > 2000 || polygons.some(poly => poly.length < 3 || poly.length > 32 ||
            poly.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))))
        return { status: "inconclusive", reason: "Invalid or excessive raster T-junction reconstruction input" };

    const bins = new Map<string, Side[]>();
    const bucket = (value: number): number => Math.floor(value / CELL_SIZE);
    for (let owner = 0; owner < polygons.length; owner++) {
        const polygon = polygons[owner];
        for (let i = 0; i < polygon.length; i++) {
            const from = polygon[i], to = polygon[(i + 1) % polygon.length];
            const length = len(subtract(to, from));
            if (length < 7) continue;
            const side: Side = { owner, from, to, length };
            const x0 = bucket(Math.min(from.x, to.x) - maxInkGap);
            const x1 = bucket(Math.max(from.x, to.x) + maxInkGap);
            const y0 = bucket(Math.min(from.y, to.y) - maxInkGap);
            const y1 = bucket(Math.max(from.y, to.y) + maxInkGap);
            // Bounded image contours; avoid memory amplification if a malformed
            // polygon introduces an unreasonably long coordinate range.
            if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256)
                return { status: "inconclusive", reason: "Raster boundary exceeds the bounded spatial index" };
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const k = pointKey(x, y), list = bins.get(k) ?? [];
                list.push(side);
                bins.set(k, list);
            }
        }
    }
    const result: Point[][] = [];
    let restoredVertices = 0;
    for (let owner = 0; owner < polygons.length; owner++) {
        const poly = polygons[owner], reconstructed: Point[] = [];
        for (let i = 0; i < poly.length; i++) {
            // Tiny raster contour segments were never indexed.
            const from = poly[i], to = poly[(i + 1) % poly.length];
            const delta = subtract(to, from), distance = len(delta);
            reconstructed.push(from);
            if (distance < 19) continue;
            const direction = { x: delta.x / distance, y: delta.y / distance };
            const startX = bucket(Math.min(from.x, to.x) - maxInkGap);
            const endX = bucket(Math.max(from.x, to.x) + maxInkGap);
            const startY = bucket(Math.min(from.y, to.y) - maxInkGap);
            const endY = bucket(Math.max(from.y, to.y) + maxInkGap);
            const candidates = new Set<Side>();
            for (let y = startY; y <= endY; y++) for (let x = startX; x <= endX; x++)
                for (const candidate of bins.get(pointKey(x, y)) ?? [])
                    if (candidate.owner !== owner) candidates.add(candidate);
            const splits: number[] = [];
            for (const other of candidates) {
                const opposing = subtract(other.to, other.from);
                // The separately traced white region lies on the opposite
                // side of the shared ink stroke, with reverse side direction.
                if (dot(direction, opposing) / other.length > -0.97) continue;
                const a = subtract(other.from, from), b = subtract(other.to, from);
                if (Math.abs(cross(direction, a)) > maxInkGap ||
                    Math.abs(cross(direction, b)) > maxInkGap) continue;
                const t0 = dot(a, direction), t1 = dot(b, direction);
                const covered = Math.max(0, Math.min(distance, Math.max(t0, t1)) -
                    Math.max(0, Math.min(t0, t1)));
                // A T-junction may also be produced by two long sides that
                // overlap only partly (e.g. staggered rectangular bricks).
                // An actual shared segment must still be substantial; short
                // near-tangent encounters do not count as incidence evidence.
                if (covered < Math.max(9, Math.min(distance, other.length) * 0.30))
                    continue;
                for (const t of [t0, t1]) {
                    if (t > 7 && t < distance - 7) splits.push(t);
                }
            }
            splits.sort((a, b) => a - b);
            let last = 0;
            for (const t of splits) {
                // Several neighboring cell boundaries may support the same
                // T-intersection with a few pixels of raster uncertainty.
                if (t - last < 7 || distance - t < 7) continue;
                const point = { x: from.x + direction.x * t, y: from.y + direction.y * t };
                reconstructed.push(point);
                restoredVertices++;
                last = t;
                if (reconstructed.length > maxSides)
                    return { status: "inconclusive", reason: "T-junction subdivision exceeds supported polygon complexity" };
            }
        }
        if (reconstructed.length > maxSides)
            return { status: "inconclusive", reason: "T-junction subdivision exceeds supported polygon complexity" };
        result.push(reconstructed);
    }
    return { status: "split", polygons: result, restoredVertices };
}
