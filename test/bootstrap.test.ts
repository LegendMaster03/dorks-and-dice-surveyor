import assert from "node:assert/strict";
import test from "node:test";
import type { SurveyorConfig } from "../src/config.js";
import type { HexGridWorkerRequest, HexGridWorkerResult } from "../src/analysis/hex-grid/worker-contract.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";
import { createSurveyorServer } from "../src/server.js";
import { once } from "node:events";

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

test("service identity advertises generic periodic-tiling detection", async () => {
    const pool = new BoundedWorkerPool<HexGridWorkerRequest, HexGridWorkerResult>(new URL("../src/analysis/worker.js", import.meta.url), 1, 1, 1000);
    const server = createSurveyorServer({ config, pool });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected address.");
    try {
        const value = await (await fetch(`http://127.0.0.1:${address.port}/`)).json() as any;
        assert.equal(value.apiVersion, "v1");
        assert.equal(value.capabilities[0].id, "map.periodic-tiling.detect");
        assert.deepEqual(value.capabilities[0].tilingTypes, [{
            name: "regular",
            implementedShapes: [{ name: "hex", sides: 6 }],
            selectors: ["shape", "sides"]
        }]);
    } finally {
        server.close();
        await once(server, "close");
        await pool.close();
    }
});
