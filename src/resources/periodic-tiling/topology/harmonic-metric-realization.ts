import { constructGeneralEuclideanTranslationCover } from "./general-quotient-unfolding.js";
import {
    verifyPeriodicWitness,
    type OperationalCover,
    type Point2,
    type PeriodicWitness
} from "./motif.js";

export type GeneralEuclideanMetricResult =
    | { status: "realized"; cover: OperationalCover; method: "periodic-harmonic-embedding-verified" }
    | { status: "unsupported" | "unresolved-geometry"; reason: string };

type Shift = readonly [number, number];
const plus = (a: Shift, b: Shift): Shift => [a[0] + b[0], a[1] + b[1]];
const opposite = (a: Shift): Shift => [-a[0], -a[1]];
const equal = (a: Shift, b: Shift): boolean => a[0] === b[0] && a[1] === b[1];

/** Small, deterministic symmetric Laplacian solver with fixed origin gauge. */
function solveReducedLaplacian(
    matrix: readonly (readonly number[])[],
    rhs: readonly number[]
): number[] | null {
    const n = rhs.length;
    if (n === 0) return [];
    const rows = matrix.map((row, i) => [...row, rhs[i]]);
    for (let pivot = 0; pivot < n; pivot++) {
        let chosen = pivot;
        for (let r = pivot + 1; r < n; r++)
            if (Math.abs(rows[r][pivot]) > Math.abs(rows[chosen][pivot]))
                chosen = r;
        if (Math.abs(rows[chosen][pivot]) < 1e-10) return null;
        if (chosen !== pivot) [rows[chosen], rows[pivot]] = [rows[pivot], rows[chosen]];
        const lead = rows[pivot][pivot];
        for (let c = pivot; c <= n; c++) rows[pivot][c] /= lead;
        for (let r = pivot + 1; r < n; r++) {
            const factor = rows[r][pivot];
            if (factor === 0) continue;
            for (let c = pivot; c <= n; c++) rows[r][c] -= factor * rows[pivot][c];
        }
    }
    const answer = new Array<number>(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
        let value = rows[r][n];
        for (let c = r + 1; c < n; c++) value -= rows[r][c] * answer[c];
        if (!Number.isFinite(value)) return null;
        answer[r] = value;
    }
    return answer;
}

/**
 * Attempt a metric realization of ANY accepted finite Euclidean D-symbol,
 * including nonuniform branched symmetry quotients, without a source image.
 *
 * Build the quotient vertex incidence from reciprocal polygon boundaries,
 * with every corner carrying an exact integer deck displacement. The
 * unique periodic harmonic embedding (modulo a global translation) minimizes
 * the squared edge lengths at a chosen period basis. All generated geometry
 * is subsequently checked by the independent overlap, exact chamber, edge
 * closure and primitive lattice validators. Harmonic embeddings can collapse
 * when the quotient graph is not sufficiently connected; such cases are
 * explicitly unresolved, not interpreted as invalid Euclidean symbols.
 */
