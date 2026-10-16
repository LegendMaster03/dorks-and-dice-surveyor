import type { GrayscaleRaster } from "../hex-grid/detector.js";

/** Evidence classification determined entirely from unchanged source pixels.
 *
 * Legacy black-ink-on-white rasters keep their historical thresholds. Gray
 * strokes on cream, colored, or off-white cells can instead use a single
 * conservative histogram split. That split is recalculated independently on
 * the original image in contour, rigid-fit and held-out projection stages.
 * No candidate topology, tiling type, preset, or user-provided cell count
 * can determine these thresholds.
 */
export type OriginalRasterContrast = {
    inkUpperExclusive: number;
    segmentationFloor: number;
    verificationInteriorFloor: number;
    mode: "strong-source-contrast" | "separable-source-contrast";
};

export function originalRasterContrast(
    raster: GrayscaleRaster
): OriginalRasterContrast | null {
    const { width, height, pixels } = raster;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || pixels.length !== width * height || !pixels.length) return null;
    const counts = new Uint32Array(256);
    for (const pixel of pixels) counts[pixel]++;
    const total = pixels.length;
    let dark = 0, bright = 0;
    for (let p = 0; p < 100; p++) dark += counts[p];
    for (let p = 221; p < 256; p++) bright += counts[p];
    if (dark / total >= .005 && dark / total <= .30 && bright / total >= .60) {
        return {
            inkUpperExclusive: 100, segmentationFloor: 180,
            verificationInteriorFloor: 181, mode: "strong-source-contrast"
        };
    }
    // Score candidate splits by global between-class variance. A candidate
    // must put at least 0.5% but no more than 30% of source pixels into the
    // ink-like class, separate the average intensities by 28 grayscale steps,
    // and leave at least 60% demonstrably lighter background pixels.
    let weightedTotal = 0;
    for (let p = 0; p < 256; p++) weightedTotal += p * counts[p];
    let lowerCount = 0, lowerSum = 0;
    let best: { score: number; threshold: number; separation: number } | null = null;
    for (let threshold = 0; threshold < 255; threshold++) {
        lowerCount += counts[threshold];
        lowerSum += threshold * counts[threshold];
        const fraction = lowerCount / total;
        if (fraction < .005 || fraction > .30) continue;
        const upperCount = total - lowerCount;
        const separation = (weightedTotal - lowerSum) / upperCount - lowerSum / lowerCount;
        if (separation < 28) continue;
        const margin = Math.max(6, Math.round(separation * .12));
        const minBackground = Math.min(255, threshold + 1 + margin);
        let backgroundCount = 0;
        for (let p = minBackground; p < 256; p++) backgroundCount += counts[p];
        if (backgroundCount / total < .60) continue;
        const score = fraction * (1 - fraction) * separation * separation;
        if (!best || score > best.score)
            best = { score, threshold, separation };
    }
    if (!best) return null;
    const margin = Math.max(6, Math.round(best.separation * .12));
    return {
        inkUpperExclusive: best.threshold + 1,
        segmentationFloor: Math.min(255, best.threshold + 1 + margin),
        verificationInteriorFloor: Math.min(255, best.threshold + 1 + margin),
        mode: "separable-source-contrast"
    };
}
