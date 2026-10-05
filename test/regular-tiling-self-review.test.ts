import assert from "node:assert/strict";
import test from "node:test";
import {
    detectRegularLattice,
    type GrayscaleRaster,
    type RegularLatticeDetection,
    type RegularLatticeDetectionOptions
} from "../src/analysis/regular-tiling/detector.js";

const DEG = Math.PI / 180;

function raster(width: number, height: number, value = 224): GrayscaleRaster {
    return { width, height, pixels: new Uint8Array(width * height).fill(value) };
}

function darkenPixel(image: GrayscaleRaster, x: number, y: number, value = 32): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return;
    const index = iy * image.width + ix;
    image.pixels[index] = Math.min(image.pixels[index], value);
}

function drawLine(
    image: GrayscaleRaster,
    start: { x: number; y: number },
    end: { x: number; y: number },
    value = 32,
    width = 1): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) * 1.5));
    for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const x = start.x + (end.x - start.x) * t;
        const y = start.y + (end.y - start.y) * t;
        for (let dy = -width; dy <= width; dy++) {
            for (let dx = -width; dx <= width; dx++) {
                if (dx * dx + dy * dy <= width * width + 0.5) {
                    darkenPixel(image, x + dx, y + dy, value);
                }
            }
        }
    }
}

function renderHardPeriodicLines(
    image: GrayscaleRaster,
    normalDegrees: readonly number[],
    pitch: number,
    rotationDegrees: number,
    lineValue = 48): void {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            for (const offset of normalDegrees) {
                const normal = (offset + rotationDegrees) * DEG;
                const rho = x * Math.cos(normal) + y * Math.sin(normal);
                const phase = ((rho % pitch) + pitch) % pitch;
                if (Math.min(phase, pitch - phase) <= 1.15) {
                    image.pixels[y * image.width + x] = lineValue;
                    break;
                }
            }
        }
    }
}

function renderSmoothPeriodicLines(
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

function renderHexGrid(
    image: GrayscaleRaster,
    spacing: number,
    rotationDegrees = 0,
    anchor = { x: 11, y: 9 }): void {
    const basis = rotationDegrees * DEG;
    const u = { x: spacing * Math.cos(basis), y: spacing * Math.sin(basis) };
    const v = {
        x: spacing * Math.cos(basis + Math.PI / 3),
        y: spacing * Math.sin(basis + Math.PI / 3)
    };
    const radius = spacing / Math.sqrt(3);
    const cornerStart = (-30 + rotationDegrees) * DEG;
    const reach = Math.ceil(Math.hypot(image.width, image.height) / spacing) + 4;

    for (let i = -reach; i <= reach; i++) {
        for (let j = -reach; j <= reach; j++) {
            const center = {
                x: anchor.x + i * u.x + j * v.x,
                y: anchor.y + i * u.y + j * v.y
            };
            if (center.x < -spacing || center.y < -spacing
                || center.x > image.width + spacing || center.y > image.height + spacing) continue;
            const corners = Array.from({ length: 6 }, (_, index) => {
                const angle = cornerStart + index * Math.PI / 3;
                return {
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                };
            });
            for (let edge = 0; edge < 6; edge++) {
                drawLine(image, corners[edge], corners[(edge + 1) % 6], 45, 1);
            }
        }
    }
}

test("hard-edged square raster retains its geometric orientation", () => {
    const image = raster(360, 280);
    renderHardPeriodicLines(image, [0, 90], 32, 7);

    const result = detectRegularLattice(image, "regular.square", { minimumConfidence: 0.20 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.ok(Math.abs(result.fit.rotationDegrees - 7) < 2,
        `hard-raster orientation drifted to ${result.fit.rotationDegrees}`);
});

test("triangular and hexagonal profiles do not accept each other's edge occupancy", () => {
    const triangular = raster(420, 320);
    const edgeLength = 30;
    renderSmoothPeriodicLines(
        triangular,
        [0, 60, 120],
        edgeLength * Math.sqrt(3) / 2,
        -4,
        52);
    const asHex = detectRegularLattice(
        triangular,
        "regular.hexagonal",
        { minimumConfidence: 0.18 });
    assert.notEqual(asHex.status, "detected",
        `triangular grid was accepted as hexagonal: ${asHex.reason}`);

    const hexagonal = raster(420, 320);
    renderHexGrid(hexagonal, edgeLength * Math.sqrt(3), -4);
    const asTriangular = detectRegularLattice(
        hexagonal,
        "regular.triangular",
        { minimumConfidence: 0.18 });
    assert.notEqual(asTriangular.status, "detected",
        `hexagonal grid was accepted as triangular: ${asTriangular.reason}`);
});

test("unsupported runtime geometry is rejected instead of falling through to square", () => {
    const unsafeDetect = detectRegularLattice as unknown as (
        raster: GrayscaleRaster,
        geometryId: string,
        options?: RegularLatticeDetectionOptions) => RegularLatticeDetection;
    assert.throws(
        () => unsafeDetect(raster(96, 96), "regular.pentagonal"),
        /unsupported regular tiling geometry/i);
});
