/**
 * Standard two-dimensional Delaney-Dress numerical symbols.
 * Compact encoding: <size:s0,s1,s2:m01,m12>.
 *
 * An optional historic prefix (such as 1.1:) is accepted on input.
 * Canonical output is independent of that catalog numbering.
 */
export type DelaneyDressSymbol = {
    notation: "Delaney-Dress";
    canonical: string;
    size: number;
    neighbors: readonly [readonly number[], readonly number[], readonly number[]];
    m01: readonly number[];
    m12: readonly number[];
};

export class DelaneyDressNotationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DelaneyDressNotationError";
    }
}

const maxChambers = 256;

export function parseDelaneyDressNotation(raw: string): DelaneyDressSymbol {
    const source = raw.trim().replace(/\s*#.*$/s, "").trim();
    if (!source.startsWith("<") || !source.endsWith(">")) {
        throw invalid("A D-symbol must be enclosed in angle brackets.");
    }
    const fields = source.slice(1, -1).split(":").map(value => value.trim());
    if (fields.length === 4 && /^\d+\.\d+$/.test(fields[0])) fields.shift();
    if (fields.length !== 3) {
        throw invalid("Expected <size:s0,s1,s2:m01,m12>.");
    }
    const size = parsePositive(fields[0], "chamber count");
    if (size > maxChambers) {
        throw invalid("D-symbol exceeds the " + maxChambers + "-chamber safety limit.");
    }
    const adjacency = fields[1].split(",");
    if (adjacency.length !== 3) throw invalid("A 2D D-symbol requires three chamber neighbor maps.");
    const neighbors = adjacency.map((part, index) => parseInvolution(part, size, index)) as
        [number[], number[], number[]];

    for (let chamber = 1; chamber <= size; chamber++) {
        if (neighbors[0][neighbors[2][chamber]] !== neighbors[2][neighbors[0][chamber]]) {
            throw invalid("Nonadjacent chamber maps s0 and s2 must commute.");
        }
    }
    const visited = new Set<number>([1]);
    const queue = [1];
    for (let pos = 0; pos < queue.length; pos++) {
        for (const map of neighbors) {
            const next = map[queue[pos]];
            if (!visited.has(next)) {
                visited.add(next);
                queue.push(next);
            }
        }
    }
    if (visited.size !== size) throw invalid("The chamber system must be connected.");

    const mFields = fields[2].split(",");
    if (mFields.length !== 2) throw invalid("A 2D D-symbol requires m01 and m12 orbit labels.");
    const m01 = parseOrbitLabels(mFields[0], neighbors, 0, size);
    const m12 = parseOrbitLabels(mFields[1], neighbors, 1, size);
    // Exact rational curvature prevents near-zero non-Euclidean symbols from
    // being accepted when orbit labels are large.
    let common = 2n;
    for (let chamber = 1; chamber <= size; chamber++) {
        for (const label of [m01[chamber], m12[chamber]]) {
            const value = BigInt(label);
            common = common / gcd(common, value) * value;
        }
    }
    let numerator = -BigInt(size) * (common / 2n);
    for (let chamber = 1; chamber <= size; chamber++) {
        numerator += common / BigInt(m01[chamber]) + common / BigInt(m12[chamber]);
    }
    if (numerator !== 0n) {
        throw invalid("The D-symbol is not Euclidean (curvature must be zero).");
    }

    let canonical = "";
    for (let start = 1; start <= size; start++) {
        const candidate = serializeRelabeling(size, neighbors, m01, m12, start);
        if (canonical === "" || candidate < canonical) canonical = candidate;
    }
    return { notation: "Delaney-Dress", canonical, size, neighbors, m01, m12 };
}

function parsePositive(source: string, label: string): number {
    if (!/^[1-9]\d*$/.test(source)) throw invalid(label + " must be a positive integer.");
    const number = Number(source);
    if (!Number.isSafeInteger(number)) throw invalid(label + " exceeds the safe integer range.");
    return number;
}

function parseNumbers(source: string): number[] {
    const trimmed = source.trim();
    if (trimmed === "") return [];
    return trimmed.split(/\s+/).map(token => parsePositive(token, "D-symbol entry"));
}

function parseInvolution(source: string, size: number, index: number): number[] {
    const entries = parseNumbers(source);
    const map = new Array<number>(size + 1).fill(0);
    let position = 0;
    for (let chamber = 1; chamber <= size; chamber++) {
        if (map[chamber] !== 0) continue;
        const target = entries[position++];
        if (target === undefined || target < chamber || target > size || map[target] !== 0) {
            throw invalid("Invalid compressed s" + index + " involution.");
        }
        map[chamber] = target;
        map[target] = chamber;
    }
    if (position !== entries.length) throw invalid("Unexpected entries in s" + index + " involution.");
    return map;
}

function collectOrbit(maps: readonly number[][], first: number, start: number): number[] {
    const members = new Set<number>([start]);
    const queue = [start];
    for (let position = 0; position < queue.length; position++) {
        for (const map of [maps[first], maps[first + 1]]) {
            const next = map[queue[position]];
            if (!members.has(next)) {
                members.add(next);
                queue.push(next);
            }
        }
    }
    return [...members];
}

function rotationOrder(maps: readonly number[][], first: number, start: number): number {
    let current = start;
    let length = 0;
    do {
        current = maps[first + 1][maps[first][current]];
        length++;
        if (length > maps[0].length) throw invalid("Invalid chamber orbit.");
    } while (current !== start);
    return length;
}

function parseOrbitLabels(source: string, maps: readonly number[][], first: number, size: number): number[] {
    const entries = parseNumbers(source);
    const labels = new Array<number>(size + 1).fill(0);
    let position = 0;
    for (let chamber = 1; chamber <= size; chamber++) {
        if (labels[chamber] !== 0) continue;
        const m = entries[position++];
        const orbit = collectOrbit(maps, first, chamber);
        const order = rotationOrder(maps, first, chamber);
        if (m === undefined || m < 2 || m % order !== 0) {
            throw invalid("Invalid m" + first + (first + 1) + " label at chamber " + chamber + ".");
        }
        for (const member of orbit) labels[member] = m;
    }
    if (position !== entries.length) throw invalid("Unexpected m" + first + (first + 1) + " orbit labels.");
    return labels;
}

function serializeRelabeling(
    size: number,
    maps: readonly number[][],
    m01: readonly number[],
    m12: readonly number[],
    start: number): string {
    const oldToNew = new Array<number>(size + 1).fill(0);
    const newToOld = [0, start];
    oldToNew[start] = 1;
    for (let index = 1; index <= size; index++) {
        const chamber = newToOld[index];
        for (const map of maps) {
            const next = map[chamber];
            if (oldToNew[next] === 0) {
                oldToNew[next] = newToOld.length;
                newToOld.push(next);
            }
        }
    }
    const relabeled = maps.map(map => {
        const result = new Array<number>(size + 1).fill(0);
        for (let chamber = 1; chamber <= size; chamber++) {
            result[chamber] = oldToNew[map[newToOld[chamber]]];
        }
        return result;
    });
    const sText = relabeled.map(map =>
        map.slice(1).flatMap((target, index) => index + 1 <= target ? [String(target)] : []).join(" ")
    ).join(",");
    const orbitText = ([0, 1] as const).map(first => {
        const seen = new Set<number>();
        const values: number[] = [];
        for (let chamber = 1; chamber <= size; chamber++) {
            if (seen.has(chamber)) continue;
            const old = newToOld[chamber];
            values.push(first === 0 ? m01[old] : m12[old]);
            for (const member of collectOrbit(relabeled, first, chamber)) seen.add(member);
        }
        return values.join(" ");
    }).join(",");
    return "<" + size + ":" + sText + ":" + orbitText + ">";
}

function gcd(left: bigint, right: bigint): bigint {
    while (right !== 0n) {
        [left, right] = [right, left % right];
    }
    return left;
}

function invalid(message: string): DelaneyDressNotationError {
    return new DelaneyDressNotationError(message);
}
