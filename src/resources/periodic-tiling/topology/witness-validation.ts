import { inspectDSymbol } from "./d-symbol.js";
import { projectChambers } from "./equivalence.js";
import type { WireTopologyWitness, WireTranslation } from "./wire.js";

/** Checks the *claimed* translation chamber graph, not merely edge reciprocity. */
export class PeriodicWitnessValidationError extends Error {
    constructor(message: string) { super(message); this.name = "PeriodicWitnessValidationError"; }
}
const fail = (message: string): never => { throw new PeriodicWitnessValidationError(message); };
const maxCoordinate = 9_007_199_254_740_991;
const exact = (n: number): boolean => Number.isSafeInteger(n) && Math.abs(n) <= maxCoordinate;
type Shift = readonly [bigint, bigint];
const zero: Shift = [0n, 0n];
const add = (a: Shift, b: Shift): Shift => [a[0] + b[0], a[1] + b[1]];
const neg = (a: Shift): Shift => [-a[0], -a[1]];
const subtract = (a: Shift, b: Shift): Shift => add(a, neg(b));
const equal = (a: Shift, b: Shift): boolean => a[0] === b[0] && a[1] === b[1];
const fromWire = (v: WireTranslation): Shift => {
    if (!v || !exact(v.u) || !exact(v.v)) fail("Translation must use exact wire integers");
    return [BigInt(v.u), BigInt(v.v)];
};
const gcd = (a: bigint, b: bigint): bigint => b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);

function orbit(maps: readonly number[][], first: number, root: number): number[] {
    const seen = new Set([root]), out = [root];
    for (let i = 0; i < out.length; i++) for (const k of [first, first + 1]) {
        const next = maps[k][out[i]];
        if (!seen.has(next)) { seen.add(next); out.push(next); }
    }
    return out;
}
function serialize(maps: readonly number[][], m01: readonly number[], m12: readonly number[]): string {
    const n = m01.length - 1;
    const involutions = maps.map(map => map.slice(1).flatMap((v, i) => i + 1 <= v ? [String(v)] : []).join(" ")).join(",");
    const labels = [m01, m12].map((values, first) => {
        const seen = new Set<number>(), out: number[] = [];
        for (let c = 1; c <= n; c++) {
            if (seen.has(c)) continue;
            out.push(values[c]);
            for (const q of orbit(maps, first, c)) seen.add(q);
        }
        return out.join(" ");
    }).join(",");
    return `<${n}:${involutions}:${labels}>`;
}

/**
 * Verify an orientable Z² witness, including its chamber graph, all vertex
 * holonomies and primitivity of its periodic translations. The D-symbol alone
 * does not encode edge voltages, so comparing only canonical symbols is unsafe.
 * No metric embedding is implied by a successful validation.
 */
