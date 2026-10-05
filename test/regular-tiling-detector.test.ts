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

function renderPeriodicLines(
    image: GrayscaleRaster,
    normalDegrees: readonly number[],
    pitch: number,
    rotationDegrees: number,
    lineValue = 48): void {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            let nearest = Number.POSITIVE_INFINITY;
            for (const offset of normalDegrees) {
                const normal = (offset + rotationDegrees) * DEG;
                const rho = x * Math.cos(normal) + y * Math.sin(normal);
                const phase = ((rho % pitch) + pitch) % pitch;
                nearest = Math.min(nearest, phase, pitch - phase);
            }
            if (nearest <= 2) {
                const weight = Math.max(0, 1 - nearest / 2);
                const value = Math.round(224 - (224 - lineValue) * weight);
                const index = y * image.width + x;
                image.pixels[index] = Math.min(image.pixels[index], value);
            }
        }
    }
}

function addDeterministicNoise(image: GrayscaleRaster): void {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const index = y * image.width + x;
            const delta = ((x * 17 + y * 29 + ((x * y) % 19)) % 11) - 5;
            image.pixels[index] = Math.max(0, Math.min(255, image.pixels[index] + delta));
        }
    }
}

test("detects the Regular square tiling with the generalized two-family model", () => {
    const image = raster(360, 280);
    renderPeriodicLines(image, [0, 90], 32, 7);
    addDeterministicNoise(image);

    const result = detectRegularLattice(image, "regular.square", { minimumConfidence: 0.30 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.geometryId, "regular.square");
    assert.ok(Math.abs(result.fit.edgeLengthPixels - 32) < 1.0,
        `edge length ${result.fit.edgeLengthPixels}`);
    assert.ok(Math.abs(result.fit.rotationDegrees - 7) < 2.0,
        `rotation ${result.fit.rotationDegrees}`);
    assert.ok(result.fit.residualPixels < 2.6,
        `distant residual ${result.fit.residualPixels}`);
});

test("detects the Regular triangular tiling through the proven three-family detector", () => {
    const edgeLength = 30;
    const carrierPitch = edgeLength * Math.sqrt(3) / 2;
    const image = raster(420, 320);
    renderPeriodicLines(image, [0, 60, 120], carrierPitch, -4, 58);
    addDeterministicNoise(image);

    const result = detectRegularLattice(image, "regular.triangular", { minimumConfidence: 0.22 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.geometryId, "regular.triangular");
    assert.ok(Math.abs(result.fit.edgeLengthPixels - edgeLength) < 2.0,
        `edge length ${result.fit.edgeLengthPixels}`);
    assert.ok(result.fit.residualPixels < edgeLength * 0.30,
        `distant residual ${result.fit.residualPixels}`);
});
