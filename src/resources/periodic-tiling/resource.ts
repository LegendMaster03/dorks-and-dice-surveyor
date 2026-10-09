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
import { selectPeriodicTiling, type PeriodicTilingSelection } from "./selection.js";

export type PeriodicTilingResourceDependencies = {
    config: SurveyorConfig;
    pool: BoundedWorkerPool<RegularTilingWorkerRequest, RegularTilingWorkerResult>;
};

const capabilityDescriptor = {
    id: PeriodicTilingDetectionCapability,
    path: "/v1/periodic-tiling/detect",
    notationHint: { name: "expectedDsSymbol", notation: "Delaney-Dress", required: false },
    authoritativeIdentity: "Response tiling.dsSymbol is derived from image evidence, not the hint.",
    implementedTilings: periodicTilingDefinitions.map(item => ({ dsSymbol: item.dsSymbol })),
    notationParsers: [{ notation: "Delaney-Dress", grammarDriven: true }]
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
    selection: PeriodicTilingSelection): Promise<void> {
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
        // Evaluate against the original prepared raster for every supported hypothesis.
        // The caller's optional hint only affects the evaluation order.
        const attempts: {
            definition: (typeof selection.prioritizedDetectors)[number];
            result: RegularTilingWorkerResult;
            mapped: ReturnType<typeof mapRegularDetectionToSourceImage>;
            score: number;
        }[] = [];
        for (const definition of selection.prioritizedDetectors) {
            const workerResult = await dependencies.pool.run({
                raster: prepared.raster,
                geometryId: definition.detectorGeometry,
                options: detectorOptions
            }, {
                signal: controller.signal,
                timeoutMs: dependencies.config.analysisTimeoutMs
            });
            const mapped = mapRegularDetectionToSourceImage(workerResult.detection, prepared.analysisScale);
            const fit = mapped.fit;
            const score = mapped.status === "detected" && fit != null
                ? fit.confidence * 0.5 + fit.supportCoverage * 0.3
                    + (1 - Math.min(1, fit.residualPixels / Math.max(1, fit.edgeLengthPixels))) * 0.2
                : -1;
            attempts.push({ definition, result: workerResult, mapped, score });
        }
        const candidates = attempts.filter(item => item.mapped.status === "detected" && item.mapped.fit);
        candidates.sort((a, b) => b.score - a.score);
        // Confidence scales across detector families are not fully calibrated.
        const ambiguous = candidates.length > 1 && candidates[0].score - candidates[1].score < 0.04;
        const winner = ambiguous ? null : (candidates[0] ?? null);
        const status = winner ? "detected"
            : ambiguous || attempts.some(item => item.mapped.status === "inconclusive") || candidates.length > 0
                ? "inconclusive"
                : "gridless";
        const totalMs = performance.now() - totalStarted;
        const edgeFieldMs = attempts.reduce((sum, item) => sum + item.result.edgeFieldMs, 0);
        const detectorMs = attempts.reduce(
            (sum, item) => sum + Math.max(0, item.result.detectorTotalMs - item.result.edgeFieldMs), 0);
        const result: SurveyorPeriodicTilingAnalysis = {
            apiVersion: SurveyorApiVersion,
            capability: PeriodicTilingDetectionCapability,
            tiling: winner ? { dsSymbol: winner.definition.dsSymbol } : null,
            status,
            reason: winner ? winner.mapped.reason
                : ambiguous ? "Multiple periodic tilings fit the image without a decisive winner."
                : status === "gridless" ? "No supported periodic tiling was detected."
                : "Periodic structure could not be identified confidently.",
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
            fit: winner?.mapped.fit ?? null,
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
            expectedDsSymbol: selection.expectedDsSymbol,
            detectedDsSymbol: result.tiling?.dsSymbol ?? null,
            detectorGeometry: winner?.definition.detectorGeometry ?? null,
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
            expectedDsSymbol: selection.expectedDsSymbol,
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
