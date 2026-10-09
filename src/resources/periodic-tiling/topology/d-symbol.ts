/** Standard finite 2D Delaney–Dress symbols. Indices are 1-based. */
export type DSymbol = {
    canonical: string;
    chamberCount: number;
    involutions: readonly [readonly number[], readonly number[], readonly number[]];
    m01: readonly number[];
    m12: readonly number[];
    weaklyOrientable: boolean;
    fixedPointFree: boolean;
};
export type DSymbolInspection =
    | { status: "euclidean"; symbol: DSymbol }
    | { status: "non-euclidean"; geometry: "spherical" | "hyperbolic"; symbol: DSymbol }
    | { status: "syntax-invalid" | "structure-invalid" | "limit-exceeded"; reason: string };

class DError extends Error {
    constructor(readonly status: "syntax-invalid" | "structure-invalid" | "limit-exceeded", message: string) {
        super(message);
    }
}
const syntax = (message: string): never => { throw new DError("syntax-invalid", message); };
const invalid = (message: string): never => { throw new DError("structure-invalid", message); };
const positive = (value: string, what: string): number => {
    if (!/^[1-9]\d*$/.test(value)) return syntax(`${what} must be a positive integer`);
    const n = Number(value);
    if (!Number.isSafeInteger(n)) return syntax(`${what} exceeds the safe integer range`);
    return n;
};
const entries = (text: string): number[] => text.trim() ? text.trim().split(/\s+/).map(v => positive(v, "entry")) : [];
const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;

function orbit(maps: readonly (readonly number[])[], i: number, start: number): number[] {
    const visited = new Set([start]);
    const queue = [start];
    for (let p = 0; p < queue.length; p++) {
        for (const k of [i, i + 1]) {
            const target = maps[k][queue[p]];
            if (!visited.has(target)) { visited.add(target); queue.push(target); }
        }
    }
    return queue;
}
function relabel(size: number, maps: readonly (readonly number[])[], labels: readonly (readonly number[])[], root: number): string {
    const oldToNew = new Array<number>(size + 1).fill(0);
    const newToOld = [0, root]; oldToNew[root] = 1;
    for (let cursor = 1; cursor <= size; cursor++) {
        for (const map of maps) {
            const old = map[newToOld[cursor]];
            if (!oldToNew[old]) { oldToNew[old] = newToOld.length; newToOld.push(old); }
        }
    }
    const translated = maps.map(map => newToOld.map((old, i) => i ? oldToNew[map[old]] : 0));
    const compact = translated.map(map => map.slice(1).flatMap((target, i) => i + 1 <= target ? [target] : []).join(" ")).join(",");
    const numbers = [0, 1].map(i => {
        const seen = new Set<number>(), values: number[] = [];
        for (let chamber = 1; chamber <= size; chamber++) {
            if (seen.has(chamber)) continue;
            values.push(labels[i][newToOld[chamber]]);
            for (const member of orbit(translated, i, chamber)) seen.add(member);
        }
        return values.join(" ");
    }).join(",");
    return `<${size}:${compact}:${numbers}>`;
}
export function canonicalDSymbol(
    involutions: readonly [readonly number[], readonly number[], readonly number[]],
    m01: readonly number[], m12: readonly number[]): string {
    const size = involutions[0].length - 1;
    let best = "";
    for (let i = 1; i <= size; i++) {
        const candidate = relabel(size, involutions, [m01, m12], i);
        if (!best || candidate < best) best = candidate;
    }
    return best;
}

