import { inspectDSymbol, type DSymbol } from "./d-symbol.js";
import { realizeOneChamberReflectionSymbol } from "./reflection-realization.js";
import { unfoldUniformEuclideanQuotient } from "./uniform-quotient-unfolding.js";
import { verifyPeriodicWitness, type OperationalCover, type Point2 } from "./motif.js";
import { validateWireTopologyWitness } from "./witness-validation.js";

export type UniformQuotientMetricResult =
    | { status: "realized"; cover: OperationalCover; method: "verified-fiber-product-geometric-lift" }
    | { status: "unsupported" | "unresolved-geometry"; reason: string };

type IntegerPoint = readonly [number, number];
type Side = { target: number; seedShift: IntegerPoint; abstractShift: IntegerPoint };
const plus = (a: IntegerPoint, b: IntegerPoint): IntegerPoint => [a[0] + b[0], a[1] + b[1]];
const minus = (a: IntegerPoint, b: IntegerPoint): IntegerPoint => [a[0] - b[0], a[1] - b[1]];
const determinant = (a: IntegerPoint, b: IntegerPoint): number => a[0] * b[1] - a[1] * b[0];
const same = (a: IntegerPoint, b: IntegerPoint): boolean => a[0] === b[0] && a[1] === b[1];
const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point2, k: number): Point2 => ({ x: a.x * k, y: a.y * k });
const combination = (basis: readonly [Point2, Point2], v: IntegerPoint): Point2 =>
    add(scale(basis[0], v[0]), scale(basis[1], v[1]));

/**
 * The seed polygon motif has an explicit barycentric two-flag representation
 * for each directed boundary interface. Construct that chamber action from
 * geometry; do not assume its chamber numbering matches the canonical symbol.
 */
function seedFlags(cover: OperationalCover): {
    maps: readonly [number[], number[], number[]];
    owner: readonly number[];
    edgeIndex: readonly number[];
} {
    const starts: number[][] = [];
    let n = 0;
    for (const cell of cover.cells) {
        starts.push(cell.boundary.map(() => { n += 2; return n - 1; }));
    }
    const maps: [number[], number[], number[]] = [
        new Array(n + 1).fill(0), new Array(n + 1).fill(0), new Array(n + 1).fill(0)
    ];
    const owner = new Array<number>(n + 1).fill(-1);
    const edgeIndex = new Array<number>(n + 1).fill(-1);
    const byId = new Map(cover.cells.map((cell, i) => [cell.id, i]));
    for (let c = 0; c < cover.cells.length; c++) {
        const cell = cover.cells[c], startsForCell = starts[c];
        for (let i = 0; i < cell.boundary.length; i++) {
            const flag = startsForCell[i], edge = cell.boundary[i];
            const target = byId.get(edge.target.motifCell);
            if (target === undefined) throw Error("Unknown seed motif cell");
            const peer = starts[target][edge.reciprocalEdgeIndex];
            if (peer === undefined) throw Error("Unknown seed reciprocal edge");
            maps[0][flag] = flag + 1; maps[0][flag + 1] = flag;
            maps[1][flag] = startsForCell[(i + cell.boundary.length - 1) % cell.boundary.length] + 1;
            maps[1][flag + 1] = startsForCell[(i + 1) % cell.boundary.length];
            maps[2][flag] = peer + 1; maps[2][flag + 1] = peer;
            owner[flag] = owner[flag + 1] = c;
            edgeIndex[flag] = edgeIndex[flag + 1] = i;
        }
    }
    return { maps, owner, edgeIndex };
}

/** Build a chamber-graph isomorphism from geometry-derived flag numbers to canonical flag numbers. */
function matchSeedFlags(raw: ReturnType<typeof seedFlags>, symbol: DSymbol): number[] | null {
    const n = raw.owner.length - 1;
    if (n !== symbol.chamberCount) return null;
    for (let root = 1; root <= n; root++) {
        const mapping = new Array<number>(n + 1).fill(0), inverse = new Array<number>(n + 1).fill(0);
        mapping[1] = root; inverse[root] = 1;
        const queue = [1];
        let valid = true;
        for (let i = 0; i < queue.length && valid; i++) {
            const rawFlag = queue[i], mappedFlag = mapping[rawFlag];
            for (let k = 0; k < 3; k++) {
                const nextRaw = raw.maps[k][rawFlag], nextCanonical = symbol.involutions[k][mappedFlag];
                if (!mapping[nextRaw]) {
                    if (inverse[nextCanonical]) { valid = false; break; }
                    mapping[nextRaw] = nextCanonical;
                    inverse[nextCanonical] = nextRaw;
                    queue.push(nextRaw);
                } else if (mapping[nextRaw] !== nextCanonical) { valid = false; break; }
            }
        }
        if (valid && queue.length === n) return inverse;
    }
    return null;
}

