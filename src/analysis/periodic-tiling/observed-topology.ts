import { canonicalDSymbol, inspectDSymbol } from "../../resources/periodic-tiling/topology/d-symbol.js";
import { validateWireTopologyWitness, PeriodicWitnessValidationError } from "../../resources/periodic-tiling/topology/witness-validation.js";
import type { TranslationVector } from "./translations.js";
import type { InteriorObservation, ObservedPoint } from "./motif-interiors.js";

/** Internal experimental reconstruction, not an authenticated API detection result. */
export type ObservedBoundary = {
    sideIndex: number;
    targetClass: number;
    targetSide: number;
    translation: readonly [number, number];
    supportingObservations: number;
};
export type ObservedTopologicalCell = {
    classId: number;
    sides: number;
    boundaries: readonly ObservedBoundary[];
};
export type ObservedTopology =
    | { status: "derived"; dsSymbol: string; cells: readonly ObservedTopologicalCell[]; minimumEdgeObservations: number; minimumRegionSpan: number }
    | { status: "inconclusive" | "unsupported"; reason: string };

const sub = (a: ObservedPoint, b: ObservedPoint): ObservedPoint => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: ObservedPoint, b: ObservedPoint): number => a.x * b.x + a.y * b.y;
const cross = (a: ObservedPoint, b: ObservedPoint): number => a.x * b.y - a.y * b.x;
const norm = (a: ObservedPoint): number => Math.hypot(a.x, a.y);
const at = (polygon: readonly ObservedPoint[], side: number): readonly [ObservedPoint, ObservedPoint] =>
    [polygon[side], polygon[(side + 1) % polygon.length]];

/**
 * Compare opposing contour sides across a dark raster stroke. The white-region
 * boundaries need not coincide because the ink separates two interiors.
 * This implementation refuses T-junctions and incomplete side overlaps; a
 * more general incidence reconstruction must subdivide those boundaries.
 */
function counterpart(
    a: readonly [ObservedPoint, ObservedPoint],
    b: readonly [ObservedPoint, ObservedPoint],
    maxInkGap: number): number | null {
    const ab = sub(a[1], a[0]), cd = sub(b[1], b[0]);
    const lenA = norm(ab), lenB = norm(cd);
    if (lenA < 7 || lenB < 7) return null;
    const dir = { x: ab.x / lenA, y: ab.y / lenA };
    if (dot(ab, cd) / (lenA * lenB) > -0.97) return null;
    const distance1 = Math.abs(cross(dir, sub(b[0], a[0])));
    const distance2 = Math.abs(cross(dir, sub(b[1], a[0])));
    if (distance1 > maxInkGap || distance2 > maxInkGap) return null;
    const start = dot(sub(b[0], a[0]), dir), end = dot(sub(b[1], a[0]), dir);
    const overlap = Math.max(0, Math.min(lenA, Math.max(start, end)) - Math.max(0, Math.min(start, end)));
    const coverage = overlap / Math.min(lenA, lenB);
    if (coverage < 0.80) return null;
    // Prefer the matching full boundary over an unrelated parallel line.
    return Math.max(distance1, distance2) + (1 - coverage) * maxInkGap;
}

export type ObservedTopologyOptions = {
    maxInkGapPixels?: number;
    maxCells?: number;
    minObservationsPerEdge?: number;
};

/**
 * Derive the translation-quotient chamber graph from repeated observed polygon
 * interiors, by independent matching of all reciprocal raster boundaries.
 * A Euclidean D-symbol here is a consistency check on observed incidence,
 * NOT proof of a metric realization or complete original-raster verification.
 */
