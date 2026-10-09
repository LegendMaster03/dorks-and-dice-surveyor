import { canonicalDSymbol, inspectDSymbol } from "./d-symbol.js";
import { projectChambers } from "./equivalence.js";
import { realizeOneChamberReflectionSymbol } from "./reflection-realization.js";
import { constructTranslationCoverFromSymbol, type AbstractTranslationCell } from "./translation-cover-from-symbol.js";
import { validateWireTopologyWitness } from "./witness-validation.js";

/**
 * Unfolds a bounded Euclidean symmetry quotient with uniform local face and
 * vertex orders into a connected, orientable, unbranched translational torus.
 *
 * This is a fiber product of the input chamber action and an independently
 * constructed unbranched torus cover of the one-chamber Euclidean reflection
 * group. It is NOT a geometric realization of an arbitrary mixed-cell symbol.
 * There is no named-pattern catalogue or caller-supplied motif.
 */
export type RegularQuotientUnfolding =
    | {
        status: "constructed";
        sourceSymbol: string;
        translationDsSymbol: string;
        baseReflectionSymbol: string;
        chamberCount: number;
        sourceProjection: readonly number[];
        primitiveCells: readonly AbstractTranslationCell[];
        method: "connected-reflection-torus-fiber-product";
    }
    | { status: "unsupported" | "invalid" | "inconclusive"; reason: string };

export function unfoldUniformEuclideanQuotient(
    source: string, chamberLimit = 768
): RegularQuotientUnfolding {
    const unsupported = (reason: string): RegularQuotientUnfolding =>
        ({ status: "unsupported", reason });
    const inconclusive = (reason: string): RegularQuotientUnfolding =>
        ({ status: "inconclusive", reason });
    if (!Number.isSafeInteger(chamberLimit) || chamberLimit < 8 || chamberLimit > 1024)
        return unsupported("Invalid bounded unfolding chamber limit");
    const inspected = inspectDSymbol(source, chamberLimit);
    if (inspected.status === "limit-exceeded")
        return unsupported("Source exceeds bounded unfolding capacity");
    if (inspected.status !== "euclidean")
        return { status: "invalid", reason: "A valid Euclidean D-symbol is required" };
    const canonical = inspectDSymbol(inspected.symbol.canonical, chamberLimit);
    if (canonical.status !== "euclidean")
        return inconclusive("Cannot normalize source chamber numbering");
    const symbol = canonical.symbol;
    const p = symbol.m01[1], q = symbol.m12[1];
    if ((p - 2) * (q - 2) !== 4 ||
        symbol.m01.slice(1).some(value => value !== p) ||
        symbol.m12.slice(1).some(value => value !== q))
        return unsupported("The quotient has nonuniform polygon degrees or vertex valences; a general orbifold realization is required");

    const baseReflectionSymbol = `<1:1,1,1:${p},${q}>`;
    const realized = realizeOneChamberReflectionSymbol(baseReflectionSymbol,
        { edgeLengthWorldUnits: 1, units: "abstract" });
    if (realized.status !== "realized")
        return inconclusive("Could not establish the unbranched regular reflection torus");
    const seed = inspectDSymbol(realized.cover.translationSymbol, 1024);
    if (seed.status !== "euclidean" || !seed.symbol.fixedPointFree || !seed.symbol.weaklyOrientable)
        return inconclusive("Independent reflection torus is not a verified unbranched chamber cover");
    const torus = seed.symbol;
    if (torus.chamberCount * symbol.chamberCount > chamberLimit)
        return unsupported("The bounded fiber-product chamber count is too large");

    // Generate just one connected orbit of the direct product action. Other
    // orbits, if any, are separate equivalent pullback components and must not
    // be combined into a disconnected periodic cover.
    type Pair = readonly [number, number];
    const pairs: Pair[] = [[1, 1]];
    const which = new Map<number, number>();
    const pairKey = (t: number, s: number): number =>
        (t - 1) * symbol.chamberCount + s;
    which.set(pairKey(1, 1), 1);
    const involutions: [number[], number[], number[]] = [[0], [0], [0]];
    for (let index = 0; index < pairs.length; index++) {
        const [t, s] = pairs[index], here = index + 1;
        for (let k = 0; k < 3; k++) {
            const tNext = torus.involutions[k][t];
            const sNext = symbol.involutions[k][s];
            const key = pairKey(tNext, sNext);
            let next = which.get(key);
            if (!next) {
                if (pairs.length >= chamberLimit)
                    return unsupported("The connected unfolding exceeds its chamber limit");
                pairs.push([tNext, sNext]);
                next = pairs.length;
                which.set(key, next);
            }
            involutions[k][here] = next;
        }
    }
    const m01 = [0], m12 = [0];
    for (const [, s] of pairs) { m01.push(symbol.m01[s]); m12.push(symbol.m12[s]); }
    const expanded = inspectDSymbol(canonicalDSymbol(involutions, m01, m12), chamberLimit);
    if (expanded.status !== "euclidean" || !expanded.symbol.fixedPointFree
        || !expanded.symbol.weaklyOrientable)
        return inconclusive("Fiber product was not an unbranched orientable Euclidean chamber cover");

    // A valid finite unbranched cover of the torus is a torus. The independent
    // tree/cotree constructor supplies a primitive Z² voltage certificate.
    const cover = constructTranslationCoverFromSymbol(expanded.symbol.canonical, chamberLimit);
    if (cover.status !== "constructed")
        return inconclusive(`Connected fiber product failed torus construction: ${cover.reason}`);
    const projection = projectChambers(expanded.symbol, symbol);
    const ontoTorus = projectChambers(expanded.symbol, torus);
    if (!projection || !ontoTorus)
        return inconclusive("Expanded chambers do not project consistently onto both factors");

    // Reconstruct the entire advertised incidence and primitive lattice once
    // more from the generated boundary interfaces, independently of product
    // construction. Fail closed on a dishonest or nonprimitive presentation.
    try {
        validateWireTopologyWitness({
            contractVersion: 1,
            provenance: "connected-reflection-torus-fiber-product",
            quotientDsSymbol: symbol.canonical,
            translationDsSymbol: cover.sourceSymbol,
            motifCells: cover.cells.map(cell => ({
                id: `fiber-${cell.id}`,
                boundary: cell.boundary.map((edge, index) => ({
                    index,
                    boundarySideIndex: index,
                    targetMotifCellId: `fiber-${edge.targetCell}`,
                    targetTranslation: { u: edge.shift[0], v: edge.shift[1] },
                    reciprocalInterfaceIndex: edge.reciprocalEdge
                }))
            }))
        });
    } catch (error) {
        return inconclusive(`Unfolded periodic incidence is not independently verified: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
        status: "constructed",
        sourceSymbol: symbol.canonical,
        translationDsSymbol: cover.sourceSymbol,
        baseReflectionSymbol,
        chamberCount: cover.chamberCount,
        sourceProjection: projection,
        primitiveCells: cover.cells,
        method: "connected-reflection-torus-fiber-product"
    };
}
