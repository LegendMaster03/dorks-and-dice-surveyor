export type PeriodicTilingType =
    | "Regular"
    | "semiregular"
    | "k-uniform"
    | "Plane-vertex"
    | "2-uniform"
    | "Fractalizing"
    | "non-edge-to-edge";

export type PeriodicTilingDetectorId = "regular.hexagonal";

export type PeriodicTilingDefinition = {
    id: string;
    periodicTilingType: PeriodicTilingType;
    crNotation: string;
    gjhNotation: string;
    detectorId?: PeriodicTilingDetectorId;
};

export class PeriodicTilingNotationError extends Error {
    constructor(
        public readonly notation: "Cundy-Rollett" | "GomJau-Hogg",
        message: string) {
        super(message);
        this.name = "PeriodicTilingNotationError";
    }
}
