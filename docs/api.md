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

At least one notation selector is required. Both may be supplied when Surveyor can resolve GJ-H to a member of the C&R candidate set. GJ-H is therefore also the disambiguator when a registered C&R identity is non-unique.

### Parser and catalog behavior

Notation parsing is independent from the registered-tiling catalog and detector implementations. This produces distinct API outcomes:

| Condition | Status | Error code |
| --- | ---: | --- |
| malformed or non-Euclidean Cundy-Rollett vertex syntax | 400 | `invalid_cr_notation` |
| malformed GomJau-Hogg syntax | 400 | `invalid_gjh_notation` |
| valid notation with no registered identity | 501 | `tiling_identity_unregistered` |
| registered non-unique C&R identity without a disambiguator | 400 | `tiling_selector_ambiguous` |
| registered identity with no detector | 501 | `tiling_not_implemented` |
| two registered selectors identify different tilings | 400 | `tiling_selector_conflict` |

A structurally valid unknown tiling is therefore not mislabeled as a missing detector, and the parser does not use a detector-specific allowlist. The tests use the published uniform `12-3/m30/r(h3)` as a valid GJ-H notation that is intentionally not yet in Surveyor's Regular-only catalog.

Cundy-Rollett canonicalization accepts forms such as `6^3`, `6^{3}`, `6³`, and `6.6.6` and returns `6^3`. Vertex configurations are cyclic, so alternate starting points and reflected readings canonicalize together. Redundant grouping such as `(3^6)` does not change identity. Parenthesized repetition is interpreted from Euclidean angle closure: `(3.6)^2` is the single vertex configuration `3.6.3.6`, while `(3^6)^2` denotes two complete `3^6` vertices. Reordered semicolon-separated vertex types and expanded duplicate vertices canonicalize to one stable identity. Bracketed ambiguity variants are retained.

GomJau-Hogg parsing follows the published seed grammar (`3`, `4`, `6`, `8`, or `12`), shape-placement phases, `0` side skips, and mirror/rotation transformations. Comparison ignores insignificant whitespace and case.

### Regular tilings

The Regular family is the first implemented periodic-tiling family:

| Cundy-Rollett | GomJau-Hogg | Derived type | Detector geometry |
| --- | --- | --- | --- |
| `3^6` | `3/m30/r(h2)` | `Regular` | triangular |
| `4^4` | `4/m45/r(h1)` | `Regular` | square |
| `6^3` | `6/m30/r(h1)` | `Regular` | hexagonal |

All three use the `regular-lattice` detector registration. Either notation may select the tiling, for example:

- `crNotation=3^6` or `gjhNotation=3/m30/r(h2)`;
- `crNotation=4^4` or `gjhNotation=4/m45/r(h1)`;
- `crNotation=6^3` or `gjhNotation=6/m30/r(h1)`.

The response returns canonical notation identity plus the derived periodic-tiling classification:

```json
{
  "capability": "map.periodic-tiling.detect",
  "tiling": {
    "periodicTilingType": "Regular",
    "crNotation": "4^4",
    "gjhNotation": "4/m45/r(h1)"
  }
}
```

The full response also reports source dimensions/media type, bounded analysis dimensions/scale, whether analysis ran at source resolution, classification (`detected`, `inconclusive`, or `gridless`), detector fit, and timing.

### Regular fit

When a fit is available, the geometry-neutral fields include:

- `geometryId` — `regular.triangular`, `regular.square`, or `regular.hexagonal`;
- `rotationDegrees`;
- `edgeLengthPixels`;
- `anchorPixel`;
- `confidence`;
- `residualPixels`;
- `supportCoverage`;
- `orientationSupport`;
- `translationScore`;
- `competingTranslationScore`;
- `linePeriodicityScore`;
- `phaseScore`.

Hexagonal fits additionally expose the legacy `orientation` (`PointyTop` or `FlatTop`) and `centerSpacingPixels` fields so existing consumers can migrate without losing the original detector semantics.

Fit distances and anchors are mapped back into original source-image pixel coordinates before they are returned.

### Detector options

Optional parameters:

- `minimumSpacingPixels`
- `maximumSpacingPixels`
- `maximumEdgeSamples`
- `minimumConfidence`

These are detector options, not tiling identity selectors.

For square and triangular Regular profiles, the spacing bounds describe polygon edge length. For hexagonal `6^3`, they retain the pre-existing center-to-center spacing meaning for compatibility with the original hex API. A future API version may normalize that legacy input convention; v1 does not silently change it.

## Classification vocabulary

Derived periodic-tiling classification vocabulary currently includes `Regular`, `semiregular`, `k-uniform`, `Plane-vertex`, `2-uniform`, `Fractalizing`, and `non-edge-to-edge`. `semiregular` also retains `Archimedean` and `uniform` classification vocabulary. These values are not request selectors.

## Scope note

The current detector implements the three Regular tilings, whose edge families have uniform spacing. More complex periodic tilings can require multiple offsets or a larger repeating motif even though the overall tiling remains periodic. Future detector expansion should model those repeated motifs as simultaneous evidence for one global lattice rather than aligning component shapes sequentially.

GomJau-Hogg as published is a construction notation for edge-to-edge regular-polygon tessellations. Some non-edge-to-edge periodic families require continuous geometric parameters such as offsets or ratios, so future support for those families may require parameterized identity in addition to a topological notation. The current API does not invent those parameters or treat C&R/GJ-H as carrying information they do not encode.

## Health

- `GET /health/live` verifies only that the process can answer HTTP.
- `GET /health/ready` reports whether the current bounded analysis worker pool can accept work.
