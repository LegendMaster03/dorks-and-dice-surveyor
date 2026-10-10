import { canonicalDSymbol, inspectDSymbol, type DSymbol } from "./d-symbol.js";
import { projectChambers } from "./equivalence.js";

export type CombinatorialSymmetryReduction =
    | { status: "reduced"; sourceDsSymbol: string; quotientDsSymbol: string;
        sourceChambers: number; quotientChambers: number;
        automorphismCount: number; evidence: "combinatorial-only" }
    | { status: "invalid" | "unsupported-limit" | "inconclusive"; reason: string };

/**
 * The smallest chamber quotient under every color-preserving AUTOMORPHISM
 * of a connected finite D-symbol. An automorphism is fixed by the image of
 * chamber 1, so this exhaustive bounded search is O(chambers²), not a
 * search over arbitrary permutations or registered pattern names.
 *
 * This is a maximal COMBINATORIAL symmetry quotient, not a claim that any
 * chosen Euclidean polygon metric admits the resulting isometries. A raster
 * detector must separately prove geometric symmetry before using this as
 * its observed symmetry identity. The original translation D-symbol is
 * retained unchanged for the actual adjacency witness.
 */
export function reduceCombinatorialChamberSymmetry(
    source: string, chamberLimit = 2048
): CombinatorialSymmetryReduction {
    if (!Number.isSafeInteger(chamberLimit) || chamberLimit < 1 || chamberLimit > 2048)
        return { status: "unsupported-limit", reason: "Invalid bounded chamber limit" };
    const parsed = inspectDSymbol(source, chamberLimit);
    if (parsed.status === "limit-exceeded")
        return { status: "unsupported-limit", reason: "D-symbol exceeds bounded chamber limit" };
    if (parsed.status !== "euclidean")
        return { status: "invalid", reason: "A valid Euclidean D-symbol is required" };
    const normalized = inspectDSymbol(parsed.symbol.canonical, chamberLimit);
    if (normalized.status !== "euclidean")
        return { status: "inconclusive", reason: "Canonical source was not a valid D-symbol" };
    const symbol: DSymbol = normalized.symbol;
    const n = symbol.chamberCount, maps = symbol.involutions;
    const parent = Array.from({ length: n + 1 }, (_, i) => i);
    const find = (value: number): number => {
        while (parent[value] !== value) {
            parent[value] = parent[parent[value]];
            value = parent[value];
        }
        return value;
    };
    const union = (a: number, b: number): void => {
        const x = find(a), y = find(b);
        if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
    };

    let automorphismCount = 0;
    for (let root = 1; root <= n; root++) {
        if (symbol.m01[1] !== symbol.m01[root] || symbol.m12[1] !== symbol.m12[root])
            continue;
        const mapping = new Array<number>(n + 1).fill(0);
        const queue = [1]; mapping[1] = root;
        let valid = true;
        for (let i = 0; i < queue.length && valid; i++) {
            const from = queue[i], to = mapping[from];
            if (symbol.m01[from] !== symbol.m01[to] || symbol.m12[from] !== symbol.m12[to]) {
                valid = false; break;
            }
            for (const map of maps) {
                const next = map[from], image = map[to];
                if (mapping[next] === 0) { mapping[next] = image; queue.push(next); }
                else if (mapping[next] !== image) { valid = false; break; }
            }
        }
        if (!valid || queue.length !== n || new Set(mapping.slice(1)).size !== n) continue;
        automorphismCount++;
        for (let i = 1; i <= n; i++) union(i, mapping[i]);
    }
    if (automorphismCount === 0)
        return { status: "inconclusive", reason: "No identity automorphism found" };

    const representativeToClass = new Map<number, number>();
    const classes = new Array<number>(n + 1).fill(0);
    const representatives = [0];
    for (let chamber = 1; chamber <= n; chamber++) {
        const representative = find(chamber);
        let id = representativeToClass.get(representative);
        if (id === undefined) {
            id = representatives.length;
            representativeToClass.set(representative, id);
            representatives.push(chamber);
        }
        classes[chamber] = id;
    }
    const count = representatives.length - 1;
    const quotientMaps = maps.map(map =>
        representatives.map((old, i) => i === 0 ? 0 : classes[map[old]])
    ) as [number[], number[], number[]];
    const quotientM01 = representatives.map((old, i) => i === 0 ? 0 : symbol.m01[old]);
    const quotientM12 = representatives.map((old, i) => i === 0 ? 0 : symbol.m12[old]);
    const candidate = canonicalDSymbol(quotientMaps, quotientM01, quotientM12);
    const quotient = inspectDSymbol(candidate, chamberLimit);
    if (quotient.status !== "euclidean"
        || !projectChambers(symbol, quotient.symbol)
        || quotient.symbol.chamberCount !== count)
        return { status: "inconclusive", reason: "Automorphism quotient did not independently validate" };
    return { status: "reduced", sourceDsSymbol: symbol.canonical,
        quotientDsSymbol: quotient.symbol.canonical, sourceChambers: n,
        quotientChambers: count, automorphismCount, evidence: "combinatorial-only" };
}
