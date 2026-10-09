import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import sharp from "sharp";
import type {
    RegularTilingWorkerRequest,
    RegularTilingWorkerResult
} from "../src/analysis/regular-tiling/worker-contract.js";
import type { SurveyorConfig } from "../src/config.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";
import { createPeriodicTilingResource } from "../src/resources/periodic-tiling/resource.js";
import { createSurveyorServer } from "../src/server.js";

const token = "test-surveyor-token-123456789";
const regularHexQuery = "expectedDsSymbol=" + encodeURIComponent("<1:1,1,1:6,3>");

async function withServer(run: (baseUrl: string) => Promise<void>, overrides: Partial<SurveyorConfig> = {}): Promise<void> {
    const config: SurveyorConfig = {
        port: 8080,
        serviceToken: token,
        maxUploadBytes: 1024 * 1024,
        maxPixels: 1_000_000,
        workerCount: 1,
        queueLimit: 1,
        analysisTimeoutMs: 10_000,
        analysisMaximumDimension: 2048,
        ...overrides
    };
    const pool = new BoundedWorkerPool<RegularTilingWorkerRequest, RegularTilingWorkerResult>(
        new URL("../src/analysis/worker.js", import.meta.url),
        config.workerCount,
        config.queueLimit,
        config.analysisTimeoutMs);
    const resources = [createPeriodicTilingResource({ config, pool })];
    const server = createSurveyorServer({ resources, readiness: pool });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        server.close();
        await once(server, "close");
        await pool.close();
    }
}

async function plainImage(format: "png" | "jpeg" | "webp", size = 96): Promise<Buffer> {
    const image = sharp({ create: { width: size, height: size, channels: 3, background: "white" } });
    if (format === "png") return image.png().toBuffer();
    if (format === "jpeg") return image.jpeg({ quality: 95 }).toBuffer();
    return image.webp({ quality: 95 }).toBuffer();
}

async function plainPng(size = 96): Promise<Buffer> {
    return plainImage("png", size);
}

function bodyOf(buffer: Buffer): ArrayBuffer {
    const copy = Uint8Array.from(buffer);
    return copy.buffer;
}

function regularIdentity(dsSymbol: string): Record<string, unknown> {
    return { dsSymbol };
}

test("health endpoints do not require analysis authentication", async () => {
    await withServer(async baseUrl => {
        assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
        assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 200);
    });
});

test("analysis requires bearer authentication", async () => {
    await withServer(async baseUrl => {
        const body = bodyOf(await plainPng());
        const route = `${baseUrl}/v1/periodic-tiling/detect?${regularHexQuery}`;
        assert.equal((await fetch(route, { method: "POST", headers: { "content-type": "image/png" }, body })).status, 401);
        assert.equal((await fetch(route, { method: "POST", headers: { "content-type": "image/png", authorization: "Bearer wrong" }, body })).status, 401);
    });
});

test("automatic detection accepts no hint and does not echo expected identity", async () => {
    await withServer(async baseUrl => {
        const headers = { "content-type": "image/png", authorization: "Bearer " + token };
        const encoded = await plainPng();
        const route = baseUrl + "/v1/periodic-tiling/detect";
        const send = (query: string) => fetch(route + (query ? "?" + query : ""),
            { method: "POST", headers, body: bodyOf(encoded) });
        for (const query of [
            "",
            "expectedDsSymbol=" + encodeURIComponent("<1:1,1,1:3,6>"),
            "expectedDsSymbol=" + encodeURIComponent("<1:1,1,1:4,4>"),
            "expectedDsSymbol=" + encodeURIComponent("<1.1:1:1,1,1:6,3>")
        ]) {
            const response = await send(query);
            assert.equal(response.status, 200, query);
            const result = await response.json() as Record<string, any>;
            assert.equal(result.status, "gridless");
            assert.equal(result.tiling, null, "A hint is not an observation");
        }
        assert.equal((await send("crNotation=6%5E3")).status, 400);
        assert.equal((await send("gjhNotation=6%2Fm30%2Fr(h1)")).status, 400);
        assert.equal((await send("expectedDsSymbol=invalid")).status, 400);
        assert.equal((await send("shape=hex")).status, 400);
    });
});