export function realizeGeneralEuclideanQuotient(
    source: string,
    metric: {
        worldUnitsPerAbstractPeriod: number;
        units: string;
        rotationDegrees?: number;
        periodULength?: number;
        periodVLength?: number;
        periodAngleDegrees?: number;
    },
    chamberLimit = 1024
): GeneralEuclideanMetricResult {
    const unresolved = (reason: string): GeneralEuclideanMetricResult =>
        ({ status: "unresolved-geometry", reason });
    const {
        worldUnitsPerAbstractPeriod: worldScale, units, rotationDegrees = 0,
        periodULength = worldScale, periodVLength = worldScale,
        periodAngleDegrees = 90
    } = metric;
    if (!Number.isFinite(worldScale) || worldScale <= 1e-6 || worldScale > 1e6
        || !units?.trim() || !Number.isFinite(rotationDegrees) || Math.abs(rotationDegrees) > 3600)
        return unresolved("A finite positive period scale, world unit, and rotation are required");
    // Positive-determinant affine images preserve straight-edge incidence,
    // nonoverlap and the integer-addressed translation topology. An oblique
    // or anisotropic requested basis is therefore fitted before final proof.
    if (![periodULength, periodVLength, periodAngleDegrees].every(Number.isFinite)
        || periodULength <= 1e-6 || periodVLength <= 1e-6
        || periodULength > 1e6 || periodVLength > 1e6
        || periodAngleDegrees <= 0 || periodAngleDegrees >= 180)
        return unresolved("The requested period lengths and angle must define a bounded positive-area basis");
    const periodAngle = periodAngleDegrees * Math.PI / 180;
    const periodCosine = Math.cos(periodAngle), periodSine = Math.sin(periodAngle);
    if (periodSine <= 1e-8)
        return unresolved("The requested period angle collapses the fundamental domain");
    const abstract = constructGeneralEuclideanTranslationCover(source, chamberLimit);
    if (abstract.status !== "constructed")
        return abstract.status === "unsupported" || abstract.status === "invalid"
            ? { status: "unsupported", reason: abstract.reason }
            : unresolved(abstract.reason);
    const cells = abstract.primitiveCells;
    if (cells.length > 24)
        return unresolved("The geometric witness validator supports no more than 24 motif cells");
    const offsets = [0];
    for (const cell of cells) {
        if (cell.boundary.length < 3 || cell.boundary.length > 32)
            return unresolved("The bounded harmonic method requires 3–32 atomic sides per cell");
        offsets.push(offsets[offsets.length - 1] + cell.boundary.length);
    }
    const count = offsets[cells.length];
    if (count > 192)
        return unresolved("The bounded harmonic method requires at most 192 polygon corners");
    type CornerArc = { to: number; displacement: Shift };
    const graph: CornerArc[][] = Array.from({ length: count }, () => []);
    const connect = (a: number, b: number, t: Shift): void => {
        graph[a].push({ to: b, displacement: opposite(t) });
        graph[b].push({ to: a, displacement: t });
    };
    for (let c = 0; c < cells.length; c++) {
        const current = cells[c];
        for (let side = 0; side < current.boundary.length; side++) {
            const edge = current.boundary[side], target = cells[edge.targetCell];
            if (!target || edge.reciprocalEdge < 0 || edge.reciprocalEdge >= target.boundary.length)
                return unresolved("Incomplete translated polygon boundary incidence");
            const at = offsets[c] + side;
            const next = offsets[c] + (side + 1) % current.boundary.length;
            const oppositeStart = offsets[edge.targetCell] + edge.reciprocalEdge;
            const oppositeEnd = offsets[edge.targetCell] +
                (edge.reciprocalEdge + 1) % target.boundary.length;
            // Boundary orientation reverses across a paired interface.
            connect(at, oppositeEnd, edge.shift);
            connect(next, oppositeStart, edge.shift);
        }
    }
    const vertexOf = new Int32Array(count).fill(-1);
    const potential: Shift[] = Array.from({ length: count }, () => [0, 0]);
    const vertices: number[][] = [];
    for (let root = 0; root < count; root++) {
        if (vertexOf[root] >= 0) continue;
        const id = vertices.length, members = [root];
        vertexOf[root] = id;
        for (let i = 0; i < members.length; i++) {
            const at = members[i];
            for (const edge of graph[at]) {
                const displacement = plus(potential[at], edge.displacement);
                if (vertexOf[edge.to] < 0) {
                    vertexOf[edge.to] = id;
                    potential[edge.to] = displacement;
                    members.push(edge.to);
                } else if (vertexOf[edge.to] !== id || !equal(potential[edge.to], displacement))
                    return unresolved("Translated vertex gluing has nonclosing deck holonomy");
            }
        }
        vertices.push(members);
    }
    if (vertices.length < 1 || vertices.length > 96)
        return unresolved("Periodic quotient vertex count exceeds bounded harmonic solver capacity");

    const matrix = Array.from({ length: vertices.length }, () =>
        new Array<number>(vertices.length).fill(0));
    const x = new Array<number>(vertices.length).fill(0);
    const y = new Array<number>(vertices.length).fill(0);
    for (let c = 0; c < cells.length; c++) {
        for (let side = 0; side < cells[c].boundary.length; side++) {
            const at = offsets[c] + side;
            const next = offsets[c] + (side + 1) % cells[c].boundary.length;
            const a = vertexOf[at], b = vertexOf[next];
            if (a === b) continue;
            const shift: Shift = [potential[next][0] - potential[at][0],
                potential[next][1] - potential[at][1]];
            matrix[a][a]++; matrix[b][b]++;
            matrix[a][b]--; matrix[b][a]--;
            x[a] += shift[0]; y[a] += shift[1];
            x[b] -= shift[0]; y[b] -= shift[1];
        }
    }
    const reduced = matrix.slice(1).map(row => row.slice(1));
    const solX = solveReducedLaplacian(reduced, x.slice(1));
    const solY = solveReducedLaplacian(reduced, y.slice(1));
    if (!solX || !solY) return unresolved("The periodic quotient has a singular harmonic embedding");
    const coords: Point2[] = vertices.map((_, i) => ({
        x: i === 0 ? 0 : solX[i - 1],
        y: i === 0 ? 0 : solY[i - 1]
    }));
    const polygonCells = cells.map((cell, i) => {
        const points = cell.boundary.map((_, side) => {
            const at = offsets[i] + side, base = coords[vertexOf[at]];
            return { x: base.x + potential[at][0], y: base.y + potential[at][1] };
        });
        // Translating the entire polygon by an integer period leaves the
        // tiling unchanged, but keeps all representatives near the origin.
        const center = {
            x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
            y: points.reduce((sum, p) => sum + p.y, 0) / points.length
        };
        const ix = Math.round(center.x), iy = Math.round(center.y);
        return {
            id: `harmonic-${cell.id}`,
            polygon: points.map(p => ({ x: p.x - ix, y: p.y - iy }))
        };
    });
    const witness: PeriodicWitness = {
        basis: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
        units: "abstract",
        cells: polygonCells
    };
    let cover: OperationalCover;
    try {
        cover = verifyPeriodicWitness(source, witness);
        if (cover.translationSymbol !== abstract.translationDsSymbol)
            return unresolved("Harmonic realization changes the declared translational chamber graph");
    } catch (error) {
        return unresolved(`The harmonic polygon motif is not a verified periodic embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Construct an affine period basis and apply the same transform to every
    // polygon and reciprocal interface, then independently verify the result.
    const angle = rotationDegrees * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const transform = (p: Point2): Point2 => {
        const x = p.x * periodULength + p.y * periodVLength * periodCosine;
        const y = p.y * periodVLength * periodSine;
        return { x: x * cos - y * sin, y: x * sin + y * cos };
    };
    const transformed: OperationalCover = {
        ...cover, units,
        basis: [transform(cover.basis[0]), transform(cover.basis[1])],
        cells: cover.cells.map(cell => ({
            ...cell,
            polygon: cell.polygon.map(transform),
            boundary: cell.boundary.map(edge => ({
                ...edge,
                segment: [transform(edge.segment[0]), transform(edge.segment[1])] as const
            }))
        }))
    };
    try {
        const affineWitness: PeriodicWitness = {
            basis: transformed.basis, units: transformed.units,
            cells: transformed.cells.map(cell => ({ id: cell.id, polygon: cell.polygon }))
        };
        const independentlyVerified = verifyPeriodicWitness(source, affineWitness);
        if (independentlyVerified.translationSymbol !== abstract.translationDsSymbol)
            return unresolved("Affine metric fitting changed the translational chamber graph");
    } catch (error) {
        return unresolved(`The fitted affine polygons failed independent periodic verification: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { status: "realized", cover: transformed, method: "periodic-harmonic-embedding-verified" };
}
