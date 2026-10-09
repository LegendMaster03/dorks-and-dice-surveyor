import { canonicalDSymbol, inspectDSymbol, type DSymbol } from "./d-symbol.js";
import { projectChambers } from "./equivalence.js";
import { constructOrientableChamberCover } from "./orientation-cover.js";
import {
    constructTranslationCoverFromSymbol,
    type AbstractTranslationCell
} from "./translation-cover-from-symbol.js";
import { validateWireTopologyWitness } from "./witness-validation.js";

export type GeneralEuclideanTranslationCover =
    | {
        status: "constructed";
        sourceSymbol: string;
        translationDsSymbol: string;
        chamberCount: number;
        cyclicSheetCount: number;
        orientationChambers: number;
        sourceProjection: readonly number[];
        primitiveCells: readonly AbstractTranslationCell[];
        method: "connected-orientation-and-cyclic-holonomy-cover";
    }
    | { status: "invalid" | "unsupported" | "inconclusive"; reason: string };

type Vertex = { id: number; branch: number; members: number[] };
type Arc = { plus: number; minus: number; chamber: number; involution: number; voltage: number };
type Graph = { vertices: Vertex[]; which: number[][]; arcs: Arc[] };

function gcd(a: number, b: number): number {
    while (b) [a, b] = [b, a % b];
    return Math.abs(a);
}
function lcm(a: number, b: number): number { return a / gcd(a, b) * b; }
const modulo = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * Orbifold vertices are three kinds of two-involution chamber orbits:
 * face centers (0,1), edge centers (0,2), and tile vertices (1,2).
 * On an orientable quotient, the local stabilizer order is exactly
 * (2 * m_ij) / orbit.length, with m_02=2.
 */
function orientedOrbifoldGraph(symbol: DSymbol): Graph | null {
    const n = symbol.chamberCount, which: number[][] = [];
    const vertices: Vertex[] = [];
    for (const [a, b, target] of [
        [1, 2, symbol.m12],
        [0, 2, null],
        [0, 1, symbol.m01]
    ] as const) {
        const map = new Array<number>(n + 1).fill(-1);
        for (let root = 1; root <= n; root++) {
            if (map[root] >= 0) continue;
            const members = [root], id = vertices.length; map[root] = id;
            for (let i = 0; i < members.length; i++)
                for (const k of [a, b]) {
                    const next = symbol.involutions[k][members[i]];
                    if (map[next] < 0) { map[next] = id; members.push(next); }
                }
            const multiplicity = target === null ? 2 : target[root];
            const numerator = 2 * multiplicity;
            if (numerator % members.length !== 0) return null;
            const branch = numerator / members.length;
            if (!Number.isSafeInteger(branch) || branch < 1) return null;
            vertices.push({ id, branch, members });
        }
        which.push(map);
    }
    // The original connected orientable chamber graph is bipartite.
    const sign = new Int8Array(n + 1), queue = [1]; sign[1] = 1;
    for (let i = 0; i < queue.length; i++)
        for (const involution of symbol.involutions) {
            const next = involution[queue[i]], color = -sign[queue[i]];
            if (sign[next] === 0) { sign[next] = color; queue.push(next); }
            else if (sign[next] !== color) return null;
        }
    if (queue.length !== n) return null;
    const arcs: Arc[] = [];
    // All arcs run from the positive chamber color to its negative mate.
    // Their local counterclockwise boundary incidence is:
    // s0: vertex-type 2 (+) and type 1 (-)
    // s1: vertex-type 0 (+) and type 2 (-)
    // s2: vertex-type 1 (+) and type 0 (-).
    const ends: readonly (readonly [number, number])[] = [[2, 1], [0, 2], [1, 0]];
    for (let chamber = 1; chamber <= n; chamber++) {
        if (sign[chamber] !== 1) continue;
        for (let k = 0; k < 3; k++) {
            const [plusType, minusType] = ends[k];
            arcs.push({
                plus: which[plusType][chamber],
                minus: which[minusType][chamber],
                chamber, involution: k, voltage: 0
            });
        }
    }
    if (arcs.length !== 3 * n / 2) return null;
    return { vertices, which, arcs };
}

