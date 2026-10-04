import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { HexGridWorkerRequest, HexGridWorkerResult } from "../src/analysis/hex-grid/worker-contract.js";
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
    const pool = new BoundedWorkerPool<HexGridWorkerRequest, HexGridWorkerResult>(
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
        assert.equal(value.apiVersion, "v1");
        assert.deepEqual(value.resources, ["periodic-tiling"]);
        assert.equal(value.capabilities[0].id, "map.periodic-tiling.detect");
        assert.equal(value.capabilities[0].path, "/v1/periodic-tiling/detect");
        assert.deepEqual(value.capabilities[0].notationSelectors, [
            {
                name: "crNotation",
                kind: "notation",
                notation: "Cundy-Rollett",
                required: false,
                preferred: true
            },
            {
                name: "gjhNotation",
                kind: "notation",
                notation: "GomJau-Hogg",
                required: false,
                preferred: false
            }
        ]);
        assert.deepEqual(value.capabilities[0].derivedIdentity, ["periodicTilingType", "crNotation", "gjhNotation"]);
        assert.deepEqual(value.capabilities[0].implementedTilings, [{
            periodicTilingType: "Regular",
            crNotation: "6^3",
            gjhNotation: "6/m30/r(h1)"
        }]);
        assert.deepEqual(value.capabilities[0].recognizedTilingFamilies, [
            { name: "Regular", implemented: true },
            { name: "semiregular", implemented: false, subtypes: ["Archimedean", "uniform"] },
            { name: "k-uniform", implemented: false },
            { name: "Plane-vertex", implemented: false },
            { name: "2-uniform", implemented: false },
            { name: "Fractalizing", implemented: false },
            { name: "non-edge-to-edge", implemented: false }
        ]);
    } finally {
        server.close();
        await once(server, "close");
        await pool.close();
    }
});

test("server registration is resource-generic and rejects duplicate resource ids", () => {
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
});
