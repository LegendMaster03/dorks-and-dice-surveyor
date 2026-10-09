import { inspectDSymbol } from "./d-symbol.js";
import { verifyPeriodicWitness, type OperationalCover, type PeriodicWitness, type Point2 } from "./motif.js";
import { validateWireTopologyWitness } from "./witness-validation.js";

/**
 * Construct a geometric translation cover by unfolding a one-chamber Euclidean
 * reflection orbifold. All polygon degrees and offsets come from the D-symbol;
 * there is no detector/nomenclature/pattern registry. This special case does
 * not solve generic multi-chamber orbifold unfolding or free metric parameters.
 */
export type ReflectionRealizationResult =
    | { status: "realized"; cover: OperationalCover; edgeLengthWorldUnits: number }
    | { status: "unsupported" | "unresolved-geometry"; reason: string };

const point = (x: number, y: number): Point2 => ({ x, y });
const sub = (a: Point2, b: Point2): Point2 => point(a.x - b.x, a.y - b.y);
const sum = (a: Point2, b: Point2): Point2 => point(a.x + b.x, a.y + b.y);
const scale = (a: Point2, k: number): Point2 => point(a.x * k, a.y * k);
const cross = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;
const dot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
const mag = (a: Point2): number => Math.hypot(a.x, a.y);
const center = (points: readonly Point2[]): Point2 => scale(points.reduce((a, b) => sum(a, b), point(0, 0)), 1 / points.length);
const rotate = (p: Point2, angle: number): Point2 => point(p.x * Math.cos(angle) - p.y * Math.sin(angle), p.x * Math.sin(angle) + p.y * Math.cos(angle));
const reflected = (p: Point2, a: Point2, b: Point2): Point2 => {
    const v = sub(b, a), q = sub(p, a);
    const projection = scale(v, dot(q, v) / dot(v, v));
    return sum(a, sub(scale(projection, 2), q));
};
const close = (a: Point2, b: Point2, epsilon: number): boolean => mag(sub(a, b)) <= epsilon;
const sameTranslatedPolygon = (polygon: readonly Point2[], reference: readonly Point2[], epsilon: number): boolean => {
    if (polygon.length !== reference.length) return false;
    const delta = sub(center(polygon), center(reference));
    return reference.every(p => polygon.some(q => close(q, sum(p, delta), epsilon)));
};

