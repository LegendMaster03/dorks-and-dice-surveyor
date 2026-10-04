import { loadConfig } from "./config.js";
import { log } from "./logging.js";
import { createSurveyorServer } from "./server.js";
import type { HexGridWorkerRequest, HexGridWorkerResult } from "./analysis/hex-grid/worker-contract.js";
import { BoundedWorkerPool } from "./infrastructure/worker-pool.js";

const config = loadConfig();
const pool = new BoundedWorkerPool<HexGridWorkerRequest, HexGridWorkerResult>(
    new URL("./analysis/worker.js", import.meta.url),
    config.workerCount,
    config.queueLimit,
    config.analysisTimeoutMs);
const server = createSurveyorServer({ config, pool });
server.listen(config.port, "0.0.0.0", () => {
    log("info", "surveyor.started", {
        port: config.port,
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
    await pool.close();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