function quotientFaces(symbol: DSymbol): { which: number[]; orbits: number[][] } {
    const which = new Array<number>(symbol.chamberCount + 1).fill(-1), orbits: number[][] = [];
    for (let start = 1; start <= symbol.chamberCount; start++) {
        if (which[start] !== -1) continue;
        const orbit = [start], id = orbits.length; which[start] = id;
        for (let i = 0; i < orbit.length; i++) for (const k of [0, 1]) {
            const next = symbol.involutions[k][orbit[i]];
            if (which[next] === -1) { which[next] = id; orbit.push(next); }
        }
        orbits.push(orbit);
    }
    return { which, orbits };
}

/**
 * Constructs polygons for a supported regular, possibly multi-chamber
 * Euclidean symmetry quotient solely from its D-symbol and metric constraints.
 *
 * Map the verified product torus onto the regular reflection torus. Its edge
 * displacements yield two integer cocycles: seed-lattice displacement and
 * abstract primitive Z² displacement. Solving their exact cycle equations
 * gives the finite-index seed sublattice. Lift source polygons to that lattice
 * and verify the WHOLE metric cover, not individual faces or local matches.
 *
 * Nonuniform local orders, unproven holonomy, incompatible metrics and shapes
 * outside the bounded 24-cell metric validator remain unresolved.
 */
