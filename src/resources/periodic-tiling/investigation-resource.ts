import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import type { SurveyorConfig } from "../../config.js";
import {
    PeriodicMotifInvestigationApiVersion,
    PeriodicMotifInvestigationCapability,
    type SurveyorPeriodicMotifInvestigation
} from "../../contracts.js";
import { SurveyorRequestError, WorkerJobTimeoutError, WorkerJobCancelledError, WorkerPoolOverloadedError } from "../../errors.js";
import {
    correlationIdentifier, errorCategory, readBodyBounded,
    requireServiceToken, writeError, writeJson
} from "../../http.js";
import { prepareRaster } from "../../image/preprocess.js";
import { log } from "../../logging.js";
import type { BoundedWorkerPool } from "../../infrastructure/worker-pool.js";
import type { AnalysisWorkerRequest, AnalysisWorkerResult } from "../../analysis/periodic-tiling/worker-contract.js";
import type { SurveyorResource } from "../resource.js";
import { mapExperimentalMotifToSource } from "./source-candidate.js";

const path = "/v3/periodic-tiling/investigate";
const capability = {
    id: PeriodicMotifInvestigationCapability,
    path,
    apiVersion: PeriodicMotifInvestigationApiVersion,
    maturity: "experimental",
    authoritative: false,
    supportsExpectedSymbol: false,
    acceptedWorldTopology: false,
    outputStatus: ["consistent-candidate", "ambiguous", "inconclusive"]
} as const;

/**
 * Opt-in research-only route; does not change the v2 detection response,
 * expectedDsSymbol behavior, or authenticated image-import compatibility.
 */
export function createPeriodicMotifInvestigationResource(dependencies: {
    config: SurveyorConfig;
    pool: BoundedWorkerPool<AnalysisWorkerRequest, AnalysisWorkerResult>;
}): SurveyorResource {
    // The decoded buffer and Sharp raster are larger than the encoded upload.
    // Admit before buffering: one expensive v3 request may be in preparation,
    // execution or response serialization at any time.
    let inFlight = 0;
    return {
        id: "periodic-motif-investigation",
        capabilities: [capability],
        matches: (method, pathname) => method === "POST" && pathname === path,
        handle: async (request, response, url) => {
            const started = performance.now();
            const correlationId = correlationIdentifier(request.headers["x-correlation-id"]);
            response.setHeader("x-correlation-id", correlationId);
            const controller = new AbortController();
            let admitted = false;
            let deadlineExpired = false;
            let deadlineTimer: NodeJS.Timeout | null = null;
            const abortRequest = () => controller.abort();
            const abortDisconnectedResponse = () => {
                if (!response.writableEnded) controller.abort();
            };
            request.once("aborted", abortRequest);
            response.once("close", abortDisconnectedResponse);
            try {
                requireServiceToken(request, dependencies.config.serviceToken);
                // Generalized image observations must not be biased by caller-provided
                // tiling identity, ruleset, or unsupported detector tuning options.
                if (url.searchParams.size !== 0)
                    throw new SurveyorRequestError(400, "unsupported_investigation_options",
                        "Motif investigation does not accept expectedDsSymbol or other query parameters.");
                if (inFlight >= 1) throw new WorkerPoolOverloadedError();
                inFlight++;
                admitted = true;
                const deadline = performance.now() + dependencies.config.analysisTimeoutMs;
                deadlineTimer = setTimeout(() => {
                    deadlineExpired = true;
                    controller.abort();
                }, dependencies.config.analysisTimeoutMs);
                const ensureActive = () => {
                    if (deadlineExpired || performance.now() >= deadline)
                        throw new WorkerJobTimeoutError();
                    if (controller.signal.aborted) throw new WorkerJobCancelledError();
                };
                ensureActive();
                const contentType = request.headers["content-type"] ?? "";
                const encoded = await readBodyBounded(
                    request, dependencies.config.maxUploadBytes, controller.signal);
                ensureActive();
                const prepared = await prepareRaster(
                    encoded, contentType,
                    dependencies.config.maxPixels,
                    dependencies.config.analysisMaximumDimension,
                    controller.signal);
                ensureActive();
                const remainingMs = Math.max(1, Math.floor(deadline - performance.now()));
                const workerResult = await dependencies.pool.run({
                    mode: "periodic-motif-investigation",
                    raster: prepared.raster
                }, { signal: controller.signal, timeoutMs: remainingMs });
                ensureActive();
                if (!("mode" in workerResult) || workerResult.mode !== "periodic-motif-investigation")
                    throw new Error("Unexpected regular detection result for motif investigation.");
                const observation = workerResult.observation;
                const mapped = observation.status === "consistent-candidate"
                    ? mapExperimentalMotifToSource(observation, prepared.analysisScale)
                    : null;
                const candidate = mapped?.candidate ?? null;
                const evidence = mapped?.evidence ?? null;
                const totalMs = performance.now() - started;
                const result: SurveyorPeriodicMotifInvestigation = {
                    apiVersion: PeriodicMotifInvestigationApiVersion,
                    capability: PeriodicMotifInvestigationCapability,
                    maturity: "experimental",
                    authoritative: false,
                    status: observation.status,
                    reason: observation.status === "consistent-candidate"
                        ? "Consistent periodic motif candidate; symmetry reduction and confidence are not certified."
                        : observation.reason,
                    candidate,
                    evidence,
                    source: {
                        width: prepared.sourceWidth, height: prepared.sourceHeight,
                        mediaType: prepared.mediaType
                    },
                    analysis: {
                        width: prepared.raster.width, height: prepared.raster.height,
                        scale: prepared.analysisScale,
                        sourceResolutionVerified: Math.abs(prepared.analysisScale - 1) <= Number.EPSILON
                    },
                    timing: {
                        decodeMs: prepared.timings.decodeMs,
                        preparationMs: prepared.timings.preparationMs,
                        grayscaleMs: prepared.timings.grayscaleMs,
                        detectorMs: workerResult.detectorTotalMs,
                        totalMs
                    }
                };
                response.setHeader("server-timing", [
                    `decode;dur=${result.timing.decodeMs.toFixed(2)}`,
                    `prepare;dur=${result.timing.preparationMs.toFixed(2)}`,
                    `grayscale;dur=${result.timing.grayscaleMs.toFixed(2)}`,
                    `detector;dur=${result.timing.detectorMs.toFixed(2)}`,
                    `total;dur=${result.timing.totalMs.toFixed(2)}`
                ].join(", "));
                log("info", "surveyor.motif-investigation.completed", {
                    correlationId, capability: PeriodicMotifInvestigationCapability,
                    resultStatus: result.status, candidateDsSymbol: candidate?.dsSymbol ?? null,
                    sourceWidth: prepared.sourceWidth, sourceHeight: prepared.sourceHeight,
                    analysisScale: prepared.analysisScale, durationMs: totalMs
                });
                writeJson(response, 200, result);
            } catch (error) {
                const failure = deadlineExpired ? new WorkerJobTimeoutError() : error;
                log("error", "surveyor.motif-investigation.failed", {
                    correlationId, errorCategory: errorCategory(failure),
                    durationMs: performance.now() - started
                });
                if (!response.headersSent && !response.destroyed
                    && (!controller.signal.aborted || deadlineExpired))
                    writeError(response, failure, PeriodicMotifInvestigationCapability, PeriodicMotifInvestigationApiVersion);
            } finally {
                if (deadlineTimer !== null) clearTimeout(deadlineTimer);
                if (admitted) inFlight--;
                request.removeListener("aborted", abortRequest);
                response.removeListener("close", abortDisconnectedResponse);
            }
        }
    };
}
