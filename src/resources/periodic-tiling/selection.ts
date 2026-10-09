import { SurveyorRequestError } from "../../errors.js";
import { findPeriodicTilingByDsSymbol, periodicTilingDefinitions } from "./catalog.js";
import { DelaneyDressNotationError, parseDelaneyDressNotation } from "./notation/index.js";
import type { PeriodicTilingDefinition } from "./types.js";

export type PeriodicTilingSelection = {
    expectedDsSymbol: string | null;
    prioritizedDetectors: readonly PeriodicTilingDefinition[];
};

/** An expected symbol prioritizes evaluation, but never fixes the observed identity. */
export function selectPeriodicTiling(parameters: URLSearchParams): PeriodicTilingSelection {
    if (parameters.has("crNotation") || parameters.has("gjhNotation")
        || parameters.has("dsSymbol") || parameters.has("periodicTilingType")
        || parameters.has("shape") || parameters.has("sides")) {
        throw new SurveyorRequestError(
            400, "tiling_selector_invalid",
            "Use only optional expectedDsSymbol to prioritize image analysis.");
    }
    const values = parameters.getAll("expectedDsSymbol");
    if (values.length > 1) {
        throw new SurveyorRequestError(400, "tiling_hint_count", "expectedDsSymbol may occur only once.");
    }
    let expectedDsSymbol: string | null = null;
    if (values.length === 1) {
        try {
            expectedDsSymbol = parseDelaneyDressNotation(values[0]).canonical;
        } catch (error) {
            if (error instanceof DelaneyDressNotationError) {
                throw new SurveyorRequestError(400, "invalid_ds_symbol", error.message);
            }
            throw error;
        }
    }
    const priority = expectedDsSymbol == null ? null : findPeriodicTilingByDsSymbol(expectedDsSymbol);
    const prioritizedDetectors = priority == null
        ? [...periodicTilingDefinitions]
        : [priority, ...periodicTilingDefinitions.filter(item => item.id !== priority.id)];
    return { expectedDsSymbol, prioritizedDetectors };
}