test("versioned analysis returns provider-neutral contract and correlation id", async () => {
    await withServer(async baseUrl => {
        const body = bodyOf(await plainPng());
        const response = await fetch(`${baseUrl}/v1/periodic-tiling/detect?${regularHexQuery}&minimumConfidence=0.54`, {
            method: "POST",
            headers: {
                "content-type": "image/png",
                authorization: `Bearer ${token}`,
                "x-correlation-id": "contract-test"
            },
            body
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("x-correlation-id"), "contract-test");
        assert.match(response.headers.get("server-timing") ?? "", /detector;dur=/);
        const value = await response.json() as Record<string, any>;
        assert.equal(value.apiVersion, "v1");
        assert.equal(value.capability, "map.periodic-tiling.detect");
        assert.equal(value.tiling, null);
        assert.ok(["detected", "inconclusive", "gridless"].includes(value.status));
        assert.deepEqual(value.source, { width: 96, height: 96, mediaType: "image/png" });
        assert.equal(value.analysis.sourceResolutionVerified, true);
        assert.ok(value.fit === null);
        assert.ok(value.tiling === null);
    });
});

test("PNG JPEG and WebP traverse decode grayscale detector and source-coordinate response", async () => {
    await withServer(async baseUrl => {
        for (const fixture of [
            { format: "png", mediaType: "image/png" },
            { format: "jpeg", mediaType: "image/jpeg" },
            { format: "webp", mediaType: "image/webp" }
        ] as const) {
            const response = await fetch(`${baseUrl}/v1/periodic-tiling/detect?${regularHexQuery}`, {
                method: "POST",
                headers: {
                    "content-type": fixture.mediaType,
                    authorization: `Bearer ${token}`
                },
                body: bodyOf(await plainImage(fixture.format))
            });
            assert.equal(response.status, 200, fixture.mediaType);
            const value = await response.json() as Record<string, any>;
            assert.equal(value.source.mediaType, fixture.mediaType);
            assert.equal(value.source.width, 96);
            assert.equal(value.source.height, 96);
            assert.equal(value.analysis.width, 96);
            assert.equal(value.analysis.height, 96);
            assert.equal(value.analysis.scale, 1);
            assert.equal(value.status, "gridless");
            assert.equal(value.fit, null);
        }
    });
});

test("same encoded input produces deterministic analysis apart from timing", async () => {
    await withServer(async baseUrl => {
        const encoded = await plainPng();
        const analyze = async () => {
            const response = await fetch(`${baseUrl}/v1/periodic-tiling/detect?${regularHexQuery}`, {
                method: "POST",
                headers: { "content-type": "image/png", authorization: `Bearer ${token}` },
                body: bodyOf(encoded)
            });
            assert.equal(response.status, 200);
            const value = await response.json() as Record<string, any>;
            delete value.timing;
            return value;
        };
        assert.deepEqual(await analyze(), await analyze());
    });
});

test("invalid options, unsupported media, malformed image, and upload limit are distinct", async () => {
    await withServer(async baseUrl => {
        const body = bodyOf(await plainPng());
        const headers = { authorization: `Bearer ${token}` };
        const route = `${baseUrl}/v1/periodic-tiling/detect?${regularHexQuery}`;
        assert.equal((await fetch(`${route}&minimumConfidence=NaN`, { method: "POST", headers: { ...headers, "content-type": "image/png" }, body })).status, 400);
        assert.equal((await fetch(route, { method: "POST", headers: { ...headers, "content-type": "image/gif" }, body })).status, 415);
        assert.equal((await fetch(route, { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: bodyOf(Buffer.from("bad")) })).status, 422);
    });
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/v1/periodic-tiling/detect?${regularHexQuery}`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
            body: bodyOf(Buffer.alloc(129))
        });
        assert.equal(response.status, 413);
    }, { maxUploadBytes: 128 });
});
