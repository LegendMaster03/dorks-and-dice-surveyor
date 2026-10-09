import { canonicalDSymbol, inspectDSymbol, type DSymbol } from "./d-symbol.js";
import { projectChambers } from "./equivalence.js";

/** Coordinates below are world coordinates, never raster pixel coordinates. */
export type Point2 = { x: number; y: number };
export type LatticeShift = readonly [number, number];
export type MotifCell = { id: string; polygon: readonly Point2[] };
export type PeriodicWitness = {
    basis: readonly [Point2, Point2];
    cells: readonly MotifCell[];
    units: string;
};
export type CellAddress = { motifCell: string; lattice: LatticeShift };
export type BoundaryInterface = {
    edgeIndex: number;
    sideIndex: number;
    segment: readonly [Point2, Point2];
    target: CellAddress;
    reciprocalEdgeIndex: number;
};
export type OperationalCell = { id: string; polygon: readonly Point2[]; boundary: readonly BoundaryInterface[] };
export type OperationalCover = {
    kind: "witness-verified";
    quotientSymbol: string;
    translationSymbol: string;
    basis: readonly [Point2, Point2];
    units: string;
    cells: readonly OperationalCell[];
    quotientChamberProjection: readonly number[];
};
export class CoverValidationError extends Error {
    constructor(message: string) { super(message); this.name = "CoverValidationError"; }
}
const EPS = 1e-7;
const fail = (message: string): never => { throw new CoverValidationError(message); };
const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Point2, factor: number): Point2 => ({ x: a.x * factor, y: a.y * factor });
const cross = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;
const length = (a: Point2): number => Math.hypot(a.x, a.y);
const near = (a: Point2, b: Point2): boolean => length(sub(a, b)) < EPS;
const signedArea = (poly: readonly Point2[]): number => poly.reduce((v, p, i) => v + cross(p, poly[(i + 1) % poly.length]), 0) / 2;
const offset = (basis: PeriodicWitness["basis"], a: number, b: number): Point2 =>
    add(scale(basis[0], a), scale(basis[1], b));
const pointAt = (a: Point2, b: Point2, t: number): Point2 => add(a, scale(sub(b, a), t));
const onSegment = (p: Point2, a: Point2, b: Point2): boolean => {
    const delta = sub(b, a), from = sub(p, a);
    return Math.abs(cross(delta, from)) < EPS * Math.max(1, length(delta))
        && (from.x * delta.x + from.y * delta.y) >= -EPS
        && (from.x * delta.x + from.y * delta.y) <= delta.x * delta.x + delta.y * delta.y + EPS;
};
const parameter = (p: Point2, a: Point2, b: Point2): number => {
    const delta = sub(b, a);
    return ((p.x - a.x) * delta.x + (p.y - a.y) * delta.y) / (delta.x * delta.x + delta.y * delta.y);
};
const inside = (p: Point2, poly: readonly Point2[]): boolean => {
    let winding = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if (onSegment(p, a, b)) return false;
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
            winding = !winding;
    }
    return winding;
};
const properIntersection = (a: Point2, b: Point2, c: Point2, d: Point2): boolean => {
    const x = cross(sub(b, a), sub(c, a)), y = cross(sub(b, a), sub(d, a));
    const z = cross(sub(d, c), sub(a, c)), w = cross(sub(d, c), sub(b, c));
    return x * y < -(EPS * EPS) && z * w < -(EPS * EPS);
};
const intersectsInteriors = (left: readonly Point2[], right: readonly Point2[]): boolean => {
    for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) {
        if (properIntersection(left[i], left[(i + 1) % left.length], right[j], right[(j + 1) % right.length])) return true;
    }
    // Interior edge-offset samples also detect coincident polygons, including complete overlap.
    for (const [poly, other] of [[left, right], [right, left]]) {
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], delta = sub(b, a), l = length(delta);
            const sample = add(scale(add(a, b), 0.5), scale({ x: -delta.y, y: delta.x }, Math.min(EPS * 10, l / 1000) / l));
            if (inside(sample, other)) return true;
        }
    }
    return false;
};

