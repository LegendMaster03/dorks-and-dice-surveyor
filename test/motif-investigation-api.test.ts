import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import sharp from "sharp";
import { deriveTranslationMotif } from "../src/resources/periodic-tiling/topology/motif.js";
import type { AnalysisWorkerRequest, AnalysisWorkerResult } from "../src/analysis/periodic-tiling/worker-contract.js";
import { BoundedWorkerPool } from "../src/infrastructure/worker-pool.js";
import { WorkerJobCancelledError } from "../src/errors.js";
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

test("saturated experimental admission cannot consume the legacy v2 worker lane", async () => {
    const legacy = new BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>(
        new URL("../src/analysis/worker.js", import.meta.url), 1, 1, 10_000);
    let release!: (value: AnalysisWorkerResult) => void;
    let entered!: () => void;
    const working = new Promise<void>(resolve => { entered = resolve; });
    const isolated = {
        run: async () => new Promise<AnalysisWorkerResult>(resolve => {
            release = resolve;
            entered();
        })
    } as unknown as BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>;
    const server = createSurveyorServer({
        resources: [
            createPeriodicTilingResource({ config, pool: legacy }),
            createPeriodicMotifInvestigationResource({ config, pool: isolated })
        ], readiness: legacy
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("Expected TCP port");
    const base = `http://127.0.0.1:${addr.port}`;
    const image = await whiteImage();
    const headers = { authorization: "Bearer " + token, "content-type": "image/png" };
    try {
        const first = fetch(base + path, { method: "POST", headers, body: image });
        await working;
        const blocked = await fetch(base + path, { method: "POST", headers, body: image });
        assert.equal(blocked.status, 503);
        assert.equal((await blocked.json() as any).error.code, "overloaded");
        const old = await fetch(base + "/v2/periodic-tiling/detect", {
            method: "POST", headers, body: image
        });
        assert.equal(old.status, 200);
        assert.equal((await old.json() as any).status, "gridless");
        release({
            mode: "periodic-motif-investigation",
            observation: { status: "inconclusive", reason: "bounded test",
                checkedHypotheses: 0 }, detectorTotalMs: 0
        });
        assert.equal((await (await first).json() as any).status, "inconclusive");
    } finally {
        server.close();
        await once(server, "close");
        await legacy.close();
    }
});

test("experimental deadline includes stalled worker rather than extending to queue time", async () => {
    const legacy = new BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>(
        new URL("../src/analysis/worker.js", import.meta.url), 1, 1, 10_000);
    const short = { ...config, analysisTimeoutMs: 900 };
    const stalled = {
        run: async (_request: AnalysisWorkerRequest, options: { signal?: AbortSignal }) =>
            new Promise<AnalysisWorkerResult>((_resolve, reject) => {
                if (options.signal?.aborted) return reject(new WorkerJobCancelledError());
                options.signal?.addEventListener("abort",
                    () => reject(new WorkerJobCancelledError()), { once: true });
            })
    } as unknown as BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>;
    const server = createSurveyorServer({
        resources: [createPeriodicTilingResource({ config, pool: legacy }),
            createPeriodicMotifInvestigationResource({ config: short, pool: stalled })],
        readiness: legacy
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("Expected TCP port");
    try {
        const image = await whiteImage();
        const response = await fetch(`http://127.0.0.1:${addr.port}` + path, {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "image/png" },
            body: image
        });
        assert.equal(response.status, 504);
        assert.equal((await response.json() as any).error.code, "analysis_timeout");
    } finally {
        server.close();
        await once(server, "close");
        await legacy.close();
    }
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

/**
 * An unregistered, mixed-cell image is generated independently of the detector.
 * This exercises the full authenticated HTTP -> worker -> motif/geometry response
 * instead of only testing a blank-image inconclusive result.
 */
test("preview reconstructs a translated mixed-cell raster and exposes provisional geometry", async () => {
    const pattern = [0, 1, 2, 0];
    const polys: [number, number][][] = [];
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        const x = col * 64, y = row * 64;
        const a: [number, number] = [x, y], b: [number, number] = [x + 64, y];
        const c: [number, number] = [x + 64, y + 64], d: [number, number] = [x, y + 64];
        const mode = pattern[row * 2 + col];
        if (mode === 0) polys.push([a, b, c, d]);
        else if (mode === 1) polys.push([a, b, c], [a, c, d]);
        else polys.push([a, b, d], [b, c, d]);
    }
    const expected = deriveTranslationMotif({
        units: "pixel", basis: [{ x: 128, y: 0 }, { x: 0, y: 128 }],
        cells: polys.map((polygon, i) => ({
            id: `fixture-${i}`, polygon: polygon.map(([x, y]) => ({ x, y }))
        }))
    });
    const width = 640, height = 640, pixels = Buffer.alloc(width * height, 255);
    const draw = (a: [number, number], b: [number, number]): void => {
        const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2;
        for (let i = 0; i <= steps; i++) {
            const x = Math.round(a[0] + (b[0] - a[0]) * i / steps);
            const y = Math.round(a[1] + (b[1] - a[1]) * i / steps);
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
                const px = x + ox, py = y + oy;
                if (px >= 0 && py >= 0 && px < width && py < height)
                    pixels[py * width + px] = 0;
            }
        }
    };
    for (let u = -9; u <= 9; u++) for (let v = -9; v <= 9; v++)
        for (const polygon of polys)
            for (let i = 0; i < polygon.length; i++) {
                const a = polygon[i], b = polygon[(i + 1) % polygon.length];
                draw([29 + a[0] + 128 * u, 37 + a[1] + 128 * v],
                    [29 + b[0] + 128 * u, 37 + b[1] + 128 * v]);
            }
    const image = await sharp(pixels, {
        raw: { width, height, channels: 1 }
    }).png().toBuffer();
    await withService(async base => {
        const result = await fetch(base + path, {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "image/png" },
            body: Uint8Array.from(image).buffer
        });
        assert.equal(result.status, 200);
        const value = await result.json() as any;
        assert.equal(value.status, "consistent-candidate", value.reason);
        assert.equal(value.authoritative, false);
        assert.equal(value.candidate.dsSymbol, expected.translationSymbol);
        assert.ok(value.candidate.motifCells.length >= 2);
        assert.equal(value.evidence.metricRegistration.status, "registered",
            value.evidence.metricRegistration.reason ??
            "A complete closed-line mixed-cell fixture must have an exact shared polygon witness");
        assert.equal(value.authoritative, false,
            "Metric evidence does not promote a provisional motif to an accepted tiling");
        assert.ok(value.evidence.metricRegistration.rasterSymmetriesSupported
            <= value.evidence.metricRegistration.rasterSymmetriesChecked);
        assert.equal(value.evidence.metricRegistration.sourceProjection.status,
            "supported",
            value.evidence.metricRegistration.sourceProjection.reason ??
                "This closed-line mixed raster should support independent whole-image projection");
        assert.ok(value.evidence.metricRegistration.sourceProjection.edgeSupport >= 0.83);
        assert.ok(value.evidence.metricRegistration.sourceProjection.supportedRegions >= 7);
        assert.equal(value.authoritative, false);
        if (value.evidence.metricRegistration.status === "registered") {
            assert.ok(Number.isFinite(value.evidence.metricRegistration
                .maximumContourResidualSourcePixels));
            assert.ok(value.evidence.metricRegistration
                .maximumContourResidualSourcePixels <= 6);
        } else {
            assert.equal(value.evidence.metricRegistration
                .maximumContourResidualSourcePixels, null);
        }
        const byId = new Map<string, any>(value.candidate.motifCells.map((cell: any) => [cell.provisionalId, cell]));
        for (const cell of value.candidate.motifCells) {
            assert.ok(cell.polygonSourcePixels.length >= 3);
            assert.equal(cell.boundaries.length, cell.polygonSourcePixels.length);
            for (const boundary of cell.boundaries) {
                assert.ok(Number.isInteger(boundary.translation.u));
                assert.ok(Number.isInteger(boundary.translation.v));
                const other = byId.get(boundary.targetProvisionalId);
                assert.ok(other, "Every candidate interface targets another motif cell");
                const back = other.boundaries[boundary.targetSideIndex];
                assert.equal(back.targetProvisionalId, cell.provisionalId);
                assert.equal(back.targetSideIndex, boundary.sideIndex);
                assert.equal(back.translation.u + boundary.translation.u, 0);
                assert.equal(back.translation.v + boundary.translation.v, 0);
            }
        }
    });
});
