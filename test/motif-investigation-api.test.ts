import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import sharp from "sharp";
import type { AnalysisWorkerRequest, AnalysisWorkerResult } from "../src/analysis/periodic-tiling/worker-contract.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";
import { createPeriodicTilingResource } from "../src/resources/periodic-tiling/resource.js";
import { createPeriodicMotifInvestigationResource } from "../src/resources/periodic-tiling/investigation-resource.js";
import { createSurveyorServer } from "../src/server.js";

const token = "candidate-contract-token-123456789";
const path = "/v3/periodic-tiling/investigate";
const config = {
    port: 8080, serviceToken: token,
    maxUploadBytes: 1024 * 1024, maxPixels: 1_000_000,
    workerCount: 1, queueLimit: 1,
    analysisTimeoutMs: 10000, analysisMaximumDimension: 2048
};
async function withService(check: (base: string) => Promise<void>): Promise<void> {
    const pool = new BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>(
        new URL("../src/analysis/worker.js", import.meta.url),
        config.workerCount, config.queueLimit, config.analysisTimeoutMs);
    const server = createSurveyorServer({
        resources: [
            createPeriodicTilingResource({ config, pool }),
            createPeriodicMotifInvestigationResource({ config, pool })
        ],
        readiness: pool
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw Error("Expected TCP address");
    try { await check(`http://127.0.0.1:${address.port}`); }
    finally {
        server.close();
        await once(server, "close");
        await pool.close();
    }
}
async function whiteImage(): Promise<ArrayBuffer> {
    const png = await sharp({
        create: { width: 128, height: 128, channels: 3, background: "#ffffff" }
    }).png().toBuffer();
    return Uint8Array.from(png).buffer;
}

test("preview is opt-in, discoverable as experimental, and never a detected identity", async () => {
    await withService(async base => {
        const root = await (await fetch(base)).json() as any;
        const preview = root.capabilities.find((c: any) => c.id === "map.periodic-tiling.investigate");
        assert.equal(preview.path, path);
        assert.equal(preview.maturity, "experimental");
        assert.equal(preview.authoritative, false);
        const old = root.capabilities.find((c: any) => c.id === "map.periodic-tiling.detect");
        assert.equal(old.path, "/v2/periodic-tiling/detect");
        const image = await whiteImage();
        const res = await fetch(base + path, {
            method: "POST",
            headers: {
                authorization: "Bearer " + token, "content-type": "image/png",
                "x-correlation-id": "phase16-investigation"
            },
            body: image
        });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-correlation-id"), "phase16-investigation");
        assert.match(res.headers.get("server-timing") ?? "", /detector;dur=/);
        const body = await res.json() as any;
        assert.equal(body.apiVersion, "v3");
        assert.equal(body.capability, "map.periodic-tiling.investigate");
        assert.equal(body.maturity, "experimental");
        assert.equal(body.authoritative, false);
        assert.equal(body.status, "inconclusive");
        assert.equal(body.candidate, null);
        assert.equal(body.evidence, null);
        assert.equal(body.source.width, 128);
        assert.equal(body.analysis.sourceResolutionVerified, true);
        // The existing v2 resource is still registered, authenticated and operational.
        const v2 = await fetch(base + "/v2/periodic-tiling/detect", {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "image/png" },
            body: image
        });
        assert.equal(v2.status, 200);
        const legacy = await v2.json() as any;
        assert.equal(legacy.apiVersion, "v2");
        assert.equal(legacy.status, "gridless");
        assert.equal(legacy.tiling, null);
    });
});

test("preview rejects hints, unauthenticated requests, and unsupported images with versioned errors", async () => {
    await withService(async base => {
        const image = await whiteImage();
        const noToken = await fetch(base + path, {
            method: "POST", headers: { "content-type": "image/png" }, body: image
        });
        assert.equal(noToken.status, 401);
        const unauthorized = await noToken.json() as any;
        assert.equal(unauthorized.apiVersion, "v3");
        assert.equal(unauthorized.error.code, "unauthorized");
        const hint = await fetch(base + path + "?expectedDsSymbol=%3C1%3A1%2C1%2C1%3A4%2C4%3E", {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "image/png" },
            body: image
        });
        assert.equal(hint.status, 400);
        assert.equal((await hint.json() as any).error.code, "unsupported_investigation_options");
        const badImage = await fetch(base + path, {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "image/png" },
            body: Uint8Array.from(Buffer.from("invalid")).buffer
        });
        assert.equal(badImage.status, 422);
        assert.equal((await badImage.json() as any).apiVersion, "v3");
    });
});