type Atom = { start: Point2; end: Point2; sideIndex: number; target?: CellAddress; reciprocalEdgeIndex?: number };
type MutableCell = { id: string; polygon: Point2[]; edges: Atom[] };

/**
 * Builds a translation-addressable torus witness and proves that its chamber graph
 * covers a supplied D-symbol. This DOES NOT derive the translation subgroup from
 * an arbitrary D-symbol. Do not expose it as a general symbol-to-cover constructor.
 */
export function verifyPeriodicWitness(symbolText: string, witness: PeriodicWitness): OperationalCover {
    return constructWitness(witness, symbolText);
}
/** Derives a translation-group D-symbol from an explicit finite polygonal motif. */
export function deriveTranslationMotif(witness: PeriodicWitness): OperationalCover {
    return constructWitness(witness, null);
}
function constructWitness(witness: PeriodicWitness, symbolText: string | null): OperationalCover {
    const inspected = symbolText === null ? null : inspectDSymbol(symbolText);
    if (inspected !== null && inspected.status !== "euclidean") return fail(`D-symbol is not valid Euclidean topology: ${inspected.status}`);
    if (!witness.units?.trim()) fail("Geometric distance units are required");
    const basis = witness.basis;
    if (!basis || basis.length !== 2 || basis.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) fail("Invalid translation vectors");
    const det = cross(basis[0], basis[1]);
    if (!(Math.abs(det) > EPS)) fail("The two translations must be linearly independent");
    if (!witness.cells.length || witness.cells.length > 24) fail("Motif must contain 1–24 cells within this validated implementation limit");
    const ids = new Set<string>();
    const cells: MutableCell[] = witness.cells.map(cell => {
        if (!cell.id || ids.has(cell.id) || !/^[a-zA-Z0-9_-]+$/.test(cell.id)) fail("Motif cell IDs must be unique ASCII identifiers");
        ids.add(cell.id);
        if (cell.polygon.length < 3 || cell.polygon.length > 64) fail("Polygon must have 3–64 points");
        const polygon = cell.polygon.map(p => ({ x: p.x, y: p.y }));
        if (polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) fail("Nonfinite polygon point");
        if (polygon.some((p, i) => length(sub(p, polygon[(i + 1) % polygon.length])) < EPS)) fail("Zero-length polygon side");
        const area = signedArea(polygon);
        if (Math.abs(area) < EPS) fail("Zero-area polygon");
        if (area < 0) polygon.reverse();
        for (let i = 0; i < polygon.length; i++) for (let j = i + 1; j < polygon.length; j++) {
            if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
            if (properIntersection(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length]))
                fail("Self-intersecting polygon");
        }
        return { id: cell.id, polygon, edges: [] };
    });
    // Area is necessary but not sufficient; verify non-overlap and complete boundary pairing below.
    const areaSum = cells.reduce((s, c) => s + Math.abs(signedArea(c.polygon)), 0);
    if (Math.abs(areaSum - Math.abs(det)) > EPS * Math.max(1, Math.abs(det))) fail("Motif does not cover exactly one translation domain by area");
    // An edge in any one cell can meet cells two periods away only for unreasonably
    // far-spanning motifs. Bound the witness to its fundamental translation domain.
    const inverse = (p: Point2): Point2 => ({
        x: cross(p, basis[1]) / det,
        y: cross(basis[0], p) / det
    });
    for (const cell of cells) for (const p of cell.polygon) {
        const q = inverse(p);
        if (Math.abs(q.x) > 2.000001 || Math.abs(q.y) > 2.000001) fail("Motif polygons must lie within two basis lengths of the origin");
    }
    type Shifted = { id: string; shift: LatticeShift; polygon: Point2[] };
    const copies: Shifted[] = [];
    for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) {
        const o = offset(basis, u, v);
        for (const cell of cells) copies.push({ id: cell.id, shift: [u, v], polygon: cell.polygon.map(p => add(p, o)) });
    }
    // Compare each base cell only against other translates, not every O(n^2) pair of copies.
    for (const cell of cells) for (const copy of copies) {
        if (cell.id === copy.id && copy.shift[0] === 0 && copy.shift[1] === 0) continue;
        if (intersectsInteriors(cell.polygon, copy.polygon)) fail("Polygon interiors overlap in the periodic cover");
    }
    // Split any subdivided boundary at all periodic vertices (T junctions).
    for (const cell of cells) {
        for (let sideIndex = 0; sideIndex < cell.polygon.length; sideIndex++) {
            const a = cell.polygon[sideIndex], b = cell.polygon[(sideIndex + 1) % cell.polygon.length];
            const cuts = [0, 1];
            for (const copy of copies) for (const point of copy.polygon) {
                if (onSegment(point, a, b)) cuts.push(parameter(point, a, b));
            }
            cuts.sort((x, y) => x - y);
            const ordered = cuts.filter((t, i) => !i || t - cuts[i - 1] > EPS);
            for (let k = 0; k < ordered.length - 1; k++) {
                const start = pointAt(a, b, ordered[k]), end = pointAt(a, b, ordered[k + 1]);
                if (length(sub(end, start)) > EPS) cell.edges.push({ start, end, sideIndex });
            }
        }
        if (cell.edges.length > 256) fail("Excess boundary subdivisions");
    }
    // Derive every adjacency from geometry, never from a catalog or a declared neighbor list.
    for (const cell of cells) for (const edge of cell.edges) {
        const matches: { target: CellAddress; reciprocalEdgeIndex: number }[] = [];
        for (const copy of copies) {
            if (cell.id === copy.id && copy.shift[0] === 0 && copy.shift[1] === 0) continue;
            const target = cells.find(c => c.id === copy.id)!;
            const translation = offset(basis, copy.shift[0], copy.shift[1]);
            for (let i = 0; i < target.edges.length; i++) {
                const other = target.edges[i];
                if (near(edge.start, add(other.end, translation)) && near(edge.end, add(other.start, translation))) {
                    matches.push({ target: { motifCell: copy.id, lattice: copy.shift }, reciprocalEdgeIndex: i });
                }
            }
        }
        if (matches.length !== 1) fail(`Boundary pairing must be unique; found ${matches.length} at ${cell.id}`);
        edge.target = matches[0].target; edge.reciprocalEdgeIndex = matches[0].reciprocalEdgeIndex;
    }
    const byId = new Map(cells.map(c => [c.id, c]));
    for (const cell of cells) for (let e = 0; e < cell.edges.length; e++) {
        const a = cell.edges[e], b = byId.get(a.target!.motifCell)!.edges[a.reciprocalEdgeIndex!];
        if (!b.target || b.target.motifCell !== cell.id || b.reciprocalEdgeIndex !== e
            || b.target.lattice[0] !== -a.target!.lattice[0] || b.target.lattice[1] !== -a.target!.lattice[1])
            fail("Non-reciprocal boundary interface");
    }
    // Build barycentric flags (vertex, edge, cell) in a finite translation quotient.
    const starts = new Map<string, number>();
    let n = 0;
    for (const cell of cells) for (let i = 0; i < cell.edges.length; i++) {
        starts.set(`${cell.id}:${i}`, ++n); n++; // two flags per atomic boundary edge
    }
    if (n > 2048) fail("The translation quotient exceeds the 2048-flag safety limit");
    const maps: [number[], number[], number[]] = [new Array(n + 1).fill(0), new Array(n + 1).fill(0), new Array(n + 1).fill(0)];
    const m01 = new Array(n + 1).fill(0), m12 = new Array(n + 1).fill(0);
    for (const cell of cells) for (let i = 0; i < cell.edges.length; i++) {
        const start = starts.get(`${cell.id}:${i}`)!;
        const next = starts.get(`${cell.id}:${(i + 1) % cell.edges.length}`)!;
        const prev = starts.get(`${cell.id}:${(i + cell.edges.length - 1) % cell.edges.length}`)!;
        const edge = cell.edges[i];
        const peer = starts.get(`${edge.target!.motifCell}:${edge.reciprocalEdgeIndex}`)!;
        maps[0][start] = start + 1; maps[0][start + 1] = start;
        maps[1][start] = prev + 1; maps[1][start + 1] = next;
        maps[2][start] = peer + 1; maps[2][start + 1] = peer;
        m01[start] = cell.edges.length; m01[start + 1] = cell.edges.length;
    }
    // A vertex orbit is 2 * valence flags in a free translation quotient.
    const visited = new Set<number>();
    for (let flag = 1; flag <= n; flag++) {
        if (visited.has(flag)) continue;
        const q = [flag]; visited.add(flag);
        for (let p = 0; p < q.length; p++) for (const k of [1, 2]) {
            const next = maps[k][q[p]];
            if (!visited.has(next)) { visited.add(next); q.push(next); }
        }
        if (q.length % 2) fail("Vertex orbit has an invalid number of flags");
        for (const member of q) m12[member] = q.length / 2;
    }
    const translationSymbol = canonicalDSymbol(maps, m01, m12);
    const check = inspectDSymbol(translationSymbol, 2048);
    if (check.status !== "euclidean") return fail(`Derived translation chamber graph failed: ${check.status}`);
    const quotient: DSymbol = inspected?.status === "euclidean" ? inspected.symbol : check.symbol;
    // The finite translation chamber graph must cover the specified quotient.
    const projection = projectChambers(check.symbol, quotient);
    if (!projection) return fail("Geometric translation cover does not project onto the supplied D-symbol");
    return {
        kind: "witness-verified", quotientSymbol: quotient.canonical, translationSymbol,
        basis, units: witness.units,
        quotientChamberProjection: projection,
        cells: cells.map(cell => ({
            id: cell.id, polygon: cell.polygon,
            boundary: cell.edges.map((edge, i) => ({
                edgeIndex: i, sideIndex: edge.sideIndex,
                segment: [edge.start, edge.end] as const,
                target: edge.target!, reciprocalEdgeIndex: edge.reciprocalEdgeIndex!
            }))
        }))
    };
}