export function validateWireTopologyWitness(witness: WireTopologyWitness): true {
    if (!witness || witness.contractVersion !== 1 || !witness.provenance?.trim())
        fail("Unsupported or incomplete topology witness");
    const cells = witness.motifCells;
    if (!Array.isArray(cells) || cells.length < 1 || cells.length > 256)
        fail("Invalid finite motif cell count");
    const byId = new Map<string, number>();
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (!cell?.id?.trim() || byId.has(cell.id) || !Array.isArray(cell.boundary)
            || cell.boundary.length < 3 || cell.boundary.length > 256)
            fail("Invalid or repeated motif cell identity or boundary");
        byId.set(cell.id, i);
    }
    const offsets = [0];
    for (const cell of cells) offsets.push(offsets[offsets.length - 1] + cell.boundary.length);
    const n = offsets[cells.length] * 2;
    if (n > 2048) fail("Translation chamber graph exceeds 2048 flags");
    const maps = Array.from({ length: 3 }, () => new Array<number>(n + 1).fill(0));
    const m01 = new Array<number>(n + 1).fill(0);
    const shifts: Shift[] = Array.from({ length: n + 1 }, () => zero);
    const adjacency: { target: number; shift: Shift }[][] = cells.map(() => []);
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex], sides = cell.boundary.length;
        for (let i = 0; i < sides; i++) {
            const edge = cell.boundary[i], target = byId.get(edge.targetMotifCellId);
            if (edge.index !== i || !Number.isInteger(edge.boundarySideIndex) || edge.boundarySideIndex < 0
                || target === undefined || !Number.isInteger(edge.reciprocalInterfaceIndex)
                || edge.reciprocalInterfaceIndex < 0 || edge.reciprocalInterfaceIndex >= cells[target].boundary.length)
                fail("Invalid periodic boundary target");
            if (target === undefined) throw new PeriodicWitnessValidationError("Missing target cell");
            const peer = cells[target].boundary[edge.reciprocalInterfaceIndex], shift = fromWire(edge.targetTranslation);
            if (peer.targetMotifCellId !== cell.id || peer.reciprocalInterfaceIndex !== i
                || !equal(add(shift, fromWire(peer.targetTranslation)), zero))
                fail("Nonreciprocal periodic interface");
            const a = 2 * (offsets[cellIndex] + i) + 1;
            const peerFlag = 2 * (offsets[target] + edge.reciprocalInterfaceIndex) + 1;
            const prev = 2 * (offsets[cellIndex] + (i + sides - 1) % sides) + 1;
            const next = 2 * (offsets[cellIndex] + (i + 1) % sides) + 1;
            maps[0][a] = a + 1; maps[0][a + 1] = a;
            maps[1][a] = prev + 1; maps[1][a + 1] = next;
            maps[2][a] = peerFlag + 1; maps[2][a + 1] = peerFlag;
            shifts[a] = shift; shifts[a + 1] = shift;
            m01[a] = sides; m01[a + 1] = sides;
            adjacency[cellIndex].push({ target, shift });
        }
    }
    const m12 = new Array<number>(n + 1).fill(0);
    const seen = new Set<number>();
    for (let root = 1; root <= n; root++) {
        if (seen.has(root)) continue;
        const q = [root], position = new Map<number, Shift>([[root, zero]]); seen.add(root);
        for (let i = 0; i < q.length; i++) {
            const current = q[i], at = position.get(current)!;
            for (const k of [1, 2]) {
                const next = maps[k][current], translated = k === 1 ? at : add(at, shifts[current]);
                if (!position.has(next)) { position.set(next, translated); seen.add(next); q.push(next); }
                else if (!equal(position.get(next)!, translated))
                    fail("Vertex orbit does not close in the translation cover");
            }
        }
        if (q.length % 2 !== 0) fail("Vertex orbit has an odd number of flags");
        for (const c of q) m12[c] = q.length / 2;
    }
    const graphSymbol = inspectDSymbol(serialize(maps, m01, m12), 2048);
    if (graphSymbol.status !== "euclidean") throw new PeriodicWitnessValidationError(`Witness does not form a Euclidean chamber graph (${graphSymbol.status})`);
    const declared = inspectDSymbol(witness.translationDsSymbol, 2048);
    const quotient = inspectDSymbol(witness.quotientDsSymbol, 2048);
    if (declared.status !== "euclidean" || quotient.status !== "euclidean"
        || graphSymbol.symbol.canonical !== declared.symbol.canonical)
        throw new PeriodicWitnessValidationError("Witness incidence does not match its declared translation D-symbol");
    if (!projectChambers(declared.symbol, quotient.symbol))
        fail("Translation chamber graph does not cover the quotient D-symbol");

    // All finite motif cells must be connected and closed walks must generate
    // the complete Z² lattice, not merely a proper-index sublattice.
    const potentials = new Map<number, Shift>([[0, zero]]), queue = [0];
    let latticeIndex = 0n;
    const cycles: Shift[] = [];
    for (let i = 0; i < queue.length; i++) {
        const cell = queue[i], from = potentials.get(cell)!;
        for (const edge of adjacency[cell]) {
            const targetShift = add(from, edge.shift), previous = potentials.get(edge.target);
            if (!previous) { potentials.set(edge.target, targetShift); queue.push(edge.target); continue; }
            const cycle = subtract(targetShift, previous);
            if (equal(cycle, zero)) continue;
            for (const earlier of cycles) {
                const det = cycle[0] * earlier[1] - cycle[1] * earlier[0];
                latticeIndex = gcd(latticeIndex, det);
            }
            cycles.push(cycle);
        }
    }
    if (queue.length !== cells.length || latticeIndex !== 1n)
        fail("Motif does not form one connected primitive Z² translation cover");
    return true;
}
