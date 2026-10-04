# Surveyor API v1

## Capability boundaries

Surveyor is one service with separate APIs for distinct computer-vision operations. Phase 13 implements only known periodic-tiling detection:

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

A future operation that attempts to recognize an unknown tiling should use a separate capability such as `/v1/periodic-tiling/recognize`. Unrelated computer-vision operations likewise receive their own routes. The detection endpoint does not become a generic catch-all API.

## Periodic-tiling detection

The request body is the encoded raster itself. `Content-Type` must be `image/png`, `image/jpeg`, or `image/webp`. The caller authenticates with `Authorization: Bearer <service token>`.

Every request must declare exactly one `periodicTilingType`. The selected periodic-tiling family determines which additional arguments identify the requested tiling. The family is therefore the first-level discriminator; different families may require different argument counts and kinds, and they are not required to use shape arguments at all.

Known periodic-tiling families currently include:

- `periodicTilingType=Regular` — implemented in Phase 13;
- `periodicTilingType=semiregular` — reserved, not yet implemented; reserves `semiregularType=Archimedean|uniform`;
- `periodicTilingType=k-uniform` — reserved, not yet implemented;
- `periodicTilingType=Plane-vertex` — reserved, not yet implemented;
- `periodicTilingType=2-uniform` — reserved, not yet implemented;
- `periodicTilingType=Fractalizing` — reserved, not yet implemented;
- `periodicTilingType=non-edge-to-edge` — reserved, not yet implemented.

### Regular periodic tilings

The expected workflow is to declare `periodicTilingType=Regular` and identify the requested tiling with standard notation.

Preferred selector:

- `cundyRollettNotation` — Cundy-Rollett (C&R) notation.

Also supported:

- `gomJauHoggNotation` — GomJau-Hogg (GJ-H) notation;
- `shape` — convenience selector accepting a canonical shape name or side-count shorthand.

At least one selector is required. More than one selector may be supplied only when every selector resolves to the same tiling. Conflicting selectors return `400`.

Phase 13 implements only the Regular hexagonal tiling. The following requests are equivalent:

- `periodicTilingType=Regular&cundyRollettNotation=6^3`
- `periodicTilingType=Regular&gomJauHoggNotation=6/m30/r(h1)`
- `periodicTilingType=Regular&shape=hex`
- `periodicTilingType=Regular&shape=6`

C&R normalization accepts the plain form `6^3`, braced exponent form `6^{3}`, and Unicode superscript form `6³`. GJ-H comparison ignores insignificant whitespace and letter case; the response always returns the canonical stored form.

For reference, the three Regular Euclidean tilings are recognized as:

| Tiling | C&R | GJ-H | Phase 13 detector |
| --- | --- | --- | --- |
| triangular | `3^6` | `3/m30/r(h2)` | not implemented |
| square | `4^4` | `4/m45/r(h1)` | not implemented |
| hexagonal | `6^3` | `6/m30/r(h1)` | implemented |

The `shape` selector is deliberately secondary. Numeric shape arguments select a configured default shape for that side count; side count is shorthand, not shape identity. Future families may define completely different selector schemas.

The response returns normalized tiling identity explicitly:

```json
{
  "capability": "map.periodic-tiling.detect",
  "tiling": {
    "periodicTilingType": "Regular",
    "cundyRollettNotation": "6^3",
    "gomJauHoggNotation": "6/m30/r(h1)",
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

Optional detector parameters for the current Regular-hex implementation:

- `minimumSpacingPixels`
- `maximumSpacingPixels`
- `maximumEdgeSamples`
- `minimumConfidence`

The service returns a versioned error object for missing/unsupported periodic-tiling types, missing/conflicting selectors, recognized but unimplemented tilings, malformed requests, unsupported images, authentication failures, overload, timeout, and internal failure. Transport/service failure is never reported as `gridless`.

## Health and capability discovery

- `GET /` returns the API version plus capability metadata and family-specific argument schemas.
- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the bounded worker pool can currently accept work without running computer vision.
