import type { RegularTilingGeometryId } from "../../analysis/regular-tiling/detector.js";

export type PeriodicTilingDetectorId = "regular-lattice";

export type PeriodicTilingDefinition = {
    id: string;
    dsSymbol: string;
    detectorId: PeriodicTilingDetectorId;
    detectorGeometry: RegularTilingGeometryId;
};
