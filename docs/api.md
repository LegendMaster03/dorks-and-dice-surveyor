# Surveyor API v1

## Resource discovery

Surveyor hosts multiple headless resources behind one service. `GET /` returns the API version, registered resource identifiers, and capability descriptors. Each capability keeps its own route and request contract rather than being multiplexed through a generic analysis endpoint.

The first registered resource is `periodic-tiling`.

## Periodic-tiling detection

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

The request body is the encoded raster itself. `Content-Type` must be `image/png`, `image/jpeg`, or `image/webp`. The caller authenticates with `Authorization: Bearer <service token>`.

The requested tiling is identified by standard notation. The notation carries tiling identity, so callers do not separately send `periodicTilingType`, shape names, or polygon side counts. Surveyor derives `periodicTilingType` from a resolved catalog identity and returns it as normalized response metadata.

Supported notation selectors:

- `crNotation` — Cundy-Rollett notation. This is the preferred selector.
- `gjhNotation` — GomJau-Hogg notation.

At least one notation selector is required. Both may be supplied only when Surveyor can resolve both to the same cataloged tiling.

### Parser and catalog behavior

Notation parsing is independent from the registered-tiling catalog and detector implementations. This produces distinct API outcomes:

| Condition | Status | Error code |
| --- | ---: | --- |
| malformed Cundy-Rollett syntax | 400 | `invalid_cr_notation` |
| malformed GomJau-Hogg syntax | 400 | `invalid_gjh_notation` |
| valid notation with no registered identity | 501 | `tiling_identity_unregistered` |
| registered identity with no detector | 501 | `tiling_not_implemented` |
| two registered selectors identify different tilings | 400 | `tiling_selector_conflict` |

A syntactically valid unknown notation is therefore not mislabeled as malformed, and the parser does not need a detector-specific allowlist.

Cundy-Rollett canonicalization accepts forms such as `6^3`, `6^{3}`, `6³`, and `6.6.6` and returns `6^3`. The parser also preserves compound/grouped vertex expressions and bracketed variant indices.

GomJau-Hogg comparison ignores insignificant whitespace and case and canonicalizes placement and transformation stages. Polygon-placement phases and mirror/rotation stages are parsed structurally even when the resulting tiling has no catalog entry.

### Regular tilings

The Regular family is the first initialized periodic-tiling family:

| Cundy-Rollett | GomJau-Hogg | Derived type | Detector |
| --- | --- | --- | --- |
| `3^6` | `3/m30/r(h2)` | `Regular` | not implemented |
| `4^4` | `4/m45/r(h1)` | `Regular` | not implemented |
| `6^3` | `6/m30/r(h1)` | `Regular` | `regular.hexagonal` |

For the currently implemented hexagonal detector, these requests are equivalent:

- `crNotation=6^3`
- `gjhNotation=6/m30/r(h1)`
- both selectors together, when they resolve to that same identity.

The response returns canonical notation identity plus the derived periodic-tiling classification:

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

The full response also reports source dimensions/media type, bounded analysis dimensions/scale, whether analysis ran at source resolution, classification (`detected`, `inconclusive`, or `gridless`), detector fit, and timing. For the current hexagonal detector, fit spacing, anchor, and residual are in original source-image pixel coordinates.

Optional detector parameters for the current `regular.hexagonal` implementation:

- `minimumSpacingPixels`
- `maximumSpacingPixels`
- `maximumEdgeSamples`
- `minimumConfidence`

These are detector options, not tiling identity selectors. A future detector does not have to use the same options if they are not meaningful for that geometry.

## Classification vocabulary

Derived periodic-tiling classification vocabulary currently includes `Regular`, `semiregular`, `k-uniform`, `Plane-vertex`, `2-uniform`, `Fractalizing`, and `non-edge-to-edge`. `semiregular` also retains `Archimedean` and `uniform` classification vocabulary. These values are not request selectors.

## Health

- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the current bounded analysis worker pool can accept work.
