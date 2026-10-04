import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { detectHexLattice } from "./hex-grid/detector.js";
import type { HexGridWorkerRequest, HexGridWorkerResult } from "./hex-grid/worker-contract.js";
import type { WorkerRequestEnvelope, WorkerResponseEnvelope } from "../infrastructure/worker-contract.js";

if (!parentPort) throw new Error("Surveyor analysis worker requires a worker-thread parent port.");

parentPort.on("message", (message: WorkerRequestEnvelope<HexGridWorkerRequest>) => {
    const started = performance.now();
    let edgeFieldMs = 0;
    try {
        const options = {
            ...message.payload.options,
            timingSink: (stage: string, durationMs: number) => {
                if (stage === "edge-field") edgeFieldMs = durationMs;
            }
        };
        const detection = detectHexLattice(message.payload.raster, options);
        const response: WorkerResponseEnvelope<HexGridWorkerResult> = {
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
        const response: WorkerResponseEnvelope<HexGridWorkerResult> = {
            jobId: message.jobId,
            ok: false,
            error: error instanceof Error ? error.message : "Unknown detector failure."
        };
        parentPort!.postMessage(response);
    }
});
