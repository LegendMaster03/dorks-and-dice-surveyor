# Surveyor API v1

## Periodic-tiling detection

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

The request body is the encoded raster itself. `Content-Type` must be `image/png`, `image/jpeg`, or `image/webp`. The caller authenticates with `Authorization: Bearer <service token>`.

Every request must declare `tilingType`. Phase 13 implements only:

- `tilingType=regular`

A regular tiling must then identify the polygon shape with either:

- `shape=<canonical name>`; or
- `sides=<polygon side count>`.

`shape` is the canonical identity. `sides` is shorthand that selects a configured default shape for that side count; it does not imply that only one named shape may have that side count. If both selectors are supplied, the side count must agree with the named shape.

Phase 13 implements only the regular hex tiling. Equivalent current requests are therefore:

- `tilingType=regular&shape=hex`
- `tilingType=regular&sides=6`
- `tilingType=regular&shape=hex&sides=6`

Square and other regular shapes are intentionally not implemented yet. Other periodic-tiling families can be added later under new `tilingType` values without changing this endpoint.

Optional detector parameters for the current regular-hex implementation:

- `minimumSpacingPixels`
- `maximumSpacingPixels`
- `maximumEdgeSamples`
- `minimumConfidence`

The response identifies the resolved tiling explicitly, for example:

```json
{
  "capability": "map.periodic-tiling.detect",
  "tiling": {
    "type": "regular",
    "shape": {
      "name": "hex",
      "sides": 6
    }
  }
}
```

The full response also reports source dimensions/media type, bounded analysis dimensions/scale, whether analysis ran at source resolution, classification (`detected`, `inconclusive`, or `gridless`), and an optional fit. Fit spacing, anchor, and residual are always in original source-image pixel coordinates.

The service returns a versioned error object for missing/unsupported tiling selectors, malformed requests, unsupported images, authentication failures, overload, timeout, and internal failure. Transport/service failure is never reported as `gridless`.

## Health

- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the bounded worker pool can currently accept work without running computer vision.
