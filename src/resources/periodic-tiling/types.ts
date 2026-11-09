import type { RegularTilingGeometryId } from "../../analysis/regular-tiling/detector.js";

export type PeriodicTilingDetectorId = "regular-lattice";

/** Maps a recognized canonical tiling identity to a production detector implementation. */
export type PeriodicTilingDefinition = {
    id: string;
    dsSymbol: string;
    detectorId: PeriodicTilingDetectorId;
    detectorGeometry: RegularTilingGeometryId;
};
