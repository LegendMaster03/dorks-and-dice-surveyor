# Surveyor API v1

## Periodic-tiling detection

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

The request body is the encoded raster itself. `Content-Type` must be `image/png`, `image/jpeg`, or `image/webp`. The caller authenticates with `Authorization: Bearer <service token>`.

Every request must declare exactly one `periodicTilingType`. The selected periodic-tiling family determines the required ordered `shape` arguments that follow it.

Known periodic-tiling families currently include:

- `periodicTilingType=Regular` — implemented in Phase 13;
- `periodicTilingType=semiregular` — reserved, not yet implemented;
- `periodicTilingType=k-uniform` — reserved, not yet implemented.

### Regular periodic tilings

`Regular` requires exactly one `shape` argument.

The shape argument accepts either:

- a canonical shape name, for example `shape=hex`; or
- a polygon side-count shorthand, for example `shape=6`.

A numeric shape argument resolves to a configured default shape for that side count. Side count is shorthand, not shape identity: multiple named shapes may share the same number of sides without changing this contract.

Phase 13 implements only the Regular hex tiling. These requests are equivalent:

- `periodicTilingType=Regular&shape=hex`
- `periodicTilingType=Regular&shape=6`

Supplying zero or more than one `shape` argument for `Regular` is invalid. Square and other Regular shapes are intentionally not implemented yet.

Future periodic-tiling families may require a different number or interpretation of ordered `shape` arguments. The endpoint and top-level selector remain unchanged; the selected `periodicTilingType` owns that validation contract.

Optional detector parameters for the current Regular-hex implementation:

- `minimumSpacingPixels`
- `maximumSpacingPixels`
- `maximumEdgeSamples`
- `minimumConfidence`

The response identifies the resolved tiling explicitly and always returns shapes as an ordered array:

```json
{
  "capability": "map.periodic-tiling.detect",
  "tiling": {
    "periodicTilingType": "Regular",
    "shapes": [
      {
        "name": "hex",
        "sides": 6
      }
    ]
  }
}
```

The full response also reports source dimensions/media type, bounded analysis dimensions/scale, whether analysis ran at source resolution, classification (`detected`, `inconclusive`, or `gridless`), and an optional fit. Fit spacing, anchor, and residual are always in original source-image pixel coordinates.

The service returns a versioned error object for missing/unsupported periodic-tiling types, invalid shape-argument counts, unsupported shapes, malformed requests, unsupported images, authentication failures, overload, timeout, and internal failure. Transport/service failure is never reported as `gridless`.

## Health

- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the bounded worker pool can currently accept work without running computer vision.