export function inspectDSymbol(text: string, chamberLimit = 256): DSymbolInspection {
    try {
        const match = /^\s*<\s*(?:(\d+\.\d+)\s*:\s*)?(\d+)\s*:\s*([^:]+)\s*:\s*([^:]+)\s*>\s*$/.exec(text);
        if (!match) syntax("Expected <size:s0,s1,s2:m01,m12>");
        const size = positive(match![2], "chamber count");
        if (!Number.isSafeInteger(chamberLimit) || chamberLimit < 1) syntax("Invalid chamber limit");
        if (size > chamberLimit) throw new DError("limit-exceeded", `Chamber count exceeds ${chamberLimit}`);
        const parts = match![3].split(",");
        if (parts.length !== 3) syntax("Exactly three involutions are required");
        const maps = parts.map((part, i) => {
            const values = entries(part), map = new Array<number>(size + 1).fill(0);
            let p = 0;
            for (let c = 1; c <= size; c++) {
                if (map[c]) continue;
                const other = values[p++];
                if (!other || other < c || other > size || map[other]) invalid(`Invalid compressed s${i} involution`);
                map[c] = other; map[other] = c;
            }
            if (p !== values.length) invalid(`Excess s${i} entries`);
            return map;
        }) as [number[], number[], number[]];
        const reached = new Set([1]), queue = [1];
        for (let p = 0; p < queue.length; p++) {
            for (const map of maps) {
                const next = map[queue[p]];
                if (!reached.has(next)) { reached.add(next); queue.push(next); }
            }
        }
        if (reached.size !== size) invalid("Disconnected chamber system");
        for (let c = 1; c <= size; c++) {
            if (maps[0][maps[2][c]] !== maps[2][maps[0][c]]) invalid("s0 and s2 must commute");
        }
        const mParts = match![4].split(",");
        if (mParts.length !== 2) syntax("Exactly two orbit label sequences are required");
        const ms = mParts.map((part, i) => {
            const values = entries(part), labels = new Array<number>(size + 1).fill(0);
            let p = 0;
            for (let c = 1; c <= size; c++) {
                if (labels[c]) continue;
                const members = orbit(maps, i, c);
                const label = values[p++];
                let current = c, order = 0;
                do {
                    current = maps[i + 1][maps[i][current]];
                    order++;
                    if (order > size) invalid("Rotation order exceeds chamber count");
                } while (current !== c);
                if (!label || label < 2 || label % order) invalid(`Invalid m${i}${i + 1} orbit multiplicity`);
                for (const member of members) labels[member] = label;
            }
            if (p !== values.length) syntax("Incorrect orbit label count");
            return labels;
        }) as [number[], number[]];
        // Weak orientability permits fixed points, but non-fixed involution edges must reverse sign.
        const parity = new Array<number>(size + 1).fill(0);
        let weaklyOrientable = true;
        for (let c = 1; c <= size; c++) {
            if (parity[c]) continue;
            parity[c] = 1; const q = [c];
            for (let p = 0; p < q.length; p++) {
                for (const map of maps) {
                    const next = map[q[p]];
                    if (next === q[p]) continue;
                    if (!parity[next]) { parity[next] = -parity[q[p]]; q.push(next); }
                    else if (parity[next] === parity[q[p]]) weaklyOrientable = false;
                }
            }
        }
        let denominator = 2n;
        for (let c = 1; c <= size; c++) for (const value of [ms[0][c], ms[1][c]]) {
            const b = BigInt(value); denominator = denominator / gcd(denominator, b) * b;
        }
        let curvature = -BigInt(size) * (denominator / 2n);
        for (let c = 1; c <= size; c++) {
            curvature += denominator / BigInt(ms[0][c]) + denominator / BigInt(ms[1][c]);
        }
        const symbol: DSymbol = {
            canonical: canonicalDSymbol(maps, ms[0], ms[1]), chamberCount: size,
            involutions: maps, m01: ms[0], m12: ms[1], weaklyOrientable,
            fixedPointFree: maps.every(map => map.slice(1).every((v, i) => v !== i + 1))
        };
        return curvature === 0n ? { status: "euclidean", symbol }
            : { status: "non-euclidean", geometry: curvature > 0n ? "spherical" : "hyperbolic", symbol };
    } catch (error) {
        if (error instanceof DError) return { status: error.status, reason: error.message };
        throw error;
    }
}
