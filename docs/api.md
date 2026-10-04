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
| malformed or non-Euclidean Cundy-Rollett vertex syntax | 400 | `invalid_cr_notation` |
| malformed GomJau-Hogg syntax | 400 | `invalid_gjh_notation` |
| valid notation with no registered identity | 501 | `tiling_identity_unregistered` |
| registered identity with no detector | 501 | `tiling_not_implemented` |
| two registered selectors identify different tilings | 400 | `tiling_selector_conflict` |

A structurally valid unknown tiling is therefore not mislabeled as a missing detector, and the parser does not use a detector-specific allowlist. The tests use the published uniform `12-3/m30/r(h3)` as a valid GJ-H notation that is intentionally not yet in Surveyor's Regular-only catalog.

Cundy-Rollett canonicalization accepts forms such as `6^3`, `6^{3}`, `6³`, and `6.6.6` and returns `6^3`. Vertex configurations are cyclic, so alternate starting points and reflected readings canonicalize together. Parenthesized repetition is interpreted from Euclidean angle closure: `(3.6)^2` is the single vertex configuration `3.6.3.6`, while `(3^6)^2` denotes two complete `3^6` vertices. Reordered semicolon-separated vertex types and expanded duplicate vertices canonicalize to one stable identity. Bracketed ambiguity variants are retained.

GomJau-Hogg parsing follows the published seed grammar (`3`, `4`, `6`, `8`, or `12`), shape-placement phases, `0` side skips, and mirror/rotation transformations. Comparison ignores insignificant whitespace and case.

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

## Scope note

GomJau-Hogg as published is a construction notation for edge-to-edge regular-polygon tessellations. Some non-edge-to-edge periodic families require continuous geometric parameters such as offsets or ratios, so future support for those families may require parameterized identity in addition to a topological notation. The current API does not invent those parameters or treat C&R/GJ-H as carrying information they do not encode.

## Health

- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the current bounded analysis worker pool can accept work.
