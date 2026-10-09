import { canonicalDSymbol, inspectDSymbol, type DSymbol } from "./d-symbol.js";
import { projectChambers } from "./equivalence.js";

export type OrientationCoverResult =
    | {
        status: "constructed";
        sourceSymbol: string;
        coverSymbol: string;
        chamberCount: number;
        sourceProjection: readonly number[];
        remainingBranchedOrbits: number;
        isTrivial: boolean;
        construction: "connected-orientation-double";
    }
    | { status: "invalid" | "unsupported" | "inconclusive"; reason: string };

function countBranchedOrbits(symbol: DSymbol): number {
    let branched = 0;
    const n = symbol.chamberCount;
    for (const [first, label] of [[0, symbol.m01], [1, symbol.m12]] as const) {
        const seen = new Set<number>();
        for (let start = 1; start <= n; start++) {
            if (seen.has(start)) continue;
            const orbit = [start]; seen.add(start);
            for (let i = 0; i < orbit.length; i++) for (const k of [first, first + 1]) {
                const next = symbol.involutions[k][orbit[i]];
                if (!seen.has(next)) { seen.add(next); orbit.push(next); }
            }
            if (orbit.length !== 2 * label[start]) branched++;
        }
    }
    const seen = new Set<number>();
    for (let start = 1; start <= n; start++) {
        if (seen.has(start)) continue;
        const orbit = [start]; seen.add(start);
        for (let i = 0; i < orbit.length; i++) for (const k of [0, 2]) {
            const next = symbol.involutions[k][orbit[i]];
            if (!seen.has(next)) { seen.add(next); orbit.push(next); }
        }
        if (orbit.length !== 4) branched++;
    }
    return branched;
}

/**
 * Orientation double cover of any bounded valid Euclidean 2D D-symbol.
 * Each s_i maps (chamber,parity) -> (s_i(chamber), opposite parity).
 * Keeping one connected orbit avoids doubling an already orientable cover.
 *
 * All three lifted involutions are fixed-point free and alternate parity.
 * Local face/vertex rotation branching can remain, so this is NOT a torus
 * constructor and does not assert a geometric embedding.
 */
export function constructOrientableChamberCover(
    source: string, chamberLimit = 1024
): OrientationCoverResult {
    const unsupported = (reason: string): OrientationCoverResult =>
        ({ status: "unsupported", reason });
    const inconclusive = (reason: string): OrientationCoverResult =>
        ({ status: "inconclusive", reason });
    if (!Number.isSafeInteger(chamberLimit) || chamberLimit < 1 || chamberLimit > 2048)
        return unsupported("Invalid bounded orientation-cover chamber limit");
    const inspected = inspectDSymbol(source, chamberLimit);
    if (inspected.status === "limit-exceeded")
        return unsupported("Input D-symbol exceeds the bounded orientation-cover capacity");
    if (inspected.status !== "euclidean")
        return { status: "invalid", reason: "A valid Euclidean D-symbol is required" };
    const canonical = inspectDSymbol(inspected.symbol.canonical, chamberLimit);
    if (canonical.status !== "euclidean")
        return inconclusive("Canonical D-symbol numbering was inconsistent");
    const original = canonical.symbol;
    if (2 * original.chamberCount > chamberLimit
        && !(original.fixedPointFree && original.weaklyOrientable))
        return unsupported("The orientation double would exceed the bounded chamber capacity");

    type Chamber = readonly [number, 0 | 1];
    const pairs: Chamber[] = [[1, 0]];
    const key = (c: number, parity: 0 | 1) => (c - 1) * 2 + parity;
    const which = new Map<number, number>([[key(1, 0), 1]]);
    const maps: [number[], number[], number[]] = [[0], [0], [0]];
    for (let index = 0; index < pairs.length; index++) {
        const [c, parity] = pairs[index];
        for (let k = 0; k < 3; k++) {
            const nextChamber = original.involutions[k][c];
            const nextParity: 0 | 1 = parity === 0 ? 1 : 0;
            const targetKey = key(nextChamber, nextParity);
            let target = which.get(targetKey);
            if (!target) {
                if (pairs.length >= chamberLimit)
                    return unsupported("The connected orientation cover exceeds its chamber limit");
                pairs.push([nextChamber, nextParity]);
                target = pairs.length;
                which.set(targetKey, target);
            }
            maps[k][index + 1] = target;
        }
    }
    const m01 = [0], m12 = [0];
    for (const [chamber] of pairs) {
        m01.push(original.m01[chamber]);
        m12.push(original.m12[chamber]);
    }
    const lift = inspectDSymbol(canonicalDSymbol(maps, m01, m12), chamberLimit);
    if (lift.status !== "euclidean" || !lift.symbol.fixedPointFree
        || !lift.symbol.weaklyOrientable)
        return inconclusive("The orientation double did not preserve Euclidean curvature and orientability");
    const projection = projectChambers(lift.symbol, original);
    if (!projection)
        return inconclusive("The connected orientation cover does not project onto its input D-symbol");
    return {
        status: "constructed",
        sourceSymbol: original.canonical,
        coverSymbol: lift.symbol.canonical,
        chamberCount: lift.symbol.chamberCount,
        sourceProjection: projection,
        remainingBranchedOrbits: countBranchedOrbits(lift.symbol),
        isTrivial: lift.symbol.canonical === original.canonical,
        construction: "connected-orientation-double"
    };
}
