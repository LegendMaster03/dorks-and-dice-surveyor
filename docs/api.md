# Surveyor API v1

## Capability boundaries

Surveyor is one service with separate APIs for distinct computer-vision operations. Phase 13 implements only known periodic-tiling detection:

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

A future operation that attempts to recognize an unknown tiling should use a separate capability such as `/v1/periodic-tiling/recognize`. Unrelated computer-vision operations likewise receive their own routes. The detection endpoint does not become a generic catch-all API.

## Periodic-tiling detection

The request body is the encoded raster itself. `Content-Type` must be `image/png`, `image/jpeg`, or `image/webp`. The caller authenticates with `Authorization: Bearer <service token>`.

The requested tiling is identified by standard notation. The notation itself carries the tiling identity, so callers do not separately send `periodicTilingType`, shape names, or polygon side counts. Surveyor derives `periodicTilingType` from the resolved notation and returns it as normalized response metadata.

Supported notation selectors:

- `crNotation` — Cundy-Rollett (C&R) notation. This is the preferred selector.
- `gjhNotation` — GomJau-Hogg (GJ-H) notation.

At least one notation selector is required. Both may be supplied only when they resolve to the same tiling. If a notation can not uniquely identify one known tiling, Surveyor must report ambiguity or require the more specific notation rather than asking the caller to provide a separate tiling-family discriminator.

Phase 13 implements only the Regular hexagonal tiling. These requests are equivalent:

- `crNotation=6^3`
- `gjhNotation=6/m30/r(h1)`

C&R normalization accepts the plain form `6^3`, braced exponent form `6^{3}`, and Unicode superscript form `6³`. GJ-H comparison ignores insignificant whitespace and letter case; the response always returns the canonical stored form.

For reference, the three Regular Euclidean tilings are recognized as:

| C&R | GJ-H | Derived type | Phase 13 detector |
| --- | --- | --- | --- |
| `3^6` | `3/m30/r(h2)` | `Regular` | not implemented |
| `4^4` | `4/m45/r(h1)` | `Regular` | not implemented |
| `6^3` | `6/m30/r(h1)` | `Regular` | implemented |

Known periodic-tiling families retained as derived classification vocabulary include `Regular`, `semiregular`, `k-uniform`, `Plane-vertex`, `2-uniform`, `Fractalizing`, and `non-edge-to-edge`. `semiregular` also retains the classification vocabulary `Archimedean` and `uniform`. These values are not request selectors.

The response returns normalized notation identity plus the derived periodic-tiling classification:

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

The service returns a versioned error object for missing/conflicting notation selectors, obsolete identity selectors, recognized but unimplemented tilings, malformed requests, unsupported images, authentication failures, overload, timeout, and internal failure. Transport/service failure is never reported as `gridless`.

## Health and capability discovery

- `GET /` returns the API version, notation-selector metadata, derived identity fields, implemented tilings, and recognized tiling-family classifications.
- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the bounded worker pool can currently accept work without running computer vision.
