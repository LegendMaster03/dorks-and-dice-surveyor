import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { SurveyorConfig } from "./config.js";
import { GridDetectionCapability, SurveyorApiVersion, type PublicHexGridDetectionOptions, type SurveyorErrorResponse, type SurveyorHexGridAnalysis } from "./contracts.js";
import { WorkerJobCancelledError, WorkerJobTimeoutError, WorkerPoolOverloadedError, SurveyorRequestError } from "./errors.js";
import { prepareRaster } from "./image/preprocess.js";
import { log } from "./logging.js";
import { mapDetectionToSourceImage } from "./analysis/hex-grid/result-mapper.js";
import type { HexGridWorkerRequest, HexGridWorkerResult } from "./analysis/hex-grid/worker-contract.js";
import type { BoundedWorkerPool } from "./infrastructure/worker-pool.js";

export type SurveyorDependencies = {
    config: SurveyorConfig;
    pool: BoundedWorkerPool<HexGridWorkerRequest, HexGridWorkerResult>;
};

type GridShapeSelection = {
    name: "hex";
    sides: 6;
};

const regularShapeNamesBySideCount = new Map<number, string>([
    [3, "triangle"],
    [4, "square"],
    [6, "hex"]
]);

const regularShapeSideCountsByName = new Map<string, number>(
    [...regularShapeNamesBySideCount.entries()].map(([sides, name]) => [name, sides]));

export function createSurveyorServer(dependencies: SurveyorDependencies): Server {
    return createHttpServer((request, response) => {
        void route(request, response, dependencies).catch(error => {
            if (!response.headersSent) writeError(response, error);
            else response.destroy();
        });
    });
}

async function route(request: IncomingMessage, response: ServerResponse, dependencies: SurveyorDependencies): Promise<void> {
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
            capabilities: [{
                id: GridDetectionCapability,
                implementedShapes: [{ name: "hex", sides: 6 }],
                selectors: ["shape", "sides"]
            }]
        });
    }
    if (request.method === "POST" && url.pathname === "/v1/grid/detect") {
        requireServiceToken(request, dependencies.config.serviceToken);
        const shape = selectGridShape(url.searchParams);
        return detectHexGrid(request, response, url, dependencies, shape);
    }
    writeJson(response, 404, { error: "not_found" });
}

function selectGridShape(parameters: URLSearchParams): GridShapeSelection {
    const rawName = parameters.get("shape")?.trim().toLowerCase() ?? "";
    const rawSides = parameters.get("sides")?.trim() ?? "";
    if (!rawName && !rawSides) {
        throw new SurveyorRequestError(
            400,
            "grid_shape_required",
            "Specify the grid shape with shape=<canonical name> or sides=<regular polygon side count>.");
    }

    let sides: number | null = null;
    if (rawSides) {
        const parsed = Number(rawSides);
        if (!Number.isInteger(parsed) || parsed < 3 || parsed > 1000) {
            throw new SurveyorRequestError(400, "invalid_grid_sides", "sides must be an integer between 3 and 1000.");
        }
        sides = parsed;
    }

    const sidesFromName = rawName ? regularShapeSideCountsByName.get(rawName) ?? null : null;
    const nameFromSides = sides == null ? null : regularShapeNamesBySideCount.get(sides) ?? null;
    if (rawName && sidesFromName != null && sides != null && sidesFromName !== sides) {
        throw new SurveyorRequestError(
            400,
            "grid_shape_selector_conflict",
            `shape=${rawName} and sides=${sides} identify different regular grid shapes.`);
    }
    if (rawName && nameFromSides != null && rawName !== nameFromSides) {
        throw new SurveyorRequestError(
            400,
            "grid_shape_selector_conflict",
            `shape=${rawName} and sides=${sides} identify different regular grid shapes.`);
    }

    const canonicalName = rawName || nameFromSides;
    const canonicalSides = sides ?? sidesFromName;
    if (canonicalName === "hex" && canonicalSides === 6) return { name: "hex", sides: 6 };
    if (canonicalName === "hex" && canonicalSides == null) return { name: "hex", sides: 6 };
    if (!canonicalName && canonicalSides === 6) return { name: "hex", sides: 6 };

    const description = canonicalName
        ? `Grid shape '${canonicalName}'${canonicalSides == null ? "" : ` (${canonicalSides} sides)`}`
        : `Regular ${canonicalSides}-sided grid shape`;
    throw new SurveyorRequestError(
        501,
        "grid_shape_not_implemented",
        `${description} is not implemented by this Surveyor deployment.`);
}

