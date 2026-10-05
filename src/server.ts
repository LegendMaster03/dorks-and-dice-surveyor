import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SurveyorApiVersion } from "./contracts.js";
import { writeError, writeJson } from "./http.js";
import type { SurveyorResource } from "./resources/resource.js";

export type SurveyorReadinessSnapshot = {
    workers: number;
    busy: number;
    queued: number;
    queueLimit: number;
};

export type SurveyorReadinessProvider = {
    readonly canAccept: boolean;
    snapshot(): SurveyorReadinessSnapshot;
};

export type SurveyorServerDependencies = {
    resources: readonly SurveyorResource[];
    readiness: SurveyorReadinessProvider;
};

export function createSurveyorServer(dependencies: SurveyorServerDependencies): Server {
    const resources = [...dependencies.resources];
    assertUniqueResourceRegistration(resources);

    return createHttpServer((request, response) => {
        void route(request, response, dependencies.readiness, resources).catch(error => {
            if (!response.headersSent) writeError(response, error, "surveyor");
            else response.destroy();
        });
    });
}

async function route(
    request: IncomingMessage,
    response: ServerResponse,
    readiness: SurveyorReadinessProvider,
    resources: readonly SurveyorResource[]): Promise<void> {
    const url = new URL(request.url ?? "/", "http://surveyor.local");

    if (request.method === "GET" && url.pathname === "/health/live") {
        return writeJson(response, 200, { status: "live", service: "surveyor" });
    }

    if (request.method === "GET" && url.pathname === "/health/ready") {
        const snapshot = readiness.snapshot();
        const ready = readiness.canAccept;
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

function assertUniqueResourceRegistration(resources: readonly SurveyorResource[]): void {
    const resourceIds = new Set<string>();
    const capabilityIds = new Set<string>();
    const capabilityPaths = new Set<string>();

    for (const resource of resources) {
        if (resourceIds.has(resource.id)) {
            throw new Error(`Duplicate Surveyor resource id '${resource.id}'.`);
        }
        resourceIds.add(resource.id);

        for (const capability of resource.capabilities) {
            if (capabilityIds.has(capability.id)) {
                throw new Error(`Duplicate Surveyor capability id '${capability.id}'.`);
            }
            capabilityIds.add(capability.id);

            if (capabilityPaths.has(capability.path)) {
                throw new Error(`Duplicate Surveyor capability path '${capability.path}'.`);
            }
            capabilityPaths.add(capability.path);
        }
    }
}
