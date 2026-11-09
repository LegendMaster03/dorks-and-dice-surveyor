import type { GrayscaleRaster } from "../../image/raster.js";
import type {
    RegularLatticeDetection,
    RegularLatticeDetectionOptions,
    RegularTilingGeometryId
} from "./detector.js";

/** Production worker input; timingSink stays local to the worker thread. */
export type RegularTilingWorkerRequest = {
    raster: GrayscaleRaster;
    geometryId: RegularTilingGeometryId;
    options: Omit<RegularLatticeDetectionOptions, "timingSink">;
};

/** Total detector time includes the edge-field stage reported separately. */
export type RegularTilingWorkerResult = {
    detection: RegularLatticeDetection;
    edgeFieldMs: number;
    detectorTotalMs: number;
};