export function deriveObservedTopology(
    observation: InteriorObservation,
    basis: readonly [TranslationVector, TranslationVector],
    options: ObservedTopologyOptions = {}): ObservedTopology {
    const inconclusive = (reason: string): ObservedTopology => ({ status: "inconclusive", reason });
    const unsupported = (reason: string): ObservedTopology => ({ status: "unsupported", reason });
    const maxInkGap = options.maxInkGapPixels ?? 7;
    const maxCells = options.maxCells ?? 260;
    const minObservations = options.minObservationsPerEdge ?? 3;
    if (!Number.isFinite(maxInkGap) || maxInkGap < 1 || maxInkGap > 16 ||
        !Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 500 ||
        !Number.isSafeInteger(minObservations) || minObservations < 2 || minObservations > 30)
        return unsupported("Invalid or excessive topology search limits");
    if (observation.status !== "observed") return inconclusive("No reliable repeated polygon interiors");
    const interiors = observation.interiors;
    if (observation.classes.length === 0 || interiors.length === 0 ||
        observation.classes.some((c, i) => c.id !== i || !Number.isSafeInteger(c.sideCount) || c.sideCount < 3) ||
        interiors.some(cell => !Number.isSafeInteger(cell.motifClass) ||
            cell.motifClass < 0 || cell.motifClass >= observation.classes.length ||
            cell.polygon.length !== observation.classes[cell.motifClass].sideCount ||
            !Number.isFinite(cell.centroid.x) || !Number.isFinite(cell.centroid.y) ||
            cell.polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))))
        return unsupported("Malformed polygon observation or motif class references");
    if (interiors.length > maxCells || observation.classes.length > 24 ||
        interiors.some(cell => cell.polygon.length < 3 || cell.polygon.length > 12))
        return unsupported("Observed motif exceeds the bounded incidence complexity limit");
    const det = cross(basis[0], basis[1]);
    if (![basis[0].x, basis[0].y, basis[1].x, basis[1].y].every(Number.isFinite) || Math.abs(det) < 4)
        return unsupported("Invalid independent translation basis");
    const coordinates = (p: ObservedPoint): ObservedPoint => ({
        x: cross(p, basis[1]) / det, y: cross(basis[0], p) / det
    });
    const anchor = observation.classes.map(c => interiors.find(i => i.motifClass === c.id)?.centroid);
    if (anchor.some(p => !p)) return inconclusive("Not all motif classes have image instances");
    const addresses = interiors.map(cell => {
        const relative = coordinates(sub(cell.centroid, anchor[cell.motifClass]!));
        const u = Math.round(relative.x), v = Math.round(relative.y);
        const discrepancy = sub(relative, { x: u, y: v });
        return { u, v, discrepancy: norm(discrepancy) };
    });
    if (addresses.some(a => a.discrepancy > 0.08)) return inconclusive("Cell centers do not repeat under the proposed translation basis");

    type Vote = { targetClass: number; targetSide: number; shift: readonly [number, number]; points: ObservedPoint[] };
    const evidence = observation.classes.map(c => Array.from({ length: c.sideCount }, () => new Map<string, Vote>()));
    const perClass = observation.classes.map(() => new Set<string>());
    // There must be enough distant evidence to establish a motif, not a single
    // locally plausible patch. Retain the spatial positions of all votes.
    for (let i = 0; i < interiors.length; i++) {
        const from = interiors[i];
        const fromAddress = addresses[i];
        const id = `${fromAddress.u},${fromAddress.v}`;
        if (perClass[from.motifClass].has(id)) return inconclusive("Multiple observed cells occupy one motif address");
        perClass[from.motifClass].add(id);
        for (let side = 0; side < from.polygon.length; side++) {
            const segment = at(from.polygon, side);
            const hits: { target: number; side: number; score: number }[] = [];
            const midpoint = { x: (segment[0].x + segment[1].x) / 2, y: (segment[0].y + segment[1].y) / 2 };
            for (let j = 0; j < interiors.length; j++) {
                if (i === j) continue;
                const target = interiors[j];
                // Safe geometric pruning before considering each candidate side.
                if (norm(sub(target.centroid, midpoint)) > Math.max(60, norm(sub(segment[1], segment[0])) * 2 + 24)) continue;
                for (let candidate = 0; candidate < target.polygon.length; candidate++) {
                    const score = counterpart(segment, at(target.polygon, candidate), maxInkGap);
                    if (score != null) hits.push({ target: j, side: candidate, score });
                }
            }
            hits.sort((a, b) => a.score - b.score);
            if (hits.length > 1 && hits[1].score - hits[0].score < 1.0) return inconclusive("Ambiguous opposing boundaries");
            if (!hits.length) continue; // cropped raster edges will not have neighbors
            const chosen = hits[0];
            const neighbor = interiors[chosen.target], neighborAddress = addresses[chosen.target];
            const shift: readonly [number, number] = [neighborAddress.u - fromAddress.u, neighborAddress.v - fromAddress.v];
            const key = `${neighbor.motifClass}:${chosen.side}:${shift[0]}:${shift[1]}`;
            const votes = evidence[from.motifClass][side];
            const vote = votes.get(key) ?? { targetClass: neighbor.motifClass, targetSide: chosen.side, shift, points: [] };
            vote.points.push(from.centroid);
            votes.set(key, vote);
        }
    }
    const cells: ObservedTopologicalCell[] = [];
    let minimumEvidence = Infinity, minimumSpan = Infinity;
    for (const kind of observation.classes) {
        const boundaries: ObservedBoundary[] = [];
        for (let side = 0; side < kind.sideCount; side++) {
            const rankings = [...evidence[kind.id][side].values()].sort((a, b) => b.points.length - a.points.length);
            const winner = rankings[0];
            if (!winner || winner.points.length < minObservations)
                return inconclusive(`Insufficient repeated adjacency evidence at motif class ${kind.id} side ${side}`);
            const total = rankings.reduce((sum, v) => sum + v.points.length, 0);
            if (winner.points.length / total < 0.85)
                return inconclusive("Contradictory repeated boundary adjacency observations");
            const xs = winner.points.map(p => p.x), ys = winner.points.map(p => p.y);
            const widthSpan = (Math.max(...xs) - Math.min(...xs)) / Math.max(1, Math.sqrt(Math.abs(det)));
            const heightSpan = (Math.max(...ys) - Math.min(...ys)) / Math.max(1, Math.sqrt(Math.abs(det)));
            const span = Math.hypot(widthSpan, heightSpan);
            if (span < 1.4) return inconclusive("Adjacency is not supported by distant raster regions");
            minimumEvidence = Math.min(minimumEvidence, winner.points.length);
            minimumSpan = Math.min(minimumSpan, span);
            boundaries.push({ sideIndex: side, targetClass: winner.targetClass,
                targetSide: winner.targetSide, translation: winner.shift,
                supportingObservations: winner.points.length });
        }
        cells.push({ classId: kind.id, sides: kind.sideCount, boundaries });
    }
    for (const cell of cells) for (const edge of cell.boundaries) {
        const other = cells[edge.targetClass]?.boundaries[edge.targetSide];
        if (!other || other.targetClass !== cell.classId || other.targetSide !== edge.sideIndex ||
            other.translation[0] !== -edge.translation[0] || other.translation[1] !== -edge.translation[1])
            return inconclusive("Repeated motif boundaries do not pair reciprocally");
    }
    // 2 barycentric flags per polygon edge. This is a periodic translation
    // quotient, rather than a one-chamber symmetry symbol for regular lattices.
    const count = cells.reduce((sum, cell) => sum + 2 * cell.sides, 0);
    if (count > 2048) return unsupported("More than 2048 flags in motif");
    const starts: number[][] = [];
    let current = 1;
    for (const cell of cells) {
        starts[cell.classId] = Array.from({ length: cell.sides }, () => { const first = current; current += 2; return first; });
    }
    const s0 = new Array<number>(count + 1).fill(0);
    const s1 = new Array<number>(count + 1).fill(0);
    const s2 = new Array<number>(count + 1).fill(0);
    const m01 = new Array<number>(count + 1).fill(0);
    const m12 = new Array<number>(count + 1).fill(0);
    for (const cell of cells) for (let side = 0; side < cell.sides; side++) {
        const first = starts[cell.classId][side];
        const previous = starts[cell.classId][(side + cell.sides - 1) % cell.sides];
        const next = starts[cell.classId][(side + 1) % cell.sides];
        const target = cell.boundaries[side];
        const reciprocal = starts[target.targetClass][target.targetSide];
        s0[first] = first + 1; s0[first + 1] = first;
        s1[first] = previous + 1; s1[first + 1] = next;
        s2[first] = reciprocal + 1; s2[first + 1] = reciprocal;
        m01[first] = cell.sides; m01[first + 1] = cell.sides;
    }
    const visited = new Set<number>();
    for (let flag = 1; flag <= count; flag++) {
        if (visited.has(flag)) continue;
        const orbit = [flag]; visited.add(flag);
        for (let cursor = 0; cursor < orbit.length; cursor++) for (const map of [s1, s2]) {
            const next = map[orbit[cursor]];
            if (!next || next > count) return inconclusive("Incomplete vertex adjacency");
            if (!visited.has(next)) { visited.add(next); orbit.push(next); }
        }
        if (orbit.length % 2) return inconclusive("Odd vertex chamber orbit");
        for (const member of orbit) m12[member] = orbit.length / 2;
    }
    const result = inspectDSymbol(canonicalDSymbol([s0, s1, s2], m01, m12), 2048);
    if (result.status !== "euclidean")
        return inconclusive(`Observed chamber graph failed independent D-symbol validation (${result.status})`);
    // Reciprocal side matches alone cannot certify a connected primitive Z²
    // cover. Verify every vertex's periodic holonomy and reconstruct the exact
    // chamber graph rather than trusting its asserted D-symbol.
    try {
        validateWireTopologyWitness({
            contractVersion: 1, provenance: "observed-original-raster",
            quotientDsSymbol: result.symbol.canonical,
            translationDsSymbol: result.symbol.canonical,
            motifCells: cells.map(cell => ({
                id: `observed-${cell.classId}`,
                boundary: cell.boundaries.map(edge => ({
                    index: edge.sideIndex,
                    boundarySideIndex: edge.sideIndex,
                    targetMotifCellId: `observed-${edge.targetClass}`,
                    targetTranslation: {u: edge.translation[0], v: edge.translation[1]},
                    reciprocalInterfaceIndex: edge.targetSide
                }))
            }))
        });
    } catch (error) {
        if (!(error instanceof PeriodicWitnessValidationError)) throw error;
        return inconclusive(`Observed motif failed periodic topology verification: ${error.message}`);
    }
    // Do not elevate this to a fully detected identity until source-image
    // registration and joint global motif fit are independently verified.
    return { status: "derived", dsSymbol: result.symbol.canonical, cells,
        minimumEdgeObservations: minimumEvidence, minimumRegionSpan: minimumSpan };
}
