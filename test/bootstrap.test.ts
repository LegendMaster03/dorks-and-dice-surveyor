import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type {
    AnalysisWorkerRequest,
    AnalysisWorkerResult
} from "../src/analysis/periodic-tiling/worker-contract.js";
import type { SurveyorConfig } from "../src/config.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";
import { createPeriodicTilingResource } from "../src/resources/periodic-tiling/resource.js";
import { createSurveyorServer } from "../src/server.js";

const config: SurveyorConfig = {
    port: 8080,
    serviceToken: "bootstrap-test-token-123456",
    maxUploadBytes: 1024,
    maxPixels: 1_000_000,
    workerCount: 1,
    queueLimit: 1,
    analysisTimeoutMs: 1000,
    analysisMaximumDimension: 2048
};

test("service identity advertises registered resources and periodic-tiling capability metadata", async () => {
    const pool = new BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>(
        new URL("../src/analysis/worker.js", import.meta.url),
        1,
        1,
        1000);
    const resources = [createPeriodicTilingResource({ config, pool })];
    const server = createSurveyorServer({ resources, readiness: pool });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected address.");
    try {
        const value = await (await fetch(`http://127.0.0.1:${address.port}/`)).json() as any;
        assert.equal(value.apiVersion, "v2");
        assert.deepEqual(value.resources, ["periodic-tiling"]);
        assert.equal(value.capabilities[0].id, "map.periodic-tiling.detect");
        assert.equal(value.capabilities[0].path, "/v2/periodic-tiling/detect");
        assert.deepEqual(value.capabilities[0].notationHint, {
            name: "expectedDsSymbol", notation: "Delaney-Dress", required: false
        });
        assert.deepEqual(value.capabilities[0].implementedTilings, [
            { dsSymbol: "<1:1,1,1:3,6>" },
            { dsSymbol: "<1:1,1,1:4,4>" },
            { dsSymbol: "<1:1,1,1:6,3>" }
        ]);
    } finally {
        server.close();
        await once(server, "close");
        await pool.close();
    }
});

test("server registration rejects duplicate resource ids, capability ids, and capability paths", () => {
    const readiness = {
        canAccept: true,
        snapshot: () => ({ workers: 0, busy: 0, queued: 0, queueLimit: 0 })
    };
    const resource = {
        id: "example",
        capabilities: [{ id: "example.capability", path: "/v1/example" }],
        matches: () => false,
        handle: async () => undefined
    };
    assert.throws(
        () => createSurveyorServer({ resources: [resource, resource], readiness }),
        /Duplicate Surveyor resource id/);

    const duplicateCapabilityId = {
        ...resource,
        id: "other-id",
        capabilities: [{ id: "example.capability", path: "/v1/other" }]
    };
    assert.throws(
        () => createSurveyorServer({ resources: [resource, duplicateCapabilityId], readiness }),
        /Duplicate Surveyor capability id/);

    const duplicateCapabilityPath = {
        ...resource,
        id: "other-path",
        capabilities: [{ id: "other.capability", path: "/v1/example" }]
    };
    assert.throws(
        () => createSurveyorServer({ resources: [resource, duplicateCapabilityPath], readiness }),
        /Duplicate Surveyor capability path/);
});