/** Solve orbifold cone-generator charges in the cyclic sheet group. */
function cyclicCharges(vertices: readonly Vertex[], sheetCount: number): number[] | null {
    const states: Array<number[] | null> = new Array(sheetCount).fill(null);
    states[0] = [];
    for (const vertex of vertices) {
        const b = vertex.branch;
        if (sheetCount % b !== 0) return null;
        const options: number[] = [];
        for (let unit = 1; unit <= b; unit++)
            if (gcd(unit, b) === 1)
                options.push(modulo((sheetCount / b) * unit, sheetCount));
        const next: Array<number[] | null> = new Array(sheetCount).fill(null);
        for (let residue = 0; residue < sheetCount; residue++) {
            const existing = states[residue];
            if (existing === null) continue;
            for (const charge of options) {
                const value = modulo(residue + charge, sheetCount);
                if (next[value] === null) next[value] = [...existing, charge];
            }
        }
        for (let i = 0; i < sheetCount; i++) states[i] = next[i];
    }
    return states[0];
}

/**
 * The finite black-to-white chamber adjacency graph is the dual 1-skeleton
 * of the oriented orbifold's triangulation. Each graph arc joins the two
 * orbifold vertices at the ends of the corresponding chamber edge.
 *
 * Prescribed cone charges are a zero-sum 0-chain. Route this chain along a
 * spanning tree to obtain a 1-chain of integer mod-N edge voltages; the
 * boundary of this chain equals the charge at EVERY orbifold vertex.
 * It is a sparse, linear-time alternative to an exponential permutation
 * search or a modular dense-matrix solver.
 */
function assignVoltages(graph: Graph, charges: readonly number[], n: number): boolean {
    const adj: number[][] = graph.vertices.map(() => []);
    for (let i = 0; i < graph.arcs.length; i++) {
        const arc = graph.arcs[i];
        if (arc.plus === arc.minus) return false;
        adj[arc.plus].push(i); adj[arc.minus].push(i);
    }
    const parent = new Int32Array(graph.vertices.length).fill(-1);
    const parentEdge = new Int32Array(graph.vertices.length).fill(-1);
    const nodes = [0]; parent[0] = 0;
    for (let i = 0; i < nodes.length; i++)
        for (const edgeId of adj[nodes[i]]) {
            const edge = graph.arcs[edgeId];
            const next = edge.plus === nodes[i] ? edge.minus : edge.plus;
            if (parent[next] < 0) {
                parent[next] = nodes[i]; parentEdge[next] = edgeId; nodes.push(next);
            }
        }
    if (nodes.length !== graph.vertices.length) return false;
    const subtree = charges.map(value => modulo(value, n));
    for (let i = nodes.length - 1; i > 0; i--) {
        const node = nodes[i], edge = graph.arcs[parentEdge[node]];
        edge.voltage = modulo((edge.plus === node ? 1 : -1) * subtree[node], n);
        subtree[parent[node]] = modulo(subtree[parent[node]] + subtree[node], n);
    }
    if (subtree[0] !== 0) return false;
    // Independently verify the local holonomy demand of every orbifold
    // vertex, not merely the spanning-tree solution.
    const flux = new Array<number>(graph.vertices.length).fill(0);
    for (const edge of graph.arcs) {
        flux[edge.plus] = modulo(flux[edge.plus] + edge.voltage, n);
        flux[edge.minus] = modulo(flux[edge.minus] - edge.voltage, n);
    }
    return flux.every((sum, i) => sum === modulo(charges[i], n));
}

