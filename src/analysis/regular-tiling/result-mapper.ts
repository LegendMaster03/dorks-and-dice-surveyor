import type { RegularLatticeDetection } from "./detector.js";

/** Restore all geometry-dependent measurements to source pixels without changing confidence. */
export function mapRegularDetectionToSourceImage(
    detection: RegularLatticeDetection,
    analysisScale: number): RegularLatticeDetection {
    if (!Number.isFinite(analysisScale) || analysisScale <= 0) {
        throw new Error("Raster analysis scale must be finite and positive.");
    }
    if (!detection.fit) return detection;
    return {
        ...detection,
        reason: mapPixelMeasurementsToSourceImage(detection.reason, analysisScale),
        fit: {
            ...detection.fit,
            edgeLengthPixels: detection.fit.edgeLengthPixels / analysisScale,
            ...(detection.fit.centerSpacingPixels == null
                ? {}
                : { centerSpacingPixels: detection.fit.centerSpacingPixels / analysisScale }),
            // Sample centers need the same half-pixel convention as the hex mapper.
            anchorPixel: {
                x: (detection.fit.anchorPixel.x + 0.5) / analysisScale,
                y: (detection.fit.anchorPixel.y + 0.5) / analysisScale
            },
            residualPixels: detection.fit.residualPixels / analysisScale
        }
    };
}

// Diagnostic strings can contain measured pixel distances; keep their
// units consistent with the coordinates returned in the response.
function mapPixelMeasurementsToSourceImage(reason: string, analysisScale: number): string {
    if (Math.abs(analysisScale - 1) <= Number.EPSILON) return reason;
    return reason.replace(/(-?[0-9]+(?:\.[0-9]+)?) px\b/g, (_match, raw: string) => {
        const value = Number(raw);
        return Number.isFinite(value) ? `${(value / analysisScale).toFixed(2)} px` : _match;
    });
}
