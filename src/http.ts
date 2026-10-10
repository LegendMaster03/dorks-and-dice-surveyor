import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SurveyorApiVersion, type SurveyorErrorResponse } from "./contracts.js";
import {
    SurveyorRequestError,
    WorkerJobCancelledError,
    WorkerJobTimeoutError,
    WorkerPoolOverloadedError
} from "./errors.js";

export async function readBodyBounded(
    request: IncomingMessage, limit: number, signal?: AbortSignal
): Promise<Buffer> {
    if (signal?.aborted) throw new WorkerJobCancelledError();
    // A timed-out/disconnected experimental request must not retain a
    // buffered upload slot while awaiting the next body chunk. Leave the
    // legacy v2 call path untouched when no signal was supplied.
    const abort = () => request.destroy();
    signal?.addEventListener("abort", abort, { once: true });
    try {
    const declared = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > limit) {
        throw new SurveyorRequestError(413, "upload_too_large", `Encoded raster exceeds the configured ${limit} byte limit.`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
        if (signal?.aborted) throw new WorkerJobCancelledError();
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > limit) {
            throw new SurveyorRequestError(413, "upload_too_large", `Encoded raster exceeds the configured ${limit} byte limit.`);
        }
        chunks.push(buffer);
    }

    if (total === 0) {
        throw new SurveyorRequestError(400, "empty_image", "A non-empty encoded raster body is required.");
    }
    if (signal?.aborted) throw new WorkerJobCancelledError();
    return Buffer.concat(chunks, total);
    } catch (error) {
        if (signal?.aborted) throw new WorkerJobCancelledError();
        throw error;
    } finally {
        signal?.removeEventListener("abort", abort);
    }
}

export function requireServiceToken(request: IncomingMessage, expected: string): void {
    const header = request.headers.authorization ?? "";
    const prefix = "Bearer ";
    if (!header.startsWith(prefix) || !secureEqual(header.slice(prefix.length), expected)) {
        throw new SurveyorRequestError(401, "unauthorized", "A valid Surveyor service bearer token is required.");
    }
}

export function correlationIdentifier(value: string | string[] | undefined): string {
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

export function writeError(
    response: ServerResponse, error: unknown, capability: string,
    apiVersion: SurveyorErrorResponse["apiVersion"] = SurveyorApiVersion
): void {
    let status = 500;
    let code = "internal_failure";
    let message = "Surveyor failed to process the request.";

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
        apiVersion,
        capability,
        error: { code, message }
    };
    writeJson(response, status, body);
}

export function errorCategory(error: unknown): string {
    if (error instanceof SurveyorRequestError) return error.code;
    if (error instanceof WorkerPoolOverloadedError) return "overloaded";
    if (error instanceof WorkerJobTimeoutError) return "timeout";
    if (error instanceof WorkerJobCancelledError) return "cancelled";
    return "internal_failure";
}

export function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body)
    });
    response.end(body);
}

function secureEqual(candidate: string, expected: string): boolean {
    const left = createHash("sha256").update(candidate).digest();
    const right = createHash("sha256").update(expected).digest();
    return timingSafeEqual(left, right);
}