export function addressKey(address: CellAddress): string {
    if (![...address.lattice].every(Number.isSafeInteger)) fail("Non-exact lattice coordinate");
    return `${address.motifCell}@${address.lattice[0]},${address.lattice[1]}`;
}
export function adjacentAddress(address: CellAddress, boundary: BoundaryInterface): CellAddress {
    const u = address.lattice[0] + boundary.target.lattice[0];
    const v = address.lattice[1] + boundary.target.lattice[1];
    if (!Number.isSafeInteger(u) || !Number.isSafeInteger(v)) fail("Lattice coordinate exceeds exact integer range");
    return { motifCell: boundary.target.motifCell, lattice: [u, v] };
}
/** Bounded deterministic enumeration, including negative and nonzero translations. */
export function enumerateCells(cover: OperationalCover, minU: number, maxU: number, minV: number, maxV: number, limit = 10000): CellAddress[] {
    if (![minU, maxU, minV, maxV, limit].every(Number.isSafeInteger) || limit < 1 || minU > maxU || minV > maxV)
        fail("Invalid enumeration range");
    // The caller may lower the default limit, but must not disable the absolute
    // allocation bound by supplying Number.MAX_SAFE_INTEGER as its limit.
    if (limit > 100_000) fail("Enumeration limit exceeds the maximum safe cell count");
    const width = maxU - minU + 1, height = maxV - minV + 1;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) fail("Translation range exceeds safe integer precision");
    const total = width * height * cover.cells.length;
    if (!Number.isSafeInteger(total) || total > limit) fail("Requested region exceeds enumeration limit");
    const out: CellAddress[] = [];
    for (let du = 0; du < width; du++) for (let dv = 0; dv < height; dv++)
        for (const cell of cover.cells) out.push({ motifCell: cell.id, lattice: [minU + du, minV + dv] });
    return out;
}
