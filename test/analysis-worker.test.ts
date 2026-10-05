import assert from "node:assert/strict";
import test from "node:test";
import type {
    RegularTilingWorkerRequest,
    RegularTilingWorkerResult
} from "../src/analysis/regular-tiling/worker-contract.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";

test("analysis worker rejects an unknown Regular geometry instead of silently using square", async () => {
    const pool = new BoundedWorkerPool<RegularTilingWorkerRequest, RegularTilingWorkerResult>(
        new URL("../src/analysis/worker.js", import.meta.url),
        1,
        1,
        1000);
    try {
        const malformed = {
            raster: { width: 16, height: 16, pixels: new Uint8Array(16 * 16).fill(224) },
            geometryId: "regular.unknown",
            options: {}
        } as unknown as RegularTilingWorkerRequest;
        await assert.rejects(
            pool.run(malformed),
            /Unsupported Regular tiling detector geometry 'regular\.unknown'/);
    } finally {
        await pool.close();
    }
});
