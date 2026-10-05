import assert from "node:assert/strict";
import test from "node:test";
import {
    detectRegularLattice,
    type GrayscaleRaster
} from "../src/analysis/regular-tiling/detector.js";

const DEG = Math.PI / 180;

function raster(width: number, height: number, value = 224): GrayscaleRaster {
    return { width, height, pixels: new Uint8Array(width * height).fill(value) };
}

function renderSquareGrid(
    image: GrayscaleRaster,
    spacing: number,
    rotationDegrees: number,
    lineValue = 42): void {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            for (const offset of [0, 90]) {
                const normal = (rotationDegrees + offset) * DEG;
                const rho = x * Math.cos(normal) + y * Math.sin(normal);
                const phase = ((rho % spacing) + spacing) % spacing;
                if (Math.min(phase, spacing - phase) <= 1.25) {
                    image.pixels[y * image.width + x] = lineValue;
                    break;
                }
            }
        }
    }
}

test("large Regular square spacing remains eligible instead of selecting a smaller alias", () => {
    const image = raster(960, 760);
    const spacing = 190;
    renderSquareGrid(image, spacing, 4);

    const result = detectRegularLattice(image, "regular.square", {
        minimumSpacingPixels: 150,
        maximumSpacingPixels: 240,
        minimumConfidence: 0.15
    });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.ok(Math.abs(result.fit.edgeLengthPixels - spacing) < 4,
        `expected approximately ${spacing} px spacing, got ${result.fit.edgeLengthPixels}`);
});