export function realizeUniformEuclideanQuotient(
    source: string,
    constraints: { edgeLengthWorldUnits: number; units: string; rotationDegrees?: number },
    chamberLimit = 768
): UniformQuotientMetricResult {
    const unresolved = (reason: string): UniformQuotientMetricResult => ({ status: "unresolved-geometry", reason });
    const topology = unfoldUniformEuclideanQuotient(source, chamberLimit);
    if (topology.status !== "constructed")
        return topology.status === "unsupported" || topology.status === "invalid"
            ? { status: "unsupported", reason: topology.reason }
            : unresolved(topology.reason);
    if (topology.primitiveCells.length > 24)
        return unresolved("This quotient exceeds the bounded 24-cell metric witness limit");
    const seedResult = realizeOneChamberReflectionSymbol(topology.baseReflectionSymbol, constraints);
    if (seedResult.status !== "realized") return unresolved(seedResult.reason);
    const seedCover = seedResult.cover, seed = inspectDSymbol(seedCover.translationSymbol, 1024);
    const expanded = inspectDSymbol(topology.translationDsSymbol, chamberLimit);
    if (seed.status !== "euclidean" || expanded.status !== "euclidean")
        return unresolved("The verified chamber factors are not Euclidean");
    const raw = seedFlags(seedCover), seedInverse = matchSeedFlags(raw, seed.symbol);
    if (!seedInverse) return unresolved("Geometric seed flags do not match the reflection torus");
    // Compose the projection through the canonical seed symbol. Canonical
    // chamber numbering never needs to agree with geometric edge numbering.
    const seedProjection = new Array<number>(expanded.symbol.chamberCount + 1).fill(0);
    const productToSeed = (() => {
        const cover = expanded.symbol, quotient = seed.symbol;
        for (let root = 1; root <= quotient.chamberCount; root++) {
            const mapping = new Array<number>(cover.chamberCount + 1).fill(0);
            mapping[1] = root;
            const queue = [1]; let valid = true;
            for (let i = 0; i < queue.length && valid; i++) {
                const sourceFlag = queue[i], dest = mapping[sourceFlag];
                if (cover.m01[sourceFlag] !== quotient.m01[dest]
                    || cover.m12[sourceFlag] !== quotient.m12[dest]) { valid = false; break; }
                for (let k = 0; k < 3; k++) {
                    const src = cover.involutions[k][sourceFlag], dst = quotient.involutions[k][dest];
                    if (!mapping[src]) { mapping[src] = dst; queue.push(src); }
                    else if (mapping[src] !== dst) { valid = false; break; }
                }
            }
            if (valid && queue.length === cover.chamberCount) return mapping;
        }
        return null;
    })();
    if (!productToSeed) return unresolved("The product cover does not project onto the geometric seed");
    for (let i = 1; i < seedProjection.length; i++) {
        seedProjection[i] = seedInverse[productToSeed[i]];
        if (!seedProjection[i]) return unresolved("A projected flag has no geometric counterpart");
    }

    const { which, orbits } = quotientFaces(expanded.symbol);
    if (orbits.length !== topology.primitiveCells.length)
        return unresolved("The expanded chamber faces disagree with its abstract translation cover");
    const parity = new Int8Array(expanded.symbol.chamberCount + 1), queue = [1]; parity[1] = 1;
    for (let i = 0; i < queue.length; i++) for (const map of expanded.symbol.involutions) {
        const next = map[queue[i]], sign = -parity[queue[i]];
        if (!parity[next]) { parity[next] = sign; queue.push(next); }
        else if (parity[next] !== sign) return unresolved("The expanded cover is not consistently orientable");
    }
    const faceToSeed = new Array<number>(orbits.length), sides: Side[][] = [];
    for (let face = 0; face < orbits.length; face++) {
        const motif = topology.primitiveCells[face], orbit = orbits[face];
        let flag = orbit.find(c => parity[c] === 1);
        if (flag === undefined) return unresolved("A translated face lacks an oriented chamber");
        const first = flag, edges: Side[] = [];
        faceToSeed[face] = raw.owner[seedProjection[flag]];
        for (let i = 0; i < motif.boundary.length; i++) {
            const rawFlag = seedProjection[flag], seedFace = raw.owner[rawFlag];
            const seedEdge = seedCover.cells[seedFace].boundary[raw.edgeIndex[rawFlag]];
            const inferredTarget = which[expanded.symbol.involutions[2][flag]];
            const edge = motif.boundary[i];
            if (seedFace !== faceToSeed[face] || inferredTarget !== edge.targetCell
                || seedCover.cells[faceToSeed[edge.targetCell]]?.id === "") {
                // faceToSeed for other faces is resolved after this loop.
                if (seedFace !== faceToSeed[face] || inferredTarget !== edge.targetCell)
                    return unresolved("An expanded boundary does not project onto the stated seed edge");
            }
            edges.push({
                target: edge.targetCell,
                seedShift: [seedEdge.target.lattice[0], seedEdge.target.lattice[1]],
                abstractShift: edge.shift
            });
            flag = expanded.symbol.involutions[1][expanded.symbol.involutions[0][flag]];
        }
        if (flag !== first || edges.length !== seedCover.cells[faceToSeed[face]].boundary.length)
            return unresolved("An unfolded regular face has inconsistent polygon side order");
        sides.push(edges);
    }
    for (let c = 0; c < sides.length; c++) for (const edge of sides[c]) {
        if (seedCover.cells[faceToSeed[edge.target]].id !==
            seedCover.cells[faceToSeed[c]].boundary.find(b =>
                b.target.motifCell === seedCover.cells[faceToSeed[edge.target]].id)?.target.motifCell) {
            // Multiple edges may target the same seed face; full translated
            // interface consistency is proved by the metric validator below.
        }
    }

    const seedPositions: Array<IntegerPoint | undefined> = new Array(sides.length);
    const abstractPositions: Array<IntegerPoint | undefined> = new Array(sides.length);
    seedPositions[0] = [0, 0]; abstractPositions[0] = [0, 0];
    const spanning = [0];
    for (let i = 0; i < spanning.length; i++) {
        const from = spanning[i], a = seedPositions[from]!, b = abstractPositions[from]!;
        for (const edge of sides[from]) {
            if (seedPositions[edge.target] !== undefined) continue;
            seedPositions[edge.target] = plus(a, edge.seedShift);
            abstractPositions[edge.target] = plus(b, edge.abstractShift);
            spanning.push(edge.target);
        }
    }
    if (spanning.length !== sides.length) return unresolved("The finite geometric cover is disconnected");
    const cycles: { abstract: IntegerPoint; seed: IntegerPoint }[] = [];
    for (let c = 0; c < sides.length; c++) for (const edge of sides[c]) {
        cycles.push({
            abstract: minus(plus(abstractPositions[c]!, edge.abstractShift), abstractPositions[edge.target]!),
            seed: minus(plus(seedPositions[c]!, edge.seedShift), seedPositions[edge.target]!)
        });
    }
    let matrix: readonly [IntegerPoint, IntegerPoint] | null = null;
    for (let i = 0; i < cycles.length && !matrix; i++) for (let j = i + 1; j < cycles.length; j++) {
        const x = cycles[i], y = cycles[j], det = determinant(x.abstract, y.abstract);
        if (!det) continue;
        // Matrix columns give the seed-torus lattice displacement for each
        // one-unit abstract deck translation. Reject nonintegral monodromy.
        const u: IntegerPoint = [
            (x.seed[0] * y.abstract[1] - y.seed[0] * x.abstract[1]) / det,
            (x.seed[1] * y.abstract[1] - y.seed[1] * x.abstract[1]) / det
        ];
        const v: IntegerPoint = [
            (y.seed[0] * x.abstract[0] - x.seed[0] * y.abstract[0]) / det,
            (y.seed[1] * x.abstract[0] - x.seed[1] * y.abstract[0]) / det
        ];
        if ([...u, ...v].every(Number.isSafeInteger)) matrix = [u, v];
    }
    if (!matrix || !determinant(matrix[0], matrix[1]))
        return unresolved("The projected cover does not generate an independent rank-two metric lattice");
    const transform = (v: IntegerPoint): IntegerPoint =>
        plus([matrix![0][0] * v[0], matrix![0][1] * v[0]],
             [matrix![1][0] * v[1], matrix![1][1] * v[1]]);
    if (cycles.some(c => !same(transform(c.abstract), c.seed)))
        return unresolved("The geometric and abstract translation cocycles disagree");
    const degree = expanded.symbol.chamberCount / seed.symbol.chamberCount;
    if (!Number.isSafeInteger(degree) || Math.abs(determinant(matrix[0], matrix[1])) !== degree)
        return unresolved("The projected geometric lattice is not a primitive finite-sheeted torus cover");

    // Reduce an arbitrary tree/cotree basis to short period vectors. Each
    // operation is an integer unimodular column operation, so no covering
    // information or lattice primitiveness can change.
    let a = matrix[0], b = matrix[1];
    const physical = (v: IntegerPoint) => combination(seedCover.basis, v);
    const length2 = (v: IntegerPoint) => { const p = physical(v); return p.x * p.x + p.y * p.y; };
    for (let i = 0; i < 48; i++) {
        if (length2(b) < length2(a)) [a, b] = [b, a];
        const A = physical(a), B = physical(b);
        const nearest = Math.round((A.x * B.x + A.y * B.y) / length2(a));
        if (nearest === 0) break;
        b = minus(b, [a[0] * nearest, a[1] * nearest]);
        if (![...a, ...b].every(Number.isSafeInteger))
            return unresolved("The reduced lattice exceeds exact integer coordinate precision");
    }
    if (determinant(a, b) < 0) [a, b] = [b, a];
    const chosen: readonly [IntegerPoint, IntegerPoint] = [a, b];
    const chosenDet = determinant(a, b);
    if (chosenDet <= 0) return unresolved("The metric translation vectors have invalid orientation");

    const cells = seedPositions.map((position, i) => {
        const sourceCell = seedCover.cells[faceToSeed[i]];
        // Choose a stable representative of every lifted seed-cell orbit near
        // the geometric fundamental domain. Reducing a cell by a period is
        // harmless because its integer lattice address changes accordingly.
        const fractionalX = determinant(position!, b) / chosenDet;
        const fractionalY = determinant(a, position!) / chosenDet;
        const snapped = minus(position!, plus(
            [a[0] * Math.round(fractionalX), a[1] * Math.round(fractionalX)],
            [b[0] * Math.round(fractionalY), b[1] * Math.round(fractionalY)]));
        const offset = combination(seedCover.basis, snapped);
        return { id: `lift-${i}`, polygon: sourceCell.polygon.map(p => add(p, offset)) };
    });
    const witness = {
        basis: [physical(a), physical(b)] as readonly [Point2, Point2],
        units: constraints.units,
        cells
    };
    try {
        const cover = verifyPeriodicWitness(source, witness);
        if (cover.translationSymbol !== topology.translationDsSymbol)
            return unresolved("Geometric lifting produced a different primitive chamber cover");
        validateWireTopologyWitness({
            contractVersion: 1,
            provenance: "verified-fiber-product-geometric-lift",
            quotientDsSymbol: cover.quotientSymbol,
            translationDsSymbol: cover.translationSymbol,
            motifCells: cover.cells.map(cell => ({
                id: cell.id,
                boundary: cell.boundary.map(edge => ({
                    index: edge.edgeIndex,
                    boundarySideIndex: edge.sideIndex,
                    targetMotifCellId: edge.target.motifCell,
                    targetTranslation: { u: edge.target.lattice[0], v: edge.target.lattice[1] },
                    reciprocalInterfaceIndex: edge.reciprocalEdgeIndex
                }))
            }))
        });
        return { status: "realized", cover, method: "verified-fiber-product-geometric-lift" };
    } catch (error) {
        return unresolved(`The projected polygon motif failed independent geometry verification: ${error instanceof Error ? error.message : String(error)}`);
    }
}
