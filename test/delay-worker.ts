import { parentPort } from "node:worker_threads";
import type { WorkerRequestEnvelope, WorkerResponseEnvelope } from "../src/analysis/hex-grid/worker-contract.js";

type Request = { delayMs: number; value: number };
if (!parentPort) throw new Error("delay worker requires parent port");
parentPort.on("message", (message: WorkerRequestEnvelope<Request>) => {
    setTimeout(() => {
        const response: WorkerResponseEnvelope<number> = { jobId: message.jobId, ok: true, result: message.payload.value };
        parentPort!.postMessage(response);
    }, message.payload.delayMs);
});
