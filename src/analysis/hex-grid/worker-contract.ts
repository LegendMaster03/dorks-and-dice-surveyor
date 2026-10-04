import type { GrayscaleRaster, HexLatticeDetection, HexLatticeDetectionOptions } from "./detector.js";

export type HexGridWorkerRequest = {
    raster: GrayscaleRaster;
    options: HexLatticeDetectionOptions;
};

export type HexGridWorkerResult = {
    detection: HexLatticeDetection;
    edgeFieldMs: number;
    detectorTotalMs: number;
};

// Transitional re-exports preserve source compatibility while the generic worker
// envelope now belongs to service infrastructure rather than this hex detector.
export type {
    WorkerRequestEnvelope,
    WorkerResponseEnvelope
} from "../../infrastructure/worker-contract.js";