export function constructGeneralEuclideanTranslationCover(
    source: string, chamberLimit = 1024
): GeneralEuclideanTranslationCover {
    const unsupported = (reason: string): GeneralEuclideanTranslationCover =>
        ({ status: "unsupported", reason });
    const inconclusive = (reason: string): GeneralEuclideanTranslationCover =>
        ({ status: "inconclusive", reason });
    if (!Number.isSafeInteger(chamberLimit) || chamberLimit < 8 || chamberLimit > 2048)
        return unsupported("Invalid bounded translation-cover chamber limit");
    const inspected = inspectDSymbol(source, chamberLimit);
    if (inspected.status === "limit-exceeded")
        return unsupported("Input Euclidean symbol exceeds the bounded chamber limit");
    if (inspected.status !== "euclidean")
        return { status: "invalid", reason: "A valid Euclidean D-symbol is required" };
    const original = inspected.symbol;
    const orient = constructOrientableChamberCover(original.canonical, chamberLimit);
    if (orient.status !== "constructed")
        return orient.status === "unsupported" ? unsupported(orient.reason)
            : inconclusive(orient.reason);
    const orientedInspection = inspectDSymbol(orient.coverSymbol, chamberLimit);
    if (orientedInspection.status !== "euclidean")
        return inconclusive("Connected orientation cover failed validation");
    const oriented = orientedInspection.symbol;
    const graph = orientedOrbifoldGraph(oriented);
    if (!graph) return inconclusive("Unable to construct the oriented orbifold vertex graph");
    let sheets = 1;
    for (const vertex of graph.vertices) {
        sheets = lcm(sheets, vertex.branch);
        if (sheets > 24) return unsupported("Orbifold rotational sheet order exceeds 24");
    }
    if (sheets * oriented.chamberCount > chamberLimit)
        return unsupported("The torsion-free connected cover exceeds the bounded chamber limit");
    const charges = cyclicCharges(graph.vertices, sheets);
    if (!charges) return inconclusive("No cyclic holonomy assignment resolves every local stabilizer");
    if (!assignVoltages(graph, charges, sheets))
        return inconclusive("The orbifold holonomy did not admit a consistent voltage assignment");

    const voltage = Array.from({ length: 3 }, () =>
        new Int32Array(oriented.chamberCount + 1));
    for (const arc of graph.arcs) {
        const opposite = oriented.involutions[arc.involution][arc.chamber];
        voltage[arc.involution][arc.chamber] = arc.voltage;
        voltage[arc.involution][opposite] = modulo(-arc.voltage, sheets);
    }
    const pairs: Array<readonly [number, number]> = [[1, 0]];
    const key = (chamber: number, sheet: number): number =>
        (chamber - 1) * sheets + sheet;
    const byPair = new Map<number, number>([[key(1, 0), 1]]);
    const maps: [number[], number[], number[]] = [[0], [0], [0]];
    for (let i = 0; i < pairs.length; i++) {
        const [chamber, sheet] = pairs[i];
        for (let k = 0; k < 3; k++) {
            const other = oriented.involutions[k][chamber];
            const nextSheet = modulo(sheet + voltage[k][chamber], sheets);
            const otherKey = key(other, nextSheet);
            let next = byPair.get(otherKey);
            if (!next) {
                if (pairs.length >= chamberLimit)
                    return unsupported("The connected cyclic cover exceeds the bounded chamber limit");
                pairs.push([other, nextSheet]); next = pairs.length;
                byPair.set(otherKey, next);
            }
            maps[k][i + 1] = next;
        }
    }
    const m01 = [0], m12 = [0];
    for (const [c] of pairs) { m01.push(oriented.m01[c]); m12.push(oriented.m12[c]); }
    const lifted = inspectDSymbol(canonicalDSymbol(maps, m01, m12), chamberLimit);
    if (lifted.status !== "euclidean" || !lifted.symbol.fixedPointFree
        || !lifted.symbol.weaklyOrientable)
        return inconclusive("The cyclic lift is not an orientable Euclidean chamber cover");
    const after = orientedOrbifoldGraph(lifted.symbol);
    if (!after || after.vertices.some(vertex => vertex.branch !== 1))
        return inconclusive("Residual rotational or edge branching remains after cyclic unfolding");
    const cover = constructTranslationCoverFromSymbol(lifted.symbol.canonical, chamberLimit);
    if (cover.status !== "constructed")
        return inconclusive(`Unbranched lift failed primitive torus construction: ${cover.reason}`);
    const projection = projectChambers(lifted.symbol, original);
    if (!projection || !projectChambers(lifted.symbol, oriented))
        return inconclusive("The final torus does not project onto both chamber quotients");
    try {
        validateWireTopologyWitness({
            contractVersion: 1,
            provenance: "derived:connected-orientation-and-cyclic-holonomy-cover",
            quotientDsSymbol: original.canonical,
            translationDsSymbol: cover.sourceSymbol,
            motifCells: cover.cells.map(cell => ({
                id: `general-${cell.id}`,
                boundary: cell.boundary.map((edge, i) => ({
                    index: i,
                    boundarySideIndex: i,
                    targetMotifCellId: `general-${edge.targetCell}`,
                    targetTranslation: { u: edge.shift[0], v: edge.shift[1] },
                    reciprocalInterfaceIndex: edge.reciprocalEdge
                }))
            }))
        });
    } catch (error) {
        return inconclusive(`The derived primitive topology witness is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
        status: "constructed",
        sourceSymbol: original.canonical,
        translationDsSymbol: cover.sourceSymbol,
        chamberCount: cover.chamberCount,
        cyclicSheetCount: sheets,
        orientationChambers: oriented.chamberCount,
        sourceProjection: projection,
        primitiveCells: cover.cells,
        method: "connected-orientation-and-cyclic-holonomy-cover"
    };
}
