import { inspectDSymbol, type DSymbol } from "./d-symbol.js";

export type MetricConstraint = { key: string; unit: string; min: number; max: number };
export type EquivalenceStatus =
    | "exact-identity" | "chamber-isomorphic" | "proven-equivalent"
    | "metrically-incompatible" | "structurally-incompatible"
    | "inconclusive" | "invalid" | "limit-exceeded";
export type EquivalenceResult = { status: EquivalenceStatus; reason: string };

/**
 * Checks a finite, fully connected chamber graph maps onto the quotient,
 * commuting with every involution and preserving face/vertex multiplicities.
 * A common chamber cover of two valid D-symbols proves combinatorial equivalence.
 */
export function projectChambers(cover: DSymbol, quotient: DSymbol): readonly number[] | null {
    if (cover.chamberCount < quotient.chamberCount) return null;
    for (let root = 1; root <= quotient.chamberCount; root++) {
        const mapping = new Array<number>(cover.chamberCount + 1).fill(0);
        mapping[1] = root;
        const queue = [1]; let valid = true;
        for (let i = 0; i < queue.length && valid; i++) {
            const source = queue[i], dest = mapping[source];
            if (cover.m01[source] !== quotient.m01[dest] || cover.m12[source] !== quotient.m12[dest]) {
                valid = false; break;
            }
            for (let k = 0; k < 3; k++) {
                const s = cover.involutions[k][source];
                const t = quotient.involutions[k][dest];
                if (!mapping[s]) { mapping[s] = t; queue.push(s); }
                else if (mapping[s] !== t) { valid = false; break; }
            }
        }
        if (valid && queue.length === cover.chamberCount
            && new Set(mapping.slice(1)).size === quotient.chamberCount) return mapping;
    }
    return null;
}

function constraintConflict(left: readonly MetricConstraint[], right: readonly MetricConstraint[]): boolean {
    for (const a of left) for (const b of right) {
        if (a.key === b.key && a.unit === b.unit && Number.isFinite(a.min) && Number.isFinite(a.max)
            && Number.isFinite(b.min) && Number.isFinite(b.max)
            && a.min <= a.max && b.min <= b.max
            && (a.max < b.min || b.max < a.min)) return true;
    }
    return false;
}
function distinctValues(values: readonly number[]): string {
    return [...new Set(values.slice(1))].sort((a, b) => a - b).join(",");
}

/** Safe local compatibility: never infers a negative from merely unequal strings. */
export function compareDSymbols(
    left: string, right: string,
    options: {
        commonCover?: string;
        leftMetric?: readonly MetricConstraint[];
        rightMetric?: readonly MetricConstraint[];
    } = {}): EquivalenceResult {
    const l = inspectDSymbol(left), r = inspectDSymbol(right);
    if (l.status === "limit-exceeded" || r.status === "limit-exceeded")
        return { status: "limit-exceeded", reason: "One symbol exceeds the chamber limit" };
    if (l.status !== "euclidean" || r.status !== "euclidean")
        return { status: "invalid", reason: "Both inputs must be valid Euclidean D-symbols" };
    const conflict = constraintConflict(options.leftMetric ?? [], options.rightMetric ?? []);
    if (l.symbol.canonical === r.symbol.canonical) {
        if (conflict) return { status: "metrically-incompatible", reason: "Same topology, but stated metric parameter intervals do not overlap" };
        if (left.trim() === right.trim()) return { status: "exact-identity", reason: "The identical D-symbol is used by both sides" };
        return { status: "chamber-isomorphic", reason: "Canonical chamber relabeling is identical" };
    }
    // The sets of polygon side counts and vertex valences are invariants of
    // the entire infinite uncolored tiling, independent of the chosen quotient.
    if (distinctValues(l.symbol.m01) !== distinctValues(r.symbol.m01)
        || distinctValues(l.symbol.m12) !== distinctValues(r.symbol.m12))
        return { status: "structurally-incompatible", reason: "Face-degree or vertex-valence invariants differ" };
    if (options.commonCover) {
        const witness = inspectDSymbol(options.commonCover, 2048);
        if (witness.status === "euclidean"
            && projectChambers(witness.symbol, l.symbol)
            && projectChambers(witness.symbol, r.symbol)) {
            if (conflict) return { status: "metrically-incompatible", reason: "A common chamber cover proves the same topology, but metric intervals conflict" };
            return { status: "proven-equivalent", reason: "The common finite chamber cover projects onto both symbols" };
        }
    }
    return { status: "inconclusive", reason: "No common chamber cover has been established within the supplied evidence" };
}