async function detectHexGrid(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    dependencies: SurveyorDependencies,
    shape: GridShapeSelection): Promise<void> {
    const totalStarted = performance.now();
    const correlationId = correlationIdentifier(request.headers["x-correlation-id"]);
    response.setHeader("x-correlation-id", correlationId);
    const contentType = request.headers["content-type"] ?? "";
    const sourceOptions = parseDetectionOptions(url.searchParams);
    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    const abortDisconnectedResponse = () => {
        if (!response.writableEnded) controller.abort();
    };
    request.once("aborted", abortRequest);
    response.once("close", abortDisconnectedResponse);

    try {
        const encoded = await readBodyBounded(request, dependencies.config.maxUploadBytes);
        const prepared = await prepareRaster(
            encoded,
            contentType,
            dependencies.config.maxPixels,
            dependencies.config.analysisMaximumDimension);
        const detectorOptions = mapOptionsToAnalysisSpace(sourceOptions, prepared.analysisScale);
        const workerResult = await dependencies.pool.run({ raster: prepared.raster, options: detectorOptions }, {
            signal: controller.signal,
            timeoutMs: dependencies.config.analysisTimeoutMs
        });
        const mapped = mapDetectionToSourceImage(workerResult.detection, prepared.analysisScale);
        const totalMs = performance.now() - totalStarted;
        const edgeFieldMs = workerResult.edgeFieldMs;
        const detectorMs = Math.max(0, workerResult.detectorTotalMs - edgeFieldMs);
        const result: SurveyorHexGridAnalysis = {
            apiVersion: SurveyorApiVersion,
            capability: GridDetectionCapability,
            gridKind: "hex",
            status: mapped.status,
            reason: mapped.reason,
            source: {
                width: prepared.sourceWidth,
                height: prepared.sourceHeight,
                mediaType: prepared.mediaType
            },
            analysis: {
                width: prepared.raster.width,
                height: prepared.raster.height,
                scale: prepared.analysisScale,
                sourceResolutionVerified: Math.abs(prepared.analysisScale - 1) <= Number.EPSILON
            },
            fit: mapped.fit,
            timing: {
                decodeMs: prepared.timings.decodeMs,
                preparationMs: prepared.timings.preparationMs,
                grayscaleMs: prepared.timings.grayscaleMs,
                edgeFieldMs,
                detectorMs,
                totalMs
            }
        };
        response.setHeader("server-timing", serverTiming(result));
        log("info", "surveyor.analysis.completed", {
            correlationId,
            capability: GridDetectionCapability,
            gridShape: shape.name,
            gridSides: shape.sides,
            mediaType: prepared.mediaType,
            sourceWidth: prepared.sourceWidth,
            sourceHeight: prepared.sourceHeight,
            analysisWidth: prepared.raster.width,
            analysisHeight: prepared.raster.height,
            analysisScale: prepared.analysisScale,
            resultStatus: result.status,
            confidence: result.fit?.confidence ?? null,
            durationMs: totalMs
        });
        writeJson(response, 200, result);
    } catch (error) {
        log("error", "surveyor.analysis.failed", {
            correlationId,
            capability: GridDetectionCapability,
            gridShape: shape.name,
            gridSides: shape.sides,
            errorCategory: errorCategory(error),
            durationMs: performance.now() - totalStarted
        });
        if (!response.headersSent && !controller.signal.aborted) writeError(response, error);
    } finally {
        request.removeListener("aborted", abortRequest);
        response.removeListener("close", abortDisconnectedResponse);
    }
}

function parseDetectionOptions(parameters: URLSearchParams): PublicHexGridDetectionOptions {
    const minimumSpacingPixels = optionalFinite(parameters, "minimumSpacingPixels", 8, 100_000);
    const maximumSpacingPixels = optionalFinite(parameters, "maximumSpacingPixels", 8, 100_000);
    const maximumEdgeSamples = optionalFinite(parameters, "maximumEdgeSamples", 500, 250_000, true);
    const minimumConfidence = optionalFinite(parameters, "minimumConfidence", 0, 1);
    if (minimumSpacingPixels != null && maximumSpacingPixels != null && maximumSpacingPixels <= minimumSpacingPixels) {
        throw new SurveyorRequestError(400, "invalid_options", "maximumSpacingPixels must be greater than minimumSpacingPixels.");
    }
    return {
        ...(minimumSpacingPixels == null ? {} : { minimumSpacingPixels }),
        ...(maximumSpacingPixels == null ? {} : { maximumSpacingPixels }),
        ...(maximumEdgeSamples == null ? {} : { maximumEdgeSamples }),
        ...(minimumConfidence == null ? {} : { minimumConfidence })
    };
}

