import { parentPort } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { detectRegularLattice } from "./regular-tiling/detector.js";
import { investigatePeriodicMotif } from "./periodic-tiling/experimental-observer.js";
import type { AnalysisWorkerRequest, AnalysisWorkerResult } from "./periodic-tiling/worker-contract.js";
import type { WorkerRequestEnvelope, WorkerResponseEnvelope } from "../infrastructure/worker-contract.js";

if (!parentPort) throw new Error("Surveyor analysis worker requires a worker-thread parent port.");

parentPort.on("message", (message: WorkerRequestEnvelope<AnalysisWorkerRequest>) => {
    const started = performance.now();
    let edgeFieldMs = 0;
    try {
        const payload = message.payload;
        if ("mode" in payload) {
            if (payload.mode !== "periodic-motif-investigation")
                throw new Error("Unknown analysis worker mode.");
            const observation = investigatePeriodicMotif(payload.raster);
            const result: AnalysisWorkerResult = {
                mode: "periodic-motif-investigation",
                observation,
                detectorTotalMs: performance.now() - started
            };
            const response: WorkerResponseEnvelope<AnalysisWorkerResult> = {
                jobId: message.jobId, ok: true, result
            };
            parentPort!.postMessage(response);
            return;
        }
        const geometryId = payload.geometryId;
        if (geometryId !== "regular.triangular"
            && geometryId !== "regular.square"
            && geometryId !== "regular.hexagonal") {
            throw new Error(`Unsupported Regular tiling detector geometry '${String(geometryId)}'.`);
        }
        const options = {
            ...payload.options,
            timingSink: (stage: string, durationMs: number) => {
                if (stage === "edge-field") edgeFieldMs = durationMs;
            }
        };
        const detection = detectRegularLattice(payload.raster, geometryId, options);
        const response: WorkerResponseEnvelope<AnalysisWorkerResult> = {
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
        const response: WorkerResponseEnvelope<AnalysisWorkerResult> = {
            jobId: message.jobId,
            ok: false,
            error: error instanceof Error ? error.message : "Unknown detector failure."
        };
        parentPort!.postMessage(response);
    }
});