export function realizeOneChamberReflectionSymbol(
    source: string,
    constraints: { edgeLengthWorldUnits: number; units: string; rotationDegrees?: number }
): ReflectionRealizationResult {
    const unsupported = (reason: string): ReflectionRealizationResult => ({ status: "unsupported", reason });
    const unresolved = (reason: string): ReflectionRealizationResult => ({ status: "unresolved-geometry", reason });
    const parsed = inspectDSymbol(source);
    if (parsed.status !== "euclidean") return unsupported("A valid Euclidean D-symbol is required");
    const symbol = parsed.symbol;
    if (symbol.chamberCount !== 1 || symbol.involutions.some(map => map[1] !== 1))
        return unresolved("A general symmetry quotient requires independent unfolding and geometric constraints");
    const p = symbol.m01[1], q = symbol.m12[1];
    if ((p - 2) * (q - 2) !== 4)
        return unsupported("The one-chamber reflection symbol is not a Euclidean polygon tessellation");
    const { edgeLengthWorldUnits, units, rotationDegrees = 0 } = constraints;
    if (!Number.isFinite(edgeLengthWorldUnits) || edgeLengthWorldUnits <= 1e-6 || edgeLengthWorldUnits > 1e6
        || !units?.trim() || !Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees) > 3600)
        return unresolved("A finite positive polygon edge length, unit and rotation are required");
    // Solve the combinatorics at unit edge length. Similarity transformations
    // preserve nonoverlap, incidences and chamber identity, whereas geometric
    // tolerance tests directly on extreme user scales can be ill-conditioned.
    const radius = 1 / (2 * Math.sin(Math.PI / p));
    // Trigonometric zeros such as cos(π/2) are not represented exactly.
    // Suppress their machine-epsilon residue before reflecting polygons,
    // otherwise edges which should coincide can numerically overlap.
    const component = (value: number) => Math.abs(value) < radius * 1e-12 ? 0 : value;
    const seed = Array.from({ length: p }, (_, i) => point(component(radius * Math.cos(2 * Math.PI * i / p)), component(radius * Math.sin(2 * Math.PI * i / p))));
    type Face = { polygon: Point2[]; center: Point2 };
    const faces: Face[] = [{ polygon: seed, center: point(0, 0) }];
    const epsilon = 1e-6;
    // Breadth-first unfolding across actual shared edges, not shape-profile
    // registration. Five edge crossings give ample samples for the minimal
    // primitive translations and repeated polygon-class identification.
    let frontier = [faces[0]];
    for (let depth = 0; depth < 5; depth++) {
        const nextFrontier: Face[] = [];
        for (const face of frontier) for (let side = 0; side < p; side++) {
            const a = face.polygon[side], b = face.polygon[(side + 1) % p];
            const polygon = face.polygon.map(v => reflected(v, a, b)).reverse();
            const location = center(polygon);
            if (faces.some(other => close(other.center, location, epsilon))) continue;
            const addition = { polygon, center: location };
            faces.push(addition); nextFrontier.push(addition);
            if (faces.length > 250) return unsupported("Finite reflection patch exceeded the construction limit");
        }
        frontier = nextFrontier;
    }
    const vectors = faces.filter(f => mag(f.center) > epsilon && sameTranslatedPolygon(f.polygon, seed, epsilon))
        .map(f => f.center);
    const choices: { a: Point2; b: Point2; area: number; length: number }[] = [];
    for (let i = 0; i < vectors.length; i++) for (let j = i + 1; j < vectors.length; j++) {
        const det = cross(vectors[i], vectors[j]);
        if (Math.abs(det) <= epsilon * epsilon) continue;
        choices.push({a: vectors[i], b: vectors[j], area: Math.abs(det),
            length: mag(vectors[i]) ** 2 + mag(vectors[j]) ** 2});
    }
    const minimumArea = Math.min(...choices.map(choice => choice.area));
    // Equivalent lattice determinants are subject to floating-point reflection
    // noise. Prefer reduced, short primitive generators within a relative area
    // tolerance, rather than an arbitrarily long near-parallel basis.
    const primitive = choices.filter(choice => Math.abs(choice.area - minimumArea) <= minimumArea * 1e-5);
    primitive.sort((a, b) => a.length - b.length || a.a.x - b.a.x || a.a.y - b.a.y || a.b.x - b.b.x || a.b.y - b.b.y);
    const selected = primitive[0];
    if (!selected) return unsupported("Insufficient independent translation vectors in the bounded reflection patch");
    const basis = cross(selected.a, selected.b) > 0 ? [selected.a, selected.b] as const : [selected.b, selected.a] as const;
    const det = cross(basis[0], basis[1]);
    const inverse = (v: Point2): Point2 => point(cross(v, basis[1]) / det, cross(basis[0], v) / det);
    const groups: Array<{ fractional: Point2; polygon: Point2[]; location: Point2; squared: number }> = [];
    for (const face of faces) {
        const c = inverse(face.center);
        const residual = sub(c, point(Math.round(c.x), Math.round(c.y)));
        const squared = dot(c, c);
        const group = groups.find(g => close(g.fractional, residual, 1e-4));
        if (group) {
            if (!sameTranslatedPolygon(face.polygon, group.polygon, epsilon))
                return unsupported("A motif address contains inequivalent polygon interiors");
            if (squared < group.squared) { group.polygon = face.polygon; group.location = face.center; group.squared = squared; }
        } else {
            groups.push({ fractional: residual, polygon: face.polygon, location: face.center, squared });
        }
    }
    if (groups.length < 1 || groups.length > 24)
        return unsupported("The reflected translation motif exceeds the bounded cell count");
    const expectedArea = p * radius * radius * Math.sin(2 * Math.PI / p) / 2;
    if (Math.abs(groups.length * expectedArea - det) > det * 1e-5)
        return unsupported("Reflected polygons do not cover exactly one primitive translation unit");

    const witness: PeriodicWitness = {
        basis, units,
        cells: groups.map((g, i) => ({ id: `cell-${i}`, polygon: g.polygon }))
    };
    try {
        const normalized = verifyPeriodicWitness(source, witness);
        const angle = rotationDegrees * Math.PI / 180;
        const transform = (v: Point2): Point2 => scale(rotate(v, angle), edgeLengthWorldUnits);
        const cover: OperationalCover = {
            ...normalized,
            units,
            basis: [transform(normalized.basis[0]), transform(normalized.basis[1])],
            cells: normalized.cells.map(cell => ({
                ...cell,
                polygon: cell.polygon.map(transform),
                boundary: cell.boundary.map(edge => ({
                    ...edge,
                    segment: [transform(edge.segment[0]), transform(edge.segment[1])] as const
                }))
            }))
        };
        validateWireTopologyWitness({
            contractVersion: 1, provenance: "constructed-one-chamber-reflection",
            quotientDsSymbol: cover.quotientSymbol,
            translationDsSymbol: cover.translationSymbol,
            motifCells: cover.cells.map(cell => ({
                id: cell.id,
                boundary: cell.boundary.map(edge => ({
                    index: edge.edgeIndex, boundarySideIndex: edge.sideIndex,
                    targetMotifCellId: edge.target.motifCell,
                    targetTranslation: {u: edge.target.lattice[0], v: edge.target.lattice[1]},
                    reciprocalInterfaceIndex: edge.reciprocalEdgeIndex
                }))
            }))
        });
        return { status: "realized", cover, edgeLengthWorldUnits };
    } catch (error) {
        return unsupported(`Geometric reflection witness failed exact topology validation: ${error instanceof Error ? error.message : String(error)}`);
    }
}
