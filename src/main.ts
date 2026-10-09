import type { AnalysisWorkerRequest, AnalysisWorkerResult } from "./analysis/periodic-tiling/worker-contract.js";
import { loadConfig } from "./config.js";
import { BoundedWorkerPool } from "./infrastructure/worker-pool.js";
import { log } from "./logging.js";
import { createPeriodicTilingResource } from "./resources/periodic-tiling/resource.js";
import { createPeriodicMotifInvestigationResource } from "./resources/periodic-tiling/investigation-resource.js";
import { createSurveyorServer } from "./server.js";

const config = loadConfig();
const periodicTilingPool = new BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>(
    new URL("./analysis/worker.js", import.meta.url),
    config.workerCount,
    config.queueLimit,
    config.analysisTimeoutMs);
const resources = [
    createPeriodicTilingResource({ config, pool: periodicTilingPool }),
    createPeriodicMotifInvestigationResource({ config, pool: periodicTilingPool })
] as const;
const server = createSurveyorServer({ resources, readiness: periodicTilingPool });

server.listen(config.port, "0.0.0.0", () => {
    log("info", "surveyor.started", {
        port: config.port,
        resources: resources.map(resource => resource.id),
        workerCount: config.workerCount,
        queueLimit: config.queueLimit,
        maxUploadBytes: config.maxUploadBytes,
        maxPixels: config.maxPixels
    });
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    log("info", "surveyor.stopping", { signal });
    server.close();
    await periodicTilingPool.close();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
