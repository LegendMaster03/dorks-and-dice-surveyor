import {
    buildEdgeField,
    type GrayscaleRaster
} from "../hex-grid/detector.js";
import { discoverTranslations, type TranslationOptions, type TranslationSearch } from "./translations.js";

/**
 * Additive Phase 16 research kernel. No production API or D-symbol identity
 * is changed by this operation; all evidence comes from the original raster.
 */
export function evaluateOriginalRasterTranslations(
    raster: GrayscaleRaster,
    options: TranslationOptions & { maxEdgeSamples?: number } = {}
): TranslationSearch {
    if (!Number.isInteger(raster.width) || !Number.isInteger(raster.height)
        || raster.width < 8 || raster.height < 8
        || raster.pixels.length !== raster.width * raster.height) {
        throw new Error("Invalid grayscale raster dimensions or pixel length.");
    }
    const requested = options.maxEdgeSamples ?? 60_000;
    if (!Number.isSafeInteger(requested) || requested < 500 || requested > 100_000) {
        throw new RangeError("maxEdgeSamples must be between 500 and 100000.");
    }
    return discoverTranslations(buildEdgeField(raster, requested), options);
}
