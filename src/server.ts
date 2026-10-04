import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { SurveyorConfig } from "./config.js";
import {
    PeriodicTilingDetectionCapability,
    SurveyorApiVersion,
    type PublicHexGridDetectionOptions,
    type SurveyorErrorResponse,
    type SurveyorHexGridAnalysis
} from "./contracts.js";
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

type RegularTilingSelection = {
    periodicTilingType: "Regular";
    cundyRollettNotation: "6^3";
    gomJauHoggNotation: "6/m30/r(h1)";
    shapes: [{
        name: "hex";
        sides: 6;
    }];
};

type KnownRegularTiling = {
    name: string;
    sides: number;
    cundyRollettNotation: string;
    gomJauHoggNotation: string;
    implemented: boolean;
};

const knownRegularTilings: KnownRegularTiling[] = [
    {
        name: "triangle",
        sides: 3,
        cundyRollettNotation: "3^6",
        gomJauHoggNotation: "3/m30/r(h2)",
        implemented: false
    },
    {
        name: "square",
        sides: 4,
        cundyRollettNotation: "4^4",
        gomJauHoggNotation: "4/m45/r(h1)",
        implemented: false
    },
    {
        name: "hex",
        sides: 6,
        cundyRollettNotation: "6^3",
        gomJauHoggNotation: "6/m30/r(h1)",
        implemented: true
    }
];

const regularTilingByName = new Map(knownRegularTilings.map(tiling => [tiling.name, tiling]));
const defaultRegularTilingBySideCount = new Map(knownRegularTilings.map(tiling => [tiling.sides, tiling]));
const regularTilingByCundyRollett = new Map(
    knownRegularTilings.map(tiling => [normalizeCundyRollettNotation(tiling.cundyRollettNotation), tiling]));
const regularTilingByGomJauHogg = new Map(
    knownRegularTilings.map(tiling => [normalizeGomJauHoggNotation(tiling.gomJauHoggNotation), tiling]));

const canonicalPeriodicTilingTypes = new Map<string, string>([
    ["regular", "Regular"],
    ["semiregular", "semiregular"],
    ["k-uniform", "k-uniform"],
    ["plane-vertex", "Plane-vertex"],
    ["2-uniform", "2-uniform"],
    ["fractalizing", "Fractalizing"],
    ["non-edge-to-edge", "non-edge-to-edge"]
]);

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
                id: PeriodicTilingDetectionCapability,
                path: "/v1/periodic-tiling/detect",
                periodicTilingTypes: [
                    {
                        name: "Regular",
                        implemented: true,
                        arguments: [
                            {
                                name: "cundyRollettNotation",
                                kind: "notation",
                                notation: "Cundy-Rollett",
                                required: false,
                                preferred: true
                            },
                            {
                                name: "gomJauHoggNotation",
                                kind: "notation",
                                notation: "GomJau-Hogg",
                                required: false,
                                preferred: false
                            },
                            {
                                name: "shape",
                                kind: "shape",
                                ordered: true,
                                minimumCount: 1,
                                maximumCount: 1,
                                formats: ["canonical-name", "side-count"],
                                convenience: true
                            }
                        ],
                        selectorRule: "At least one selector is required. Multiple selectors are accepted only when they resolve to the same tiling.",
                        implementedTilings: [{
                            cundyRollettNotation: "6^3",
                            gomJauHoggNotation: "6/m30/r(h1)",
                            shapes: [{ name: "hex", sides: 6 }]
                        }]
                    },
                    {
                        name: "semiregular",
                        implemented: false,
                        arguments: [{
                            name: "semiregularType",
                            kind: "enum",
                            required: true,
                            values: ["Archimedean", "uniform"]
                        }]
                    },
                    { name: "k-uniform", implemented: false, arguments: null },
                    { name: "Plane-vertex", implemented: false, arguments: null },
                    { name: "2-uniform", implemented: false, arguments: null },
                    { name: "Fractalizing", implemented: false, arguments: null },
                    { name: "non-edge-to-edge", implemented: false, arguments: null }
                ]
            }]
        });
    }
    if (request.method === "POST" && url.pathname === "/v1/periodic-tiling/detect") {
        requireServiceToken(request, dependencies.config.serviceToken);
        const tiling = selectPeriodicTiling(url.searchParams);
        return detectRegularHexTiling(request, response, url, dependencies, tiling);
    }
    writeJson(response, 404, { error: "not_found" });
}

