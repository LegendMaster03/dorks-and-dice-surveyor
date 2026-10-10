import {
    buildEdgeField,
    type GrayscaleRaster
} from "../hex-grid/detector.js";
import { discoverTranslations, type TranslationOptions, type TranslationSearch } from "./translations.js";

/**
 * Additive Phase 16 research kernel, reusing the current detector's Sobel edge samples and normals.
 * The generalized translation votes and multiregion rigid checks are new
 * kernels, not calls to the hex-specific Hough/autocorrelation fitter.
 * No production API or D-symbol identity is changed here. If noise obscures the
 * ordinary edge field, retry with only the strongest original gradients. This
 * neither transforms the input image nor corrects individual cell positions;
 * motif reconstruction and final metric evidence still use the original raster.
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
    const field = buildEdgeField(raster, requested);
    const original = discoverTranslations(field, options);
    if (original.status === "candidates") return original;

    // Gradient magnitudes are already normalized by the original Sobel field.
    // Retry a single stronger-evidence hypothesis when diffuse texture produces
    // many weak, unrelated edge samples. This does not invent a shape or change
    // the final unchanged-raster verification gate.
    const strongSamples = field.samples.filter(sample =>
        field.strength[sample.y * field.width + sample.x] >= 0.9);
    if (strongSamples.length < 500 || strongSamples.length === field.samples.length)
        return original;
    const strong = discoverTranslations({ ...field, samples: strongSamples }, options);
    return strong.status === "candidates"
        ? { ...strong, reason: "Strong-gradient original-image candidate; requires independent whole-motif verification" }
        : original;
}
