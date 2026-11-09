import { performance } from "node:perf_hooks";
import sharp from "sharp";
import type { GrayscaleRaster } from "./raster.js";
import { SupportedRasterMediaTypes, type SupportedRasterMediaType } from "../contracts.js";
import { SurveyorRequestError, WorkerJobCancelledError } from "../errors.js";

/** Analysis pixels are bounded, but source dimensions and scale are preserved for coordinate mapping. */
export type PreparedRaster = {
    raster: GrayscaleRaster;
    sourceWidth: number;
    sourceHeight: number;
    analysisScale: number;
    mediaType: SupportedRasterMediaType;
    timings: {
        decodeMs: number;
        preparationMs: number;
        grayscaleMs: number;
    };
};

type ImageMetadata = {
    width?: number;
    height?: number;
    format?: string;
};

type RawImageResult = {
    data: Buffer;
    info: {
        width: number;
        height: number;
        channels: number;
    };
};

/**
 * Validates the declared and decoded image formats, limits resource usage,
 * and produces a grayscale analysis raster without changing the source-space
 * dimensions reported to downstream result mappers.
 */
export async function prepareRaster(
    encoded: Buffer,
    declaredMediaType: string,
    maxPixels: number,
    maximumDimension: number,
    signal?: AbortSignal): Promise<PreparedRaster> {
    const cancelled = () => {
        if (signal?.aborted) throw new WorkerJobCancelledError();
    };
    cancelled();
    const mediaType = normalizeMediaType(declaredMediaType);
    const preparationStarted = performance.now();
    let metadata: ImageMetadata;
    try {
        metadata = await sharp(encoded, {
            failOn: "error",
            limitInputPixels: maxPixels,
            sequentialRead: true
        }).metadata();
    } catch (error) {
        throw invalidImage(error);
    }
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.height ?? 0;
    if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 8 || sourceHeight < 8) {
        throw new SurveyorRequestError(422, "invalid_dimensions", "Decoded raster dimensions must be integers of at least 8×8 pixels.");
    }
    if ((sourceWidth * sourceHeight) > maxPixels) {
        throw new SurveyorRequestError(422, "pixel_limit_exceeded", `Decoded raster exceeds the configured ${maxPixels} pixel limit.`);
    }
    const decodedMediaType = mediaTypeForFormat(metadata.format);
    if (!decodedMediaType) {
        throw new SurveyorRequestError(415, "unsupported_image", "Decoded raster format is not PNG, JPEG, or WebP.");
    }
    if (decodedMediaType !== mediaType) {
        throw new SurveyorRequestError(422, "media_type_mismatch", `Declared media type ${mediaType} does not match decoded ${decodedMediaType}.`);
    }

    // Never upscale a small map. Keep one uniform scale so detector geometry
    // can be mapped back to the original pixel coordinate system.
    const analysisScale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight));
    const analysisWidth = Math.max(1, Math.round(sourceWidth * analysisScale));
    const analysisHeight = Math.max(1, Math.round(sourceHeight * analysisScale));
    const preparationMs = performance.now() - preparationStarted;

    cancelled();
    const decodeStarted = performance.now();
    let decoded: RawImageResult;
    try {
        // Remove alpha before deriving luminance, rather than treating
        // transparent RGB channels as usable boundary evidence.
        let pipeline = sharp(encoded, {
            failOn: "error",
            limitInputPixels: maxPixels,
            sequentialRead: true
        }).toColourspace("srgb").removeAlpha();
        if (analysisScale < 1) {
            pipeline = pipeline.resize(analysisWidth, analysisHeight, {
                fit: "fill",
                kernel: sharp.kernel.lanczos3
            });
        }
        const running = pipeline.raw();
        const abortDecode = () => running.destroy();
        signal?.addEventListener("abort", abortDecode, { once: true });
        try {
            cancelled();
            decoded = await running.toBuffer({ resolveWithObject: true });
        } finally {
            signal?.removeEventListener("abort", abortDecode);
        }
    } catch (error) {
        cancelled();
        throw invalidImage(error);
    }
    cancelled();
    const decodeMs = performance.now() - decodeStarted;
    if (decoded.info.width !== analysisWidth || decoded.info.height !== analysisHeight || decoded.info.channels < 3) {
        throw new SurveyorRequestError(422, "decode_shape_mismatch", "Decoded raster did not produce the expected bounded RGB analysis raster.");
    }

    // Convert sRGB to a single luminance channel for identical detector input
    // across PNG, JPEG, and WebP decoding paths.
    const grayscaleStarted = performance.now();
    const pixels = new Uint8Array(analysisWidth * analysisHeight);
    const channels = decoded.info.channels;
    for (let source = 0, target = 0; target < pixels.length; source += channels, target++) {
        pixels[target] = Math.round(
            (0.2126 * decoded.data[source]!)
            + (0.7152 * decoded.data[source + 1]!)
            + (0.0722 * decoded.data[source + 2]!));
    }
    const grayscaleMs = performance.now() - grayscaleStarted;

    return {
        raster: { width: analysisWidth, height: analysisHeight, pixels },
        sourceWidth,
        sourceHeight,
        analysisScale,
        mediaType,
        timings: { decodeMs, preparationMs, grayscaleMs }
    };
}

function normalizeMediaType(value: string): SupportedRasterMediaType {
    const mediaType = value.split(";", 1)[0]!.trim().toLowerCase();
    if (!SupportedRasterMediaTypes.includes(mediaType as SupportedRasterMediaType)) {
        throw new SurveyorRequestError(415, "unsupported_media_type", "Content-Type must be image/png, image/jpeg, or image/webp.");
    }
    return mediaType as SupportedRasterMediaType;
}

function mediaTypeForFormat(format: string | undefined): SupportedRasterMediaType | null {
    switch (format) {
        case "png": return "image/png";
        case "jpeg": return "image/jpeg";
        case "webp": return "image/webp";
        default: return null;
    }
}

function invalidImage(error: unknown): SurveyorRequestError {
    const detail = error instanceof Error ? error.message : "Image decoder rejected the raster.";
    return new SurveyorRequestError(422, "invalid_image", `Image decoder rejected the raster: ${detail.slice(0, 200)}`);
}
