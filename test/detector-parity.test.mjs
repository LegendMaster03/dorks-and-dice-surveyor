import assert from "node:assert/strict";
import test from "node:test";
import { detectHexLattice } from "../dist/src/analysis/hex-grid/detector.js";

const radians = degrees => degrees * Math.PI / 180;

function raster(width, height, value = 224) {
    return { width, height, pixels: new Uint8Array(width * height).fill(value) };
}

function darkenPixel(image, x, y, value = 32) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return;
    image.pixels[iy * image.width + ix] = Math.min(image.pixels[iy * image.width + ix], value);
}

function drawLine(image, start, end, value = 32, width = 1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) * 1.5));
    for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const x = start.x + ((end.x - start.x) * t);
        const y = start.y + ((end.y - start.y) * t);
        for (let dy = -width; dy <= width; dy++) {
            for (let dx = -width; dx <= width; dx++) {
                if ((dx * dx) + (dy * dy) <= width * width + 0.5) darkenPixel(image, x + dx, y + dy, value);
            }
        }
    }
}

function renderHexGrid(image, {
    orientation,
    spacing,
    rotationDegrees = 0,
    anchor = { x: 0, y: 0 },
    lineValue = 35
}) {
    const base = radians((orientation === "PointyTop" ? 0 : 30) + rotationDegrees);
    const u = { x: spacing * Math.cos(base), y: spacing * Math.sin(base) };
    const v = { x: spacing * Math.cos(base + Math.PI / 3), y: spacing * Math.sin(base + Math.PI / 3) };
    const radius = spacing / Math.sqrt(3);
    const cornerStart = (orientation === "PointyTop" ? -30 : 0) + rotationDegrees;
    const reach = Math.ceil(Math.hypot(image.width, image.height) / spacing) + 4;

    for (let i = -reach; i <= reach; i++) {
        for (let j = -reach; j <= reach; j++) {
            const center = {
                x: anchor.x + (i * u.x) + (j * v.x),
                y: anchor.y + (i * u.y) + (j * v.y)
            };
            if (center.x < -spacing || center.y < -spacing
                || center.x > image.width + spacing || center.y > image.height + spacing) continue;
            const corners = [];
            for (let corner = 0; corner < 6; corner++) {
                const angle = radians(cornerStart + corner * 60);
                corners.push({
                    x: center.x + radius * Math.cos(angle),
                    y: center.y + radius * Math.sin(angle)
                });
            }
            for (let edge = 0; edge < 6; edge++) {
                drawLine(image, corners[edge], corners[(edge + 1) % 6], lineValue, 1);
            }
        }
    }
}

function overlayRectangle(target, source, x0, y0, x1, y1) {
    for (let y = Math.max(0, y0); y < Math.min(target.height, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(target.width, x1); x++) {
            const index = y * target.width + x;
            target.pixels[index] = Math.min(target.pixels[index], source.pixels[index]);
        }
    }
}

function addMapNoise(image) {
    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const index = y * image.width + x;
            const variation = ((x * 17 + y * 29 + ((x * y) % 31)) % 29) - 14;
            image.pixels[index] = Math.max(0, Math.min(255, image.pixels[index] + variation));
        }
    }
    drawLine(image, { x: 8, y: 13 }, { x: image.width - 18, y: image.height - 29 }, 58, 2);
    drawLine(image, { x: image.width * 0.72, y: 0 }, { x: image.width * 0.42, y: image.height }, 70, 2);
    drawLine(image, { x: 0, y: image.height * 0.63 }, { x: image.width, y: image.height * 0.56 }, 84, 1);
}

function eraseRectangle(image, x0, y0, x1, y1, value = 214) {
    for (let y = Math.max(0, y0); y < Math.min(image.height, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(image.width, x1); x++) {
            image.pixels[y * image.width + x] = value;
        }
    }
}

function replaceRightHalf(target, source) {
    const split = Math.floor(target.width / 2);
    for (let y = 0; y < target.height; y++) {
        for (let x = split; x < target.width; x++) {
            target.pixels[y * target.width + x] = source.pixels[y * source.width + x];
        }
    }
}

