# Surveyor API v1

## Resource discovery

Surveyor hosts multiple headless resources behind one service. `GET /` returns the API version, registered resource identifiers, and capability descriptors. Each capability keeps its own route and request contract rather than being multiplexed through a generic analysis endpoint.

The first registered resource is `periodic-tiling`.

## Periodic-tiling detection

POST /v1/periodic-tiling/detect
Capability: map.periodic-tiling.detect

The image, not the caller, determines the returned tiling identity.
The single optional selector is expectedDsSymbol, a standard Euclidean
Delaney-Dress symbol. This hint changes processing priority, never the answer.
Missing hint is valid and enables unsupervised classification among supported
detectors. C&R/GJ-H selectors are rejected rather than silently accepted.

Recognized detector geometries:

| D-symbol | Internal geometry |
|---|---|
| <1:1,1,1:3,6> | regular.triangular |
| <1:1,1,1:4,4> | regular.square |
| <1:1,1,1:6,3> | regular.hexagonal |

The response returns status, reason, and tiling: {dsSymbol} for a positive,
unambiguous identification; tiling: null for inconclusive/gridless.
The fit is present only for detected results. Valid but unregistered Euclidean
symbols may be used as hints without preventing automatic detection.

### Regular fit

When a fit is available, the common fields include:

- `geometryId` — `regular.triangular`, `regular.square`, or `regular.hexagonal`;
- `rotationDegrees` — orientation within that geometry profile's symmetry period;
- `edgeLengthPixels`;
- `anchorPixel` — the fitted phase reference for that geometry profile;
- `confidence`;
- `residualPixels`;
- `supportCoverage`;
- `orientationSupport`;
- `translationScore`;
- `competingTranslationScore`;
- `linePeriodicityScore`;
- `phaseScore`.

`rotationDegrees` and `anchorPixel` are common transport fields, but their geometric interpretation is profile-specific. Callers should use `geometryId` when interpreting them rather than assuming one universal polygon-center convention.

Hexagonal fits additionally expose the legacy `orientation` (`PointyTop` or `FlatTop`) and `centerSpacingPixels` fields so existing consumers can migrate without losing the original detector semantics.

Fit distances, anchors, and pixel measurements included in detector reason text are mapped back into original source-image pixel coordinates before they are returned.

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

