import { parseCundyRollettNotation, parseGomJauHoggNotation } from "./notation/index.js";
import type { PeriodicTilingDefinition } from "./types.js";

const definitions: readonly PeriodicTilingDefinition[] = [
    {
        id: "regular.triangular",
        periodicTilingType: "Regular",
        crNotation: "3^6",
        gjhNotation: "3/m30/r(h2)"
    },
    {
        id: "regular.square",
        periodicTilingType: "Regular",
        crNotation: "4^4",
        gjhNotation: "4/m45/r(h1)"
    },
    {
        id: "regular.hexagonal",
        periodicTilingType: "Regular",
        crNotation: "6^3",
        gjhNotation: "6/m30/r(h1)",
        detectorId: "regular.hexagonal"
    }
] as const;

const byCundyRollett = new Map<string, PeriodicTilingDefinition[]>();
const byGomJauHogg = new Map<string, PeriodicTilingDefinition>();
const ids = new Set<string>();

for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate periodic-tiling id '${definition.id}'.`);
    ids.add(definition.id);

    const crCanonical = parseCundyRollettNotation(definition.crNotation).canonical;
    const crCandidates = byCundyRollett.get(crCanonical) ?? [];
    crCandidates.push(definition);
    byCundyRollett.set(crCanonical, crCandidates);

    const gjhCanonical = parseGomJauHoggNotation(definition.gjhNotation).canonical;
    if (byGomJauHogg.has(gjhCanonical)) {
        throw new Error(`Duplicate GomJau-Hogg periodic-tiling identity '${gjhCanonical}'.`);
    }
    byGomJauHogg.set(gjhCanonical, definition);
}

export const periodicTilingDefinitions = definitions;

export function findPeriodicTilingsByCundyRollett(canonical: string): readonly PeriodicTilingDefinition[] {
    return byCundyRollett.get(canonical) ?? [];
}

export function findPeriodicTilingByGomJauHogg(canonical: string): PeriodicTilingDefinition | undefined {
    return byGomJauHogg.get(canonical);
}
