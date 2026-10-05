import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { SurveyorConfig } from "../../config.js";
import {
    PeriodicTilingDetectionCapability,
    SurveyorApiVersion,
    type PublicPeriodicTilingDetectionOptions,
    type SurveyorPeriodicTilingAnalysis
} from "../../contracts.js";
import { SurveyorRequestError } from "../../errors.js";
import {
    correlationIdentifier,
    errorCategory,
    readBodyBounded,
    requireServiceToken,
    writeError,
    writeJson
} from "../../http.js";
import { prepareRaster } from "../../image/preprocess.js";
import type { BoundedWorkerPool } from "../../infrastructure/worker-pool.js";
import { log } from "../../logging.js";
import { mapRegularDetectionToSourceImage } from "../../analysis/regular-tiling/result-mapper.js";
import type {
    RegularTilingWorkerRequest,
    RegularTilingWorkerResult
} from "../../analysis/regular-tiling/worker-contract.js";
import type { SurveyorResource } from "../resource.js";
import { periodicTilingDefinitions } from "./catalog.js";
import { selectPeriodicTiling, type ImplementedPeriodicTilingDefinition } from "./selection.js";

export type PeriodicTilingResourceDependencies = {
    config: SurveyorConfig;
    pool: BoundedWorkerPool<RegularTilingWorkerRequest, RegularTilingWorkerResult>;
};

const capabilityDescriptor = {
    id: PeriodicTilingDetectionCapability,
    path: "/v1/periodic-tiling/detect",
    notationSelectors: [
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
    ],
    selectorRule: "At least one notation is required. Both may be supplied only when they resolve to the same tiling.",
    derivedIdentity: ["periodicTilingType", "crNotation", "gjhNotation"],
    implementedTilings: periodicTilingDefinitions
        .filter(tiling => tiling.detectorId != null)
        .map(tiling => ({
            periodicTilingType: tiling.periodicTilingType,
            crNotation: tiling.crNotation,
            gjhNotation: tiling.gjhNotation
        })),
    recognizedTilings: periodicTilingDefinitions.map(tiling => ({
        periodicTilingType: tiling.periodicTilingType,
        crNotation: tiling.crNotation,
        gjhNotation: tiling.gjhNotation,
        implemented: tiling.detectorId != null
    })),
    notationParsers: [
        { notation: "Cundy-Rollett", grammarDriven: true },
        { notation: "GomJau-Hogg", grammarDriven: true }
    ],
    recognizedTilingFamilies: [
        { name: "Regular", implemented: true },
        { name: "semiregular", implemented: false, subtypes: ["Archimedean", "uniform"] },
        { name: "k-uniform", implemented: false },
        { name: "Plane-vertex", implemented: false },
        { name: "2-uniform", implemented: false },
        { name: "Fractalizing", implemented: false },
        { name: "non-edge-to-edge", implemented: false }
    ]
} as const;

export function createPeriodicTilingResource(dependencies: PeriodicTilingResourceDependencies): SurveyorResource {
    return {
        id: "periodic-tiling",
        capabilities: [capabilityDescriptor],
        matches: (method, pathname) => method === "POST" && pathname === capabilityDescriptor.path,
        handle: async (request, response, url) => {
            try {
                requireServiceToken(request, dependencies.config.serviceToken);
                const tiling = selectPeriodicTiling(url.searchParams);
                await detectPeriodicTiling(request, response, url, dependencies, tiling);
            } catch (error) {
                if (!response.headersSent) writeError(response, error, PeriodicTilingDetectionCapability);
                else response.destroy();
            }
        }
    };
}

async function detectPeriodicTiling(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    dependencies: PeriodicTilingResourceDependencies,
    tiling: ImplementedPeriodicTilingDefinition): Promise<void> {
    if (tiling.detectorId !== "regular-lattice") {
        throw new SurveyorRequestError(500, "tiling_dispatch_failure", "The implemented periodic tiling could not be dispatched.");
    }

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
        const workerResult = await dependencies.pool.run({
            raster: prepared.raster,
            geometryId: tiling.detectorGeometry,
            options: detectorOptions
        }, {
            signal: controller.signal,
            timeoutMs: dependencies.config.analysisTimeoutMs
        });
        const mapped = mapRegularDetectionToSourceImage(workerResult.detection, prepared.analysisScale);
        const totalMs = performance.now() - totalStarted;
        const edgeFieldMs = workerResult.edgeFieldMs;
        const detectorMs = Math.max(0, workerResult.detectorTotalMs - edgeFieldMs);
        const result: SurveyorPeriodicTilingAnalysis = {
            apiVersion: SurveyorApiVersion,
            capability: PeriodicTilingDetectionCapability,
            tiling: {
                periodicTilingType: tiling.periodicTilingType,
                crNotation: tiling.crNotation,
                gjhNotation: tiling.gjhNotation
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
            crNotation: tiling.crNotation,
            gjhNotation: tiling.gjhNotation,
            detectorId: tiling.detectorId,
            detectorGeometry: tiling.detectorGeometry,
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
            crNotation: tiling.crNotation,
            gjhNotation: tiling.gjhNotation,
            detectorId: tiling.detectorId,
            detectorGeometry: tiling.detectorGeometry,
            errorCategory: errorCategory(error),
            durationMs: performance.now() - totalStarted
        });
        if (!response.headersSent && !controller.signal.aborted) {
            writeError(response, error, PeriodicTilingDetectionCapability);
        }
    } finally {
        request.removeListener("aborted", abortRequest);
        response.removeListener("close", abortDisconnectedResponse);
    }
}

function parseDetectionOptions(parameters: URLSearchParams): PublicPeriodicTilingDetectionOptions {
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
    sourceOptions: PublicPeriodicTilingDetectionOptions,
    analysisScale: number): PublicPeriodicTilingDetectionOptions {
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

function optionalFinite(
    parameters: URLSearchParams,
    name: string,
    minimum: number,
    maximum: number,
    integer = false): number | undefined {
    const raw = parameters.get(name);
    if (raw == null || raw.trim() === "") return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
        throw new SurveyorRequestError(
            400,
            "invalid_options",
            `${name} must be ${integer ? "an integer" : "a finite number"} between ${minimum} and ${maximum}.`);
    }
    return value;
}

function serverTiming(result: SurveyorPeriodicTilingAnalysis): string {
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
