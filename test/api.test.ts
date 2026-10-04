import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import sharp from "sharp";
import type { SurveyorConfig } from "../src/config.js";
import type { HexGridWorkerRequest, HexGridWorkerResult } from "../src/analysis/hex-grid/worker-contract.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";
import { createSurveyorServer } from "../src/server.js";

const token = "test-surveyor-token-123456789";
const regularHexQuery = "periodicTilingType=Regular&cundyRollettNotation=6%5E3";

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
    const pool = new BoundedWorkerPool<HexGridWorkerRequest, HexGridWorkerResult>(
        new URL("../src/analysis/worker.js", import.meta.url),
        config.workerCount,
        config.queueLimit,
        config.analysisTimeoutMs);
    const server = createSurveyorServer({ config, pool });
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

function expectedRegularHexIdentity(): Record<string, unknown> {
    return {
        periodicTilingType: "Regular",
        cundyRollettNotation: "6^3",
        gomJauHoggNotation: "6/m30/r(h1)",
        shapes: [{ name: "hex", sides: 6 }]
    };
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

test("periodic tiling type selects a family-specific selector contract", async () => {
    await withServer(async baseUrl => {
        const headers = { "content-type": "image/png", authorization: `Bearer ${token}` };
        const encoded = await plainPng();
        const route = `${baseUrl}/v1/periodic-tiling/detect`;
        const send = (query: string) => fetch(`${route}?${query}`, { method: "POST", headers, body: bodyOf(encoded) });

        assert.equal((await send("cundyRollettNotation=6%5E3")).status, 400);
        assert.equal((await send("periodicTilingType=semiregular&semiregularType=Archimedean")).status, 501);
        assert.equal((await send("periodicTilingType=k-uniform")).status, 501);
        assert.equal((await send("periodicTilingType=Plane-vertex")).status, 501);
        assert.equal((await send("periodicTilingType=2-uniform")).status, 501);
        assert.equal((await send("periodicTilingType=Fractalizing")).status, 501);
        assert.equal((await send("periodicTilingType=non-edge-to-edge")).status, 501);
        assert.equal((await send("periodicTilingType=Regular")).status, 400);

        const selectors = [
            "periodicTilingType=Regular&cundyRollettNotation=6%5E3",
            "periodicTilingType=Regular&cundyRollettNotation=6%5E%7B3%7D",
            `periodicTilingType=Regular&cundyRollettNotation=${encodeURIComponent("6³")}`,
            `periodicTilingType=Regular&gomJauHoggNotation=${encodeURIComponent("6/m30/r(h1)")}`,
            "periodicTilingType=Regular&shape=hex",
            "periodicTilingType=Regular&shape=6",
            `periodicTilingType=Regular&cundyRollettNotation=6%5E3&gomJauHoggNotation=${encodeURIComponent("6/m30/r(h1)")}&shape=hex`
        ];
        for (const selector of selectors) {
            const response = await send(selector);
            assert.equal(response.status, 200, selector);
            const value = await response.json() as Record<string, any>;
            assert.deepEqual(value.tiling, expectedRegularHexIdentity(), selector);
        }

        assert.equal((await send("periodicTilingType=Regular&cundyRollettNotation=4%5E4")).status, 501);
        assert.equal((await send(`periodicTilingType=Regular&gomJauHoggNotation=${encodeURIComponent("4/m45/r(h1)")}`)).status, 501);
        assert.equal((await send("periodicTilingType=Regular&shape=square")).status, 501);
        assert.equal((await send("periodicTilingType=Regular&sides=6")).status, 400);
        assert.equal((await send("periodicTilingType=Regular&cundyRollettNotation=6%5E3&shape=4")).status, 400);
        assert.equal((await send("periodicTilingType=Regular&shape=hex&shape=6")).status, 400);
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
        assert.deepEqual(value.tiling, expectedRegularHexIdentity());
        assert.ok(["detected", "inconclusive", "gridless"].includes(value.status));
        assert.deepEqual(value.source, { width: 96, height: 96, mediaType: "image/png" });
        assert.equal(value.analysis.sourceResolutionVerified, true);
        assert.ok(value.fit === null || ["PointyTop", "FlatTop"].includes(value.fit.orientation));
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
