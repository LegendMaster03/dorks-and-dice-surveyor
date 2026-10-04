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

export type WorkerRequestEnvelope<T> = {
    jobId: string;
    payload: T;
};

export type WorkerResponseEnvelope<T> =
    | { jobId: string; ok: true; result: T }
    | { jobId: string; ok: false; error: string };
