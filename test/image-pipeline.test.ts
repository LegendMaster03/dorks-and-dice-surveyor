import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { prepareRaster } from "../src/image/preprocess.js";
import { mapDetectionToSourceImage } from "../src/analysis/hex-grid/result-mapper.js";

for (const fixture of [
    { mediaType: "image/png", format: "png" },
    { mediaType: "image/jpeg", format: "jpeg" },
    { mediaType: "image/webp", format: "webp" }
] as const) {
    test(`${fixture.mediaType} decodes through the bounded grayscale pipeline`, async () => {
        const image = sharp({
            create: { width: 96, height: 72, channels: 3, background: { r: 220, g: 180, b: 140 } }
        });
        const encoded = fixture.format === "png"
            ? await image.png().toBuffer()
            : fixture.format === "jpeg"
                ? await image.jpeg({ quality: 95 }).toBuffer()
                : await image.webp({ quality: 95 }).toBuffer();
        const prepared = await prepareRaster(encoded, fixture.mediaType, 1_000_000, 2048);
        assert.equal(prepared.sourceWidth, 96);
        assert.equal(prepared.sourceHeight, 72);
        assert.equal(prepared.analysisScale, 1);
        assert.equal(prepared.raster.pixels.length, 96 * 72);
    });
}

test("bounded resize reports explicit scale and dimensions", async () => {
    const encoded = await sharp({
        create: { width: 3000, height: 1000, channels: 3, background: { r: 240, g: 240, b: 240 } }
    }).png().toBuffer();
    const prepared = await prepareRaster(encoded, "image/png", 4_000_000, 2048);
    assert.equal(prepared.sourceWidth, 3000);
    assert.equal(prepared.sourceHeight, 1000);
    assert.equal(prepared.analysisScale, 2048 / 3000);
    assert.equal(prepared.raster.width, 2048);
    assert.equal(prepared.raster.height, Math.round(1000 * 2048 / 3000));
});

test("source-coordinate mapping preserves legacy sample-center semantics", () => {
    const result = mapDetectionToSourceImage({
        status: "detected",
        reason: "fixture",
        fit: {
            orientation: "FlatTop",
            rotationDegrees: 3,
            centerSpacingPixels: 40,
            anchorPixel: { x: 9.5, y: 19.5 },
            confidence: 0.9,
            residualPixels: 1,
            supportCoverage: 0.5,
            orientationSupport: 0.8,
            translationScore: 0.8,
            competingTranslationScore: 0.1,
            linePeriodicityScore: 0.8,
            phaseScore: 0.4
        }
    }, 0.5);
    assert.equal(result.fit?.centerSpacingPixels, 80);
    assert.deepEqual(result.fit?.anchorPixel, { x: 20, y: 40 });
    assert.equal(result.fit?.residualPixels, 2);
});

test("malformed image and declared/decoded mismatch are rejected", async () => {
    await assert.rejects(prepareRaster(Buffer.from("not an image"), "image/png", 1_000_000, 2048));
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer();
    await assert.rejects(prepareRaster(png, "image/jpeg", 1_000_000, 2048), /does not match decoded/);
});

test("decoded pixel limit is enforced before raw raster allocation", async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
    await assert.rejects(prepareRaster(png, "image/png", 5_000, 2048));
});
