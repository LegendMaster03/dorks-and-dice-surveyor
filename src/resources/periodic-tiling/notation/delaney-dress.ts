/**
 * The deployed Surveyor numerical D-symbol parser remains an API-compatible
 * adapter. Mathematical validation and canonicalization are centralized in
 * the Phase 16 chamber-system implementation, never in the detector catalog.
 */
import { inspectDSymbol } from "../topology/d-symbol.js";

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

export function parseDelaneyDressNotation(raw: string): DelaneyDressSymbol {
    // Preserve the existing optional trailing catalog-comment convention.
    const source = raw.trim().replace(/\s*#.*$/s, "").trim();
    const result = inspectDSymbol(source);
    if (result.status !== "euclidean") {
        throw new DelaneyDressNotationError(
            result.status === "non-euclidean"
                ? "The D-symbol is not Euclidean (curvature must be zero)."
                : result.reason);
    }
    return {
        notation: "Delaney-Dress",
        canonical: result.symbol.canonical,
        size: result.symbol.chamberCount,
        neighbors: result.symbol.involutions,
        m01: result.symbol.m01,
        m12: result.symbol.m12
    };
}
