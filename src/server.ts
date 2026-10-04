import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { SurveyorConfig } from "./config.js";
import { SurveyorApiVersion } from "./contracts.js";
import { writeError, writeJson } from "./http.js";
import type { HexGridWorkerRequest, HexGridWorkerResult } from "./analysis/hex-grid/worker-contract.js";
import type { BoundedWorkerPool } from "./infrastructure/worker-pool.js";
import { createPeriodicTilingResource } from "./resources/periodic-tiling/resource.js";
import type { SurveyorResource } from "./resources/resource.js";

export type SurveyorDependencies = {
    config: SurveyorConfig;
    pool: BoundedWorkerPool<HexGridWorkerRequest, HexGridWorkerResult>;
};

export function createSurveyorServer(dependencies: SurveyorDependencies): Server {
    const resources: readonly SurveyorResource[] = [createPeriodicTilingResource(dependencies)];
    return createHttpServer((request, response) => {
        void route(request, response, dependencies, resources).catch(error => {
            if (!response.headersSent) writeError(response, error, "surveyor");
            else response.destroy();
        });
    });
}

async function route(
    request: IncomingMessage,
    response: ServerResponse,
    dependencies: SurveyorDependencies,
    resources: readonly SurveyorResource[]): Promise<void> {
    const url = new URL(request.url ?? "/", "http://surveyor.local");

    if (request.method === "GET" && url.pathname === "/health/live") {
        return writeJson(response, 200, { status: "live", service: "surveyor" });
    }

    if (request.method === "GET" && url.pathname === "/health/ready") {
        const snapshot = dependencies.pool.snapshot();
        const ready = dependencies.pool.canAccept;
        return writeJson(response, ready ? 200 : 503, {
            status: ready ? "ready" : "overloaded",
            service: "surveyor",
            acceptingWork: ready,
            workers: snapshot.workers,
            busyWorkers: snapshot.busy,
            queued: snapshot.queued,
            queueLimit: snapshot.queueLimit
        });
    }

    if (request.method === "GET" && url.pathname === "/") {
        return writeJson(response, 200, {
            service: "Dorks & Dice Surveyor",
            apiVersion: SurveyorApiVersion,
            resources: resources.map(resource => resource.id),
            capabilities: resources.flatMap(resource => resource.capabilities)
        });
    }

    const resource = resources.find(candidate => candidate.matches(request.method, url.pathname));
    if (resource) {
        await resource.handle(request, response, url);
        return;
    }

    writeJson(response, 404, { error: "not_found" });
}
