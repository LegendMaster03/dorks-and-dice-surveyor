import { availableParallelism } from "node:os";

export type SurveyorConfig = {
    port: number;
    serviceToken: string;
    maxUploadBytes: number;
    maxPixels: number;
    workerCount: number;
    queueLimit: number;
    analysisTimeoutMs: number;
    analysisMaximumDimension: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): SurveyorConfig {
    const defaultWorkers = Math.min(8, Math.max(1, availableParallelism() - 1));
    const workerCount = positiveInteger(environment.SURVEYOR_WORKER_COUNT ?? String(defaultWorkers), "SURVEYOR_WORKER_COUNT", 64);
    const serviceToken = environment.SURVEYOR_SERVICE_TOKEN?.trim() ?? "";
    if (serviceToken.length < 16) {
        throw new Error("SURVEYOR_SERVICE_TOKEN must contain at least 16 non-whitespace characters.");
    }
    return {
        port: positiveInteger(environment.PORT ?? "8080", "PORT", 65535),
        serviceToken,
        maxUploadBytes: positiveInteger(environment.SURVEYOR_MAX_UPLOAD_BYTES ?? String(32 * 1024 * 1024), "SURVEYOR_MAX_UPLOAD_BYTES", 512 * 1024 * 1024),
        maxPixels: positiveInteger(environment.SURVEYOR_MAX_PIXELS ?? "100000000", "SURVEYOR_MAX_PIXELS", 500_000_000),
        workerCount,
        queueLimit: nonNegativeInteger(environment.SURVEYOR_QUEUE_LIMIT ?? String(workerCount * 2), "SURVEYOR_QUEUE_LIMIT", 1024),
        analysisTimeoutMs: positiveInteger(environment.SURVEYOR_ANALYSIS_TIMEOUT ?? "30000", "SURVEYOR_ANALYSIS_TIMEOUT", 300_000),
        analysisMaximumDimension: positiveInteger(environment.SURVEYOR_ANALYSIS_MAX_DIMENSION ?? "2048", "SURVEYOR_ANALYSIS_MAX_DIMENSION", 8192)
    };
}

function positiveInteger(value: string, name: string, maximum: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
    }
    return parsed;
}

function nonNegativeInteger(value: string, name: string, maximum: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
        throw new Error(`${name} must be an integer between 0 and ${maximum}.`);
    }
    return parsed;
}
