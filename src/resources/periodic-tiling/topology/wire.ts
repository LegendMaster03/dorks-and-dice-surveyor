import type { Point2 } from "./motif.js";
import type { MetricConstraint } from "./equivalence.js";

/** Additive v1 cross-repository topology contract; this is not the deployed Surveyor v2 API. */
export const PeriodicTopologyContractVersion = 1 as const;
export const PeriodicTopologyCapability = "tiling.topology.periodic-translation-cover" as const;
export type TopologyOutcome = "valid" | "invalid" | "unresolved-geometry" | "unsupported-limit" | "inconclusive";

export type WireTranslation = { u: number; v: number };
export type WireCellAddress = { motifCellId: string; translation: WireTranslation };
export type WireBoundaryInterface = {
    index: number;
    boundarySideIndex: number;
    targetMotifCellId: string;
    targetTranslation: WireTranslation;
    reciprocalInterfaceIndex: number;
};
export type WireMotifCell = { id: string; boundary: readonly WireBoundaryInterface[] };
export type WireTopologyWitness = {
    contractVersion: 1;
    quotientDsSymbol: string;
    translationDsSymbol: string;
    motifCells: readonly WireMotifCell[];
    provenance: string;
};
export type WireMetricRealization = {
    units: string;
    translationU: Point2;
    translationV: Point2;
    polygons: Readonly<Record<string, readonly Point2[]>>;
    constraints: readonly MetricConstraint[];
};
export type WireRasterRegistration = {
    sourceAssetId: string;
    pixelWidth: number;
    pixelHeight: number;
    worldToPixelAffine: readonly [number, number, number, number, number, number];
    rmsResidualPixels: number | null;
    observationConfidence: number | null;
};
export type WireTopologyEnvelope = {
    contractVersion: 1;
    capabilities: readonly string[];
    topology: WireTopologyWitness | null;
    realization: WireMetricRealization | null;
    registration: WireRasterRegistration | null;
    outcome: { status: TopologyOutcome; reason: string | null };
};
/** Capability negotiation is independent of the legacy image-detection route. */
export function negotiateTopologyVersion(local: readonly number[], remote: readonly number[]): 1 | null {
    return local.includes(PeriodicTopologyContractVersion) && remote.includes(PeriodicTopologyContractVersion)
        ? PeriodicTopologyContractVersion : null;
}
