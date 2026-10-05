import type { RegularLatticeDetection } from "./detector.js";

export function mapRegularDetectionToSourceImage(
    detection: RegularLatticeDetection,
    analysisScale: number): RegularLatticeDetection {
    if (!Number.isFinite(analysisScale) || analysisScale <= 0) {
        throw new Error("Raster analysis scale must be finite and positive.");
    }
    if (!detection.fit) return detection;
    return {
        ...detection,
        fit: {
            ...detection.fit,
            edgeLengthPixels: detection.fit.edgeLengthPixels / analysisScale,
            ...(detection.fit.centerSpacingPixels == null
                ? {}
                : { centerSpacingPixels: detection.fit.centerSpacingPixels / analysisScale }),
            anchorPixel: {
                x: (detection.fit.anchorPixel.x + 0.5) / analysisScale,
                y: (detection.fit.anchorPixel.y + 0.5) / analysisScale
            },
            residualPixels: detection.fit.residualPixels / analysisScale
        }
    };
}
