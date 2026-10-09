import type { GrayscaleRaster } from "../../image/raster.js";
import type { ExperimentalMotifResult } from "./experimental-observer.js";
import type { RegularTilingWorkerRequest, RegularTilingWorkerResult } from "../regular-tiling/worker-contract.js";

/** A separate worker request, deliberately not a regular-grid geometry selector. */
export type ExperimentalMotifWorkerRequest = {
    mode: "periodic-motif-investigation";
    raster: GrayscaleRaster;
};

export type ExperimentalMotifWorkerResult = {
    mode: "periodic-motif-investigation";
    observation: ExperimentalMotifResult;
    detectorTotalMs: number;
};

export type AnalysisWorkerRequest = RegularTilingWorkerRequest | ExperimentalMotifWorkerRequest;
export type AnalysisWorkerResult = RegularTilingWorkerResult | ExperimentalMotifWorkerResult;