test("detects a rotated flat-top hex lattice with noise", () => {
    const image = raster(320, 240);
    const expected = {
        orientation: "FlatTop",
        spacing: 38,
        rotationDegrees: 4,
        anchor: { x: 13, y: 9 }
    };
    renderHexGrid(image, expected);
    addMapNoise(image);

    const result = detectHexLattice(image, { minimumConfidence: 0.30 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.orientation, "FlatTop");
    assert.ok(Math.abs(result.fit.rotationDegrees - expected.rotationDegrees) < 4.0,
        `rotation ${result.fit.rotationDegrees}`);
    assert.ok(Math.abs(result.fit.centerSpacingPixels - expected.spacing) < 4.0,
        `spacing ${result.fit.centerSpacingPixels}`);
    assert.ok(result.fit.supportCoverage > 0.10, `coverage ${result.fit.supportCoverage}`);
    assert.ok(result.fit.residualPixels < expected.spacing * 0.25,
        `far-field residual ${result.fit.residualPixels}`);
});

test("detects a pointy-top lattice through occlusion and unrelated map lines", () => {
    const image = raster(300, 260, 218);
    const expected = {
        orientation: "PointyTop",
        spacing: 31,
        rotationDegrees: -3,
        anchor: { x: 7, y: 17 },
        lineValue: 42
    };
    renderHexGrid(image, expected);
    addMapNoise(image);
    eraseRectangle(image, 78, 54, 172, 132);
    eraseRectangle(image, 205, 168, 287, 228);

    const result = detectHexLattice(image, { minimumConfidence: 0.25 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.orientation, "PointyTop");
    assert.ok(Math.abs(result.fit.rotationDegrees - expected.rotationDegrees) < 4.0,
        `rotation ${result.fit.rotationDegrees}`);
    assert.ok(Math.abs(result.fit.centerSpacingPixels - expected.spacing) < 4.0,
        `spacing ${result.fit.centerSpacingPixels}`);
    assert.ok(result.fit.supportCoverage > 0.08, `coverage ${result.fit.supportCoverage}`);
    assert.ok(result.fit.residualPixels < expected.spacing * 0.30,
        `far-field residual ${result.fit.residualPixels}`);
});

test("uses the fundamental period for a faint grid beneath stronger map artwork", () => {
    const image = raster(360, 280, 210);
    const expected = {
        orientation: "PointyTop",
        spacing: 24,
        rotationDegrees: 0,
        anchor: { x: 9, y: 11 },
        lineValue: 174
    };
    renderHexGrid(image, expected);

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const index = y * image.width + x;
            const variation = ((x * 11 + y * 7 + ((x * y) % 17)) % 13) - 6;
            image.pixels[index] = Math.max(0, Math.min(255, image.pixels[index] + variation));
        }
    }

    drawLine(image, { x: 6, y: 8 }, { x: image.width - 7, y: 8 }, 28, 4);
    drawLine(image, { x: 6, y: 8 }, { x: 6, y: image.height - 9 }, 28, 4);
    drawLine(image, { x: 18, y: 63 }, { x: image.width - 20, y: 224 }, 38, 3);
    drawLine(image, { x: 27, y: 246 }, { x: image.width - 31, y: 84 }, 44, 3);
    eraseRectangle(image, 104, 76, 238, 166, 202);

    const result = detectHexLattice(image, { minimumConfidence: 0.24 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.orientation, expected.orientation);
    assert.ok(Math.abs(result.fit.rotationDegrees) < 3.0, `rotation ${result.fit.rotationDegrees}`);
    assert.ok(Math.abs(result.fit.centerSpacingPixels - expected.spacing) < 3.0,
        `expected fundamental ${expected.spacing}, got ${result.fit.centerSpacingPixels}`);
    assert.ok(result.fit.residualPixels < expected.spacing * 0.35,
        `far-field residual ${result.fit.residualPixels}`);
});

test("fits the globally rigid lattice instead of a stronger local near-period lattice", () => {
    const image = raster(768, 576, 218);
    const expected = {
        orientation: "FlatTop",
        spacing: 30,
        rotationDegrees: 0,
        anchor: { x: 11, y: 8 },
        lineValue: 166
    };
    renderHexGrid(image, expected);
    addMapNoise(image);

    // This models the Humblewood browser failure at analysis scale: a 0.18 px
    // center-spacing error here becomes about 0.48 px after scaling back to the
    // 2048 px raster. Stronger local repeated artwork must not move the one rigid
    // lattice that is supported across the distant regions of the image.
    const localDistractor = raster(image.width, image.height, 255);
    renderHexGrid(localDistractor, {
        ...expected,
        spacing: 30.18,
        anchor: { x: 12.5, y: 9.5 },
        lineValue: 38
    });
    overlayRectangle(image, localDistractor, 190, 95, 610, 485);

    const result = detectHexLattice(image, { minimumConfidence: 0.28 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.orientation, expected.orientation);
    assert.ok(Math.abs(result.fit.centerSpacingPixels - expected.spacing) < 0.12,
        `distant fit drifted to ${result.fit.centerSpacingPixels}`);
    assert.ok(Math.abs(result.fit.rotationDegrees - expected.rotationDegrees) < 0.5,
        `rotation ${result.fit.rotationDegrees}`);
    assert.ok(result.fit.residualPixels < 1.5,
        `worst distant-region behavior is too large: ${result.fit.residualPixels}`);
});

test("keeps continuous spacing precision unless a rounded hypothesis fits better", () => {
    const image = raster(640, 480, 224);
    renderHexGrid(image, {
        orientation: "FlatTop",
        spacing: 30.001,
        rotationDegrees: 0,
        anchor: { x: 9.5, y: 11.25 },
        lineValue: 64
    });

    const result = detectHexLattice(image, { minimumConfidence: 0.22 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.orientation, "FlatTop");
    assert.ok(Math.abs(result.fit.centerSpacingPixels - 30.001) <= 0.02,
        `expected the best supported spacing near 30.001 px, got ${result.fit.centerSpacingPixels}`);
});

test("does not force genuine non-quarter spacing onto a quarter-pixel lattice", () => {
    const image = raster(900, 660, 224);
    const expected = {
        orientation: "FlatTop",
        spacing: 30.37,
        rotationDegrees: 1.25,
        anchor: { x: 10.7, y: 14.2 },
        lineValue: 64
    };
    renderHexGrid(image, expected);

    const result = detectHexLattice(image, { minimumConfidence: 0.22 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.orientation, expected.orientation);

    const nearestQuarter = Math.round(expected.spacing / 0.25) * 0.25;
    const detectedError = Math.abs(result.fit.centerSpacingPixels - expected.spacing);
    const quarterError = Math.abs(nearestQuarter - expected.spacing);
    assert.ok(detectedError < quarterError,
        `spacing ${result.fit.centerSpacingPixels} was forced toward quarter-pixel ${nearestQuarter}`);
    assert.ok(Math.abs(result.fit.centerSpacingPixels - nearestQuarter) > 0.03,
        `spacing ${result.fit.centerSpacingPixels} should remain non-quarter-pixel`);
});

test("rejects a center-plausible fit that drifts in distant regions", () => {
    const left = raster(640, 420, 220);
    const right = raster(640, 420, 220);
    renderHexGrid(left, {
        orientation: "FlatTop",
        spacing: 30,
        anchor: { x: 8, y: 17 },
        lineValue: 80
    });
    renderHexGrid(right, {
        orientation: "FlatTop",
        spacing: 31,
        anchor: { x: 8, y: 17 },
        lineValue: 80
    });
    addMapNoise(left);
    addMapNoise(right);
    replaceRightHalf(left, right);

    const result = detectHexLattice(left, { minimumConfidence: 0.25 });
    assert.equal(result.status, "inconclusive", result.reason);
    assert.ok(result.fit, result.reason);
    assert.match(result.reason, /final rigid overlay misses|stable rigid lattice/i);
    assert.ok(result.fit.residualPixels > 2.4,
        `worst distant residual ${result.fit.residualPixels}`);
});

test("keeps a Bellowing-Wilds-scale lattice eligible instead of selecting a small rotated alias", () => {
    const image = raster(768, 480, 224);
    const expected = {
        orientation: "FlatTop",
        spacing: 132.67,
        rotationDegrees: 0,
        anchor: { x: 31, y: 27 },
        lineValue: 64
    };
    renderHexGrid(image, expected);

    // Model the browser regression: a smaller rotated repeated pattern exists locally,
    // but the one lattice supported across the whole raster is the approximately
    // 132.7 px flat-top grid. The old 120 px Hough-lag ceiling made the true candidate
    // impossible to generate and left smaller aliases to win by default.
    const localAlias = raster(image.width, image.height, 255);
    renderHexGrid(localAlias, {
        orientation: "FlatTop",
        spacing: 29.42,
        rotationDegrees: 3.68,
        anchor: { x: 11, y: 8 },
        lineValue: 100
    });
    overlayRectangle(image, localAlias, 204, 120, 564, 360);

    const result = detectHexLattice(image, { minimumConfidence: 0.30 });
    assert.notEqual(result.status, "gridless", result.reason);
    assert.ok(result.fit, result.reason);
    assert.equal(result.fit.orientation, expected.orientation);
    assert.ok(Math.abs(result.fit.centerSpacingPixels - expected.spacing) < 2.0,
        `expected Bellowing-scale spacing near ${expected.spacing}, got ${result.fit.centerSpacingPixels}`);
    assert.ok(Math.abs(result.fit.rotationDegrees) < 1.0,
        `expected near-zero Bellowing rotation, got ${result.fit.rotationDegrees}`);
    assert.ok(result.fit.residualPixels < 2.5,
        `Bellowing-scale distant phase is unstable: ${result.fit.residualPixels}`);
    assert.ok(result.fit.centerSpacingPixels > 120,
        `smaller alias incorrectly won at ${result.fit.centerSpacingPixels} px`);
});

test("does not invent a canonical lattice on a gridless raster", () => {
    const image = raster(280, 220, 210);
    addMapNoise(image);
    eraseRectangle(image, 45, 40, 225, 175, 191);
    drawLine(image, { x: 17, y: 201 }, { x: 266, y: 32 }, 49, 2);
    drawLine(image, { x: 12, y: 70 }, { x: 255, y: 94 }, 63, 1);

    const result = detectHexLattice(image);
    assert.notEqual(result.status, "detected", result.reason);
});
