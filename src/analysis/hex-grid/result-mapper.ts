import type { HexLatticeDetection } from "./detector.js";

export function mapDetectionToSourceImage(
    detection: HexLatticeDetection,
    analysisScale: number): HexLatticeDetection {
    if (!Number.isFinite(analysisScale) || analysisScale <= 0) {
        throw new Error("Raster analysis scale must be finite and positive.");
    }
    if (!detection.fit) return detection;
    return {
        ...detection,
        fit: {
            ...detection.fit,
            centerSpacingPixels: detection.fit.centerSpacingPixels / analysisScale,
            anchorPixel: {
                x: (detection.fit.anchorPixel.x + 0.5) / analysisScale,
                y: (detection.fit.anchorPixel.y + 0.5) / analysisScale
            },
            residualPixels: detection.fit.residualPixels / analysisScale
        }
    };
}