function selectPeriodicTiling(parameters: URLSearchParams): RegularTilingSelection {
    const rawType = parameters.get("periodicTilingType")?.trim() ?? "";
    if (!rawType) {
        throw new SurveyorRequestError(
            400,
            "periodic_tiling_type_required",
            "periodicTilingType is required for periodic-tiling detection.");
    }
    const canonicalType = canonicalPeriodicTilingTypes.get(rawType.toLowerCase()) ?? rawType;
    if (canonicalType !== "Regular") {
        throw new SurveyorRequestError(
            501,
            "periodic_tiling_type_not_implemented",
            `Periodic tiling type '${canonicalType}' is recognized but not implemented by this Surveyor deployment.`);
    }
    return selectRegularTiling(parameters);
}

function selectRegularTiling(parameters: URLSearchParams): RegularTilingSelection {
    if (parameters.has("sides")) {
        throw new SurveyorRequestError(
            400,
            "regular_selector_invalid",
            "Use cundyRollettNotation, gomJauHoggNotation, or shape for Regular periodic tilings. Side count shorthand is supplied through shape, for example shape=6.");
    }

    const selections: KnownRegularTiling[] = [];
    const cundyRollettValues = parameters.getAll("cundyRollettNotation");
    const gomJauHoggValues = parameters.getAll("gomJauHoggNotation");
    const shapeValues = parameters.getAll("shape");

    if (cundyRollettValues.length > 1 || gomJauHoggValues.length > 1 || shapeValues.length > 1) {
        throw new SurveyorRequestError(
            400,
            "regular_selector_count",
            "Regular periodic-tiling selectors may each be supplied at most once.");
    }

    if (cundyRollettValues.length === 1) selections.push(resolveRegularCundyRollett(cundyRollettValues[0]));
    if (gomJauHoggValues.length === 1) selections.push(resolveRegularGomJauHogg(gomJauHoggValues[0]));
    if (shapeValues.length === 1) selections.push(resolveRegularShape(shapeValues[0]));

    if (selections.length === 0) {
        throw new SurveyorRequestError(
            400,
            "regular_selector_required",
            "Regular periodic tilings require a selector. The preferred selector is cundyRollettNotation; gomJauHoggNotation and shape are also accepted.");
    }

    const selected = selections[0];
    if (selections.some(candidate => candidate.name !== selected.name)) {
        throw new SurveyorRequestError(
            400,
            "regular_selector_conflict",
            "The supplied Regular periodic-tiling selectors resolve to different tilings.");
    }
    if (!selected.implemented) {
        throw new SurveyorRequestError(
            501,
            "regular_tiling_not_implemented",
            `Regular tiling '${selected.cundyRollettNotation}' (${selected.name}) is recognized but not implemented by this Surveyor deployment.`);
    }
    if (selected.name !== "hex" || selected.sides !== 6) {
        throw new SurveyorRequestError(500, "regular_tiling_dispatch_failure", "The implemented Regular tiling could not be dispatched.");
    }

    return {
        periodicTilingType: "Regular",
        cundyRollettNotation: "6^3",
        gomJauHoggNotation: "6/m30/r(h1)",
        shapes: [{ name: "hex", sides: 6 }]
    };
}

