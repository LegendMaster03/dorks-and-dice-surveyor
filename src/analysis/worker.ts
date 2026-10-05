import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { detectRegularLattice } from "./regular-tiling/detector.js";
import type { RegularTilingWorkerRequest, RegularTilingWorkerResult } from "./regular-tiling/worker-contract.js";
import type { WorkerRequestEnvelope, WorkerResponseEnvelope } from "../infrastructure/worker-contract.js";

if (!parentPort) throw new Error("Surveyor analysis worker requires a worker-thread parent port.");

parentPort.on("message", (message: WorkerRequestEnvelope<RegularTilingWorkerRequest>) => {
    const started = performance.now();
    let edgeFieldMs = 0;
    try {
        const geometryId = message.payload.geometryId;
        if (geometryId !== "regular.triangular"
            && geometryId !== "regular.square"
            && geometryId !== "regular.hexagonal") {
            throw new Error(`Unsupported Regular tiling detector geometry '${String(geometryId)}'.`);
        }
        const options = {
            ...message.payload.options,
            timingSink: (stage: string, durationMs: number) => {
                if (stage === "edge-field") edgeFieldMs = durationMs;
            }
        };
        const detection = detectRegularLattice(
            message.payload.raster,
            geometryId,
            options);
        const response: WorkerResponseEnvelope<RegularTilingWorkerResult> = {
            jobId: message.jobId,
            ok: true,
            result: {
                detection,
                edgeFieldMs,
                detectorTotalMs: performance.now() - started
            }
        };
        parentPort!.postMessage(response);
    } catch (error) {
        const response: WorkerResponseEnvelope<RegularTilingWorkerResult> = {
            jobId: message.jobId,
            ok: false,
            error: error instanceof Error ? error.message : "Unknown detector failure."
        };
        parentPort!.postMessage(response);
    }
});
