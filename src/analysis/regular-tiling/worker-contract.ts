import type {
    GrayscaleRaster,
    RegularLatticeDetection,
    RegularLatticeDetectionOptions,
    RegularTilingGeometryId
} from "./detector.js";

export type RegularTilingWorkerRequest = {
    raster: GrayscaleRaster;
    geometryId: RegularTilingGeometryId;
    options: Omit<RegularLatticeDetectionOptions, "timingSink">;
};

export type RegularTilingWorkerResult = {
    detection: RegularLatticeDetection;
    edgeFieldMs: number;
    detectorTotalMs: number;
};
