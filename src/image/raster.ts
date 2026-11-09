/** Row-major 8-bit luminance samples; pixel (x, y) is at y * width + x. */
export type GrayscaleRaster = {
    width: number;
    height: number;
    pixels: Uint8Array;
};
