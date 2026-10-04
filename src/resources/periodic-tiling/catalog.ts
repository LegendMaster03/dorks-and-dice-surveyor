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

const byCundyRollett = new Map(
    definitions.map(definition => [parseCundyRollettNotation(definition.crNotation).canonical, definition]));
const byGomJauHogg = new Map(
    definitions.map(definition => [parseGomJauHoggNotation(definition.gjhNotation).canonical, definition]));

export const periodicTilingDefinitions = definitions;

export function findPeriodicTilingByCundyRollett(canonical: string): PeriodicTilingDefinition | undefined {
    return byCundyRollett.get(canonical);
}

export function findPeriodicTilingByGomJauHogg(canonical: string): PeriodicTilingDefinition | undefined {
    return byGomJauHogg.get(canonical);
}