function resolveRegularCundyRollett(raw: string): KnownRegularTiling {
    const normalized = normalizeCundyRollettNotation(raw);
    if (!normalized) {
        throw new SurveyorRequestError(400, "invalid_cundy_rollett_notation", "cundyRollettNotation can not be empty.");
    }
    const tiling = regularTilingByCundyRollett.get(normalized);
    if (!tiling) {
        throw new SurveyorRequestError(
            501,
            "regular_tiling_not_implemented",
            `Regular Cundy-Rollett notation '${raw.trim()}' is not implemented by this Surveyor deployment.`);
    }
    return tiling;
}

function resolveRegularGomJauHogg(raw: string): KnownRegularTiling {
    const normalized = normalizeGomJauHoggNotation(raw);
    if (!normalized) {
        throw new SurveyorRequestError(400, "invalid_gomjau_hogg_notation", "gomJauHoggNotation can not be empty.");
    }
    const tiling = regularTilingByGomJauHogg.get(normalized);
    if (!tiling) {
        throw new SurveyorRequestError(
            501,
            "regular_tiling_not_implemented",
            `Regular GomJau-Hogg notation '${raw.trim()}' is not implemented by this Surveyor deployment.`);
    }
    return tiling;
}

function resolveRegularShape(rawArgument: string): KnownRegularTiling {
    const argument = rawArgument.trim();
    if (!argument) {
        throw new SurveyorRequestError(400, "regular_shape_argument_invalid", "Regular tiling shape arguments can not be empty.");
    }

    if (/^[0-9]+$/.test(argument)) {
        const sides = Number(argument);
        if (!Number.isInteger(sides) || sides < 3 || sides > 1000) {
            throw new SurveyorRequestError(400, "invalid_regular_shape_sides", "A numeric Regular shape argument must be an integer between 3 and 1000.");
        }
        const tiling = defaultRegularTilingBySideCount.get(sides);
        if (!tiling) {
            throw new SurveyorRequestError(
                501,
                "regular_tiling_not_implemented",
                `No default Regular periodic tiling is configured for ${sides}-sided polygons.`);
        }
        return tiling;
    }

    const tiling = regularTilingByName.get(argument.toLowerCase());
    if (!tiling) {
        throw new SurveyorRequestError(
            501,
            "regular_tiling_not_implemented",
            `Regular tiling shape '${argument.toLowerCase()}' is not implemented by this Surveyor deployment.`);
    }
    return tiling;
}

function normalizeCundyRollettNotation(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, "")
        .replace(/\^\{([0-9]+)\}/g, "^$1")
        .replace(/²/g, "^2")
        .replace(/³/g, "^3")
        .replace(/⁴/g, "^4")
        .replace(/⁵/g, "^5")
        .replace(/⁶/g, "^6")
        .replace(/⁷/g, "^7")
        .replace(/⁸/g, "^8")
        .replace(/⁹/g, "^9");
}

function normalizeGomJauHoggNotation(value: string): string {
    return value.trim().replace(/\s+/g, "").toLowerCase();
}

async function detectRegularHexTiling(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    dependencies: SurveyorDependencies,
    tiling: RegularTilingSelection): Promise<void> {
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
            capability: PeriodicTilingDetectionCapability,
            tiling: {
                periodicTilingType: tiling.periodicTilingType,
                cundyRollettNotation: tiling.cundyRollettNotation,
                gomJauHoggNotation: tiling.gomJauHoggNotation,
                shapes: tiling.shapes
            },
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
            capability: PeriodicTilingDetectionCapability,
            periodicTilingType: tiling.periodicTilingType,
            cundyRollettNotation: tiling.cundyRollettNotation,
            gomJauHoggNotation: tiling.gomJauHoggNotation,
            gridShapes: tiling.shapes.map(shape => shape.name),
            gridSides: tiling.shapes.map(shape => shape.sides),
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
            capability: PeriodicTilingDetectionCapability,
            periodicTilingType: tiling.periodicTilingType,
            cundyRollettNotation: tiling.cundyRollettNotation,
            gomJauHoggNotation: tiling.gomJauHoggNotation,
            gridShapes: tiling.shapes.map(shape => shape.name),
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
        capability: PeriodicTilingDetectionCapability,
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
