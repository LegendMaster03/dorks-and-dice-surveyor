# Surveyor API v1

## Capability boundaries

Surveyor is one service with separate APIs for distinct computer-vision operations. Phase 13 implements only known periodic-tiling detection:

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

A future operation that attempts to recognize an unknown tiling should use a separate capability such as `/v1/periodic-tiling/recognize`. Unrelated computer-vision operations likewise receive their own routes. The detection endpoint does not become a generic catch-all API.

## Periodic-tiling detection

The request body is the encoded raster itself. `Content-Type` must be `image/png`, `image/jpeg`, or `image/webp`. The caller authenticates with `Authorization: Bearer <service token>`.

Every request must declare exactly one `periodicTilingType`. The selected periodic-tiling family determines which additional arguments identify the requested tiling. The family is therefore the first-level discriminator; different families may require different argument counts and kinds.

Known periodic-tiling families currently include:

- `periodicTilingType=Regular` — implemented in Phase 13;
- `periodicTilingType=semiregular` — reserved, not yet implemented; reserves `semiregularType=Archimedean|uniform`;
- `periodicTilingType=k-uniform` — reserved, not yet implemented;
- `periodicTilingType=Plane-vertex` — reserved, not yet implemented;
- `periodicTilingType=2-uniform` — reserved, not yet implemented;
- `periodicTilingType=Fractalizing` — reserved, not yet implemented;
- `periodicTilingType=non-edge-to-edge` — reserved, not yet implemented.

### Regular periodic tilings

The normal workflow is to declare `periodicTilingType=Regular` and identify the requested tiling with standard notation.

Supported notation selectors:

- `crNotation` — Cundy-Rollett (C&R) notation. This is the preferred selector.
- `gjhNotation` — GomJau-Hogg (GJ-H) notation.

At least one notation selector is required. Both may be supplied only when they resolve to the same tiling. Shape names and side-count shorthand are deliberately not part of the public API.

Phase 13 implements only the Regular hexagonal tiling. These requests are equivalent:

- `periodicTilingType=Regular&crNotation=6^3`
- `periodicTilingType=Regular&gjhNotation=6/m30/r(h1)`

C&R normalization accepts the plain form `6^3`, braced exponent form `6^{3}`, and Unicode superscript form `6³`. GJ-H comparison ignores insignificant whitespace and letter case; the response always returns the canonical stored form.

For reference, the three Regular Euclidean tilings are recognized as:

| C&R | GJ-H | Phase 13 detector |
| --- | --- | --- |
| `3^6` | `3/m30/r(h2)` | not implemented |
| `4^4` | `4/m45/r(h1)` | not implemented |
| `6^3` | `6/m30/r(h1)` | implemented |

The response returns normalized notation identity explicitly:

```json
{
  "capability": "map.periodic-tiling.detect",
  "tiling": {
    "periodicTilingType": "Regular",
    "crNotation": "6^3",
    "gjhNotation": "6/m30/r(h1)"
  }
}
```

The full response also reports source dimensions/media type, bounded analysis dimensions/scale, whether analysis ran at source resolution, classification (`detected`, `inconclusive`, or `gridless`), and an optional fit. Fit spacing, anchor, and residual are always in original source-image pixel coordinates.

Optional detector parameters for the current Regular-hex implementation:

- `minimumSpacingPixels`
- `maximumSpacingPixels`
- `maximumEdgeSamples`
- `minimumConfidence`

The service returns a versioned error object for missing/unsupported periodic-tiling types, missing/conflicting notation selectors, recognized but unimplemented tilings, malformed requests, unsupported images, authentication failures, overload, timeout, and internal failure. Transport/service failure is never reported as `gridless`.

## Health and capability discovery

- `GET /` returns the API version plus capability metadata and family-specific argument schemas.
- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the bounded worker pool can currently accept work without running computer vision.