function mapOptionsToAnalysisSpace(
    sourceOptions: PublicHexGridDetectionOptions,
    analysisScale: number): PublicHexGridDetectionOptions {
    const minimumSpacingPixels = sourceOptions.minimumSpacingPixels == null
        ? undefined
        : Math.max(8, Math.floor(sourceOptions.minimumSpacingPixels * analysisScale));
    let maximumSpacingPixels = sourceOptions.maximumSpacingPixels == null
        ? undefined
        : Math.max(8.25, sourceOptions.maximumSpacingPixels * analysisScale);
    if (maximumSpacingPixels != null && minimumSpacingPixels != null && maximumSpacingPixels <= minimumSpacingPixels) {
        maximumSpacingPixels = minimumSpacingPixels + 0.25;
    }
    return {
        ...(minimumSpacingPixels == null ? {} : { minimumSpacingPixels }),
        ...(maximumSpacingPixels == null ? {} : { maximumSpacingPixels }),
        ...(sourceOptions.maximumEdgeSamples == null ? {} : { maximumEdgeSamples: sourceOptions.maximumEdgeSamples }),
        ...(sourceOptions.minimumConfidence == null ? {} : { minimumConfidence: sourceOptions.minimumConfidence })
    };
}

function optionalFinite(parameters: URLSearchParams, name: string, minimum: number, maximum: number, integer = false): number | undefined {
    const raw = parameters.get(name);
    if (raw == null || raw.trim() === "") return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
        throw new SurveyorRequestError(400, "invalid_options", `${name} must be ${integer ? "an integer" : "a finite number"} between ${minimum} and ${maximum}.`);
    }
    return value;
}

async function readBodyBounded(request: IncomingMessage, limit: number): Promise<Buffer> {
    const declared = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > limit) {
        throw new SurveyorRequestError(413, "upload_too_large", `Encoded raster exceeds the configured ${limit} byte limit.`);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > limit) {
            throw new SurveyorRequestError(413, "upload_too_large", `Encoded raster exceeds the configured ${limit} byte limit.`);
        }
        chunks.push(buffer);
    }
    if (total === 0) throw new SurveyorRequestError(400, "empty_image", "A non-empty encoded raster body is required.");
    return Buffer.concat(chunks, total);
}

function requireServiceToken(request: IncomingMessage, expected: string): void {
    const header = request.headers.authorization ?? "";
    const prefix = "Bearer ";
    if (!header.startsWith(prefix) || !secureEqual(header.slice(prefix.length), expected)) {
        throw new SurveyorRequestError(401, "unauthorized", "A valid Surveyor service bearer token is required.");
    }
}

function secureEqual(candidate: string, expected: string): boolean {
    const left = createHash("sha256").update(candidate).digest();
    const right = createHash("sha256").update(expected).digest();
    return timingSafeEqual(left, right);
}

function correlationIdentifier(value: string | string[] | undefined): string {
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

function serverTiming(result: SurveyorHexGridAnalysis): string {
    const timing = result.timing;
    return [
        `decode;dur=${timing.decodeMs.toFixed(2)}`,
        `prepare;dur=${timing.preparationMs.toFixed(2)}`,
        `grayscale;dur=${timing.grayscaleMs.toFixed(2)}`,
        `edge-field;dur=${timing.edgeFieldMs.toFixed(2)}`,
        `detector;dur=${timing.detectorMs.toFixed(2)}`,
        `total;dur=${timing.totalMs.toFixed(2)}`
    ].join(", ");
}

function writeError(response: ServerResponse, error: unknown): void {
    let status = 500;
    let code = "internal_failure";
    let message = "Surveyor failed to analyze the raster.";
    if (error instanceof SurveyorRequestError) {
        status = error.statusCode;
        code = error.code;
        message = error.message;
    } else if (error instanceof WorkerPoolOverloadedError) {
        status = 503;
        code = "overloaded";
        message = error.message;
        response.setHeader("retry-after", "1");
    } else if (error instanceof WorkerJobTimeoutError) {
        status = 504;
        code = "analysis_timeout";
        message = error.message;
    } else if (error instanceof WorkerJobCancelledError) {
        status = 408;
        code = "cancelled";
        message = error.message;
    }
    if (status === 401) response.setHeader("www-authenticate", "Bearer");
    const body: SurveyorErrorResponse = {
        apiVersion: SurveyorApiVersion,
        capability: GridDetectionCapability,
        error: { code, message }
    };
    writeJson(response, status, body);
}

function errorCategory(error: unknown): string {
    if (error instanceof SurveyorRequestError) return error.code;
    if (error instanceof WorkerPoolOverloadedError) return "overloaded";
    if (error instanceof WorkerJobTimeoutError) return "timeout";
    if (error instanceof WorkerJobCancelledError) return "cancelled";
    return "internal_failure";
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body)
    });
    response.end(body);
}
