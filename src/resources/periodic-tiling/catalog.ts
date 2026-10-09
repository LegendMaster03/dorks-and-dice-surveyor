import { parseDelaneyDressNotation } from "./notation/index.js";
import type { PeriodicTilingDefinition } from "./types.js";

// Registrations identify implemented detectors; arbitrary valid D-symbols are not catalog-gated.
const definitions: readonly PeriodicTilingDefinition[] = [
    { id: "regular.triangular", dsSymbol: "<1:1,1,1:3,6>", detectorId: "regular-lattice", detectorGeometry: "regular.triangular" },
    { id: "regular.square", dsSymbol: "<1:1,1,1:4,4>", detectorId: "regular-lattice", detectorGeometry: "regular.square" },
    { id: "regular.hexagonal", dsSymbol: "<1:1,1,1:6,3>", detectorId: "regular-lattice", detectorGeometry: "regular.hexagonal" }
];

const bySymbol = new Map<string, PeriodicTilingDefinition>();
for (const definition of definitions) {
    const canonical = parseDelaneyDressNotation(definition.dsSymbol).canonical;
    if (canonical !== definition.dsSymbol || bySymbol.has(canonical)) {
        throw new Error("Noncanonical or duplicate D-symbol: " + definition.dsSymbol);
    }
    bySymbol.set(canonical, definition);
}

export const periodicTilingDefinitions = definitions;

export function findPeriodicTilingByDsSymbol(canonical: string): PeriodicTilingDefinition | undefined {
    return bySymbol.get(canonical);
}
