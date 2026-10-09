import {
    buildEdgeField,
    type GrayscaleRaster
} from "../hex-grid/detector.js";
import { discoverTranslations, type TranslationOptions, type TranslationSearch } from "./translations.js";

/**
 * Additive Phase 16 research kernel, reusing the current detector's Sobel edge
 * samples, Hough orientation evidence and multiregion rigid-shift checks.
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
    if (strongSamples.length >= 500 && strongSamples.length !== field.samples.length) {
        const strong = discoverTranslations({ ...field, samples: strongSamples }, options);
        if (strong.status === "candidates")
            return { ...strong, reason: "Strong-gradient original-image candidate; requires independent whole-motif verification" };
    }

    // On a nearly white map, low-amplitude pixel noise can dominate the 90th
    // percentile Sobel normalizer and saturate most weak edge strengths. A
    // *conditional* ink-evidence view removes those diffuse background
    // samples without rerasterizing, warping, or replacing the existing Sobel
    // field. The geometric and metric validators still check the unchanged
    // source image. Do not apply this assumption to low-contrast artwork.
    const { width, height, pixels } = raster;
    let darkPixels = 0, lightPixels = 0;
    for (const pixel of pixels) {
        if (pixel < 100) darkPixels++;
        if (pixel > 220) lightPixels++;
    }
    const density = darkPixels / pixels.length;
    if (density < 0.005 || density > 0.30 || lightPixels / pixels.length < 0.60)
        return original;
    const nearInk = field.samples.filter(sample => {
        let dark = false, light = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = sample.x + dx, y = sample.y + dy;
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            const pixel = pixels[y * width + x];
            if (pixel < 100) dark = true;
            if (pixel > 180) light = true;
        }
        return dark && light;
    });
    if (nearInk.length < 500 || nearInk.length === field.samples.length)
        return original;
    const ink = discoverTranslations({ ...field, samples: nearInk },
        {
            ...options,
            pixelTolerance: "nearby",
            // Proposal rank only. The common multi-region and whole-motif
            // geometry verifiers still decide whether a candidate survives.
            minRegionSupport: Math.min(options.minRegionSupport ?? 0.65, 0.55)
        });
    return ink.status === "candidates"
        ? { ...ink, reason: "Original-Sobel high-contrast ink-edge candidate; requires independent whole-motif verification" }
        : original;
}
