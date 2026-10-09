# Surveyor architecture

Surveyor is a stateless host for independent headless analysis resources. It observes supplied input and returns analysis. A consuming tool validates and interprets that observation and remains authoritative for accepted domain state.

The dependency direction is consumer -> Surveyor. Surveyor has no dependency on Hex Crawl world, campaign, expedition, grid, or persistence types.

## Service, composition, and resource boundaries

`src/main.ts` is the composition root. It constructs resource-specific dependencies, registers the headless resources hosted by this deployment, and hands only generic resource/readiness interfaces to the HTTP server.

`src/server.ts` is intentionally a domain-neutral service router. It owns only service-level health/discovery routes and dispatches requests to the supplied resource registry. It does not import the periodic-tiling resource or detector-specific contracts. Registration rejects duplicate resource IDs, capability IDs, and capability paths so discovery metadata and routing can not silently diverge.

A resource implements the `SurveyorResource` boundary in `src/resources/resource.ts`:

- a stable resource identifier;
- one or more capability descriptors for service discovery;
- route matching;
- request handling for that resource.

Domain-specific parsing, catalogs, analysis orchestration, and dispatch belong inside the resource rather than the root server. Shared HTTP/authentication/error helpers live outside resources. Shared bounded image preparation and worker infrastructure can likewise be reused by multiple resources without coupling their domain models.

`src/image/raster.ts` owns the neutral grayscale raster transport shape used by shared image preparation and worker payloads. Shared image infrastructure therefore does not depend on the extracted hex detector merely to name its raster data.

The generic bounded worker pool imports only a service-level worker-envelope contract from `src/infrastructure/worker-contract.ts`. Detector-specific worker payloads remain owned by their detector/resource. Worker request option types explicitly omit callback hooks such as `timingSink`; callbacks are created inside the worker because functions are not structured-cloneable worker-thread payloads.

The current composition root registers `periodic-tiling`. Additional headless resources should be added as siblings under `src/resources/` and registered in the composition root rather than expanding `server.ts` into a catch-all controller.

## Periodic-tiling resource

The periodic-tiling resource exposes `map.periodic-tiling.detect` at `POST /v1/periodic-tiling/detect`.

Its internal dependency direction is:

`HTTP selector -> notation parser -> tiling catalog -> detector registration -> detector geometry -> detector implementation`

These layers have deliberately different responsibilities.

### Delaney-Dress identity

Standard two-dimensional Delaney-Dress numerical strings are the sole tiling notation.
The parser validates chamber involutions, 0/2 commutativity, orbit data,
Euclidean curvature, and canonicalizes chamber relabeling. The parser is not
dependent on the catalog and can recognize structurally valid unregistered symbols.

The catalog registers only implemented detectors: triangular (<1:1,1,1:3,6>),
square (<1:1,1,1:4,4>) and hexagonal (<1:1,1,1:6,3>).

### Image-driven detection

The expectedDsSymbol parameter is optional. Surveyor evaluates every supported
candidate against the original prepared raster, using the hint only to prioritize
execution. It reports the observed tiling as tiling.dsSymbol only when a candidate
wins unambiguously; otherwise tiling is null. Different detector confidence values
are not treated as calibrated probabilities. Candidate results are compared using
confidence, support, normalized residual and an ambiguity threshold. Further
calibration is required as detector families expand.

## Generalized Regular-lattice detector

The Regular detector is deliberately layered so the proven lattice-fitting behavior stays separate from profile verification:

- `src/analysis/regular-tiling/detector-core.ts` contains the generalized lattice-fitting core and the unchanged adapter around the original hex detector;
- `src/analysis/regular-tiling/detector.ts` is the public boundary. It rejects unknown runtime geometry IDs and performs geometry-specific verification after a candidate lattice has been detected.

This keeps hypothesis generation and global refinement stable while allowing the selected tiling profile to reject a geometrically plausible but topologically wrong result.

### Hexagonal `6^3`

The core `regular.hexagonal` path delegates to the existing extracted `detectHexLattice` implementation. The existing three-family Hough/autocorrelation pipeline, continuous spacing refinement, phase fitting, canonical-spacing candidates, multi-region checking, and distant rigid-lattice residual logic remain unchanged. The generalized layer maps the legacy result into the common Regular fit.

This preserves the behavior that prevents a strong local near-period fit from incrementally pulling the final solution away from the one rigid lattice supported by the original raster across distant regions.

A three-family period is not by itself sufficient to distinguish a hexagonal honeycomb from a triangular tiling. Both expose three edge-normal families separated by 60 degrees. After the lattice fit succeeds, the public detector therefore verifies edge occupancy against the original raster: honeycomb edges must be present on the expected finite edge segments and should fall away along the collinear continuation beyond each hex edge. Strong continuous carrier evidence downgrades the requested hexagonal result to `inconclusive` instead of misclassifying a triangular grid as `6^3`.

### Triangular `3^6`

A triangular grid exposes the same three edge-normal families separated by 60 degrees as the hexagonal grid. The triangular profile therefore reuses the proven three-family detector and converts between its natural hex-center spacing and triangular edge length. This avoids duplicating the most mature detector path.

The same occupancy verification is applied in the opposite direction. Triangular edges continue through vertices along their carrier lines, so a strongly segmented honeycomb pattern is not accepted merely because its directions and period also satisfy the three-family model. The verification is intentionally based on the unchanged source raster and oriented edge evidence rather than a repeatedly corrected intermediate image.

### Square `4^4`

The square profile uses two perpendicular edge-normal families. It retains the same overall strategy:

1. build a broad Sobel edge field from the original raster;
2. search for a pair of perpendicular orientation families;
3. project each family and score shared periodicity through autocorrelation and harmonics;
4. estimate one common phase/origin;
5. validate the candidate against distant image regions;
6. report detected, inconclusive, or gridless conservatively.

Square period search is bounded for predictable CPU use, but the lag ceiling is not also divided in half when choosing candidate spacing. Higher harmonics contribute only when they actually lie inside the sampled autocorrelation range. This keeps large valid grid periods eligible instead of silently excluding them or penalizing them because an unavailable harmonic was treated as zero evidence.

Regression coverage explicitly checks clean detection, hard-raster orientation, continuous non-integer spacing, a large `190 px` period, resistance to a stronger local near-period distractor, and rejection of incompatible periods across distant halves. These tests preserve the global-fit behavior that motivated the original multi-instance correction work.

The square implementation does not port the calibration-grid paper's projective two-pencil algorithm wholesale. Surveyor is fitting a rigid Euclidean raster lattice, so it uses the existing periodic-raster assumptions while preserving the paper's useful global line-family principle.

### Fit contract

`RegularLatticeFit` exposes common fields:

- `geometryId`;
- `rotationDegrees`;
- `edgeLengthPixels`;
- `anchorPixel`;
- confidence, residual, support, translation, periodicity, and phase metrics.

The common shape does not imply identical geometric semantics for every field. `rotationDegrees` is interpreted within the selected geometry profile's symmetry period, and `anchorPixel` is that profile's phase reference rather than a guaranteed universal polygon centroid. Consumers use `geometryId` when interpreting those values.

Hexagonal results additionally retain `orientation` (`PointyTop` or `FlatTop`) and `centerSpacingPixels` for compatibility with the original detector and existing consumers. The transitional `SurveyorHexGridAnalysis` type preserves the previous exact hex identity and `HexLatticeFit` shape rather than widening old source code to the generalized fit.

`minimumSpacingPixels` and `maximumSpacingPixels` remain compatible with the pre-generalization API. For square and triangular profiles they represent polygon edge length. For the hexagonal profile they retain the existing center-spacing interpretation; changing that legacy meaning would be a separate API-versioning decision.

Analysis may run on a bounded downsampled raster. Fit distances, anchors, residuals, and any pixel measurements embedded in detector reason text are mapped back to source-image coordinates before they cross the API boundary.

## Global-fit constraint and future motifs

Refinement must remain grounded in the original prepared raster and edge evidence. Surveyor should compare alternative complete hypotheses against that unchanged evidence rather than repeatedly correcting an already-corrected synthetic result. The current hex detector's multi-region and distant-residual checks are retained specifically because repeated local corrections can otherwise accumulate visible drift.

For the three Regular tilings, each edge family has one uniform spacing. More complex periodic tilings may contain multiple polygon types, alternating offsets, or a larger asymmetric repeating motif. The likely extension is therefore not a detector per tiling, but a generalized periodic motif with:

- a translation basis;
- one or more edge orientations;
- potentially multiple offsets within each periodic edge family;
- motif edge geometry used for global verification.

That future work should preserve the same rule: all motif components act as simultaneous evidence for one common lattice rather than being aligned sequentially.

## Notation scope beyond edge-to-edge tilings

The published GomJau-Hogg system is a construction notation for edge-to-edge regular-polygon tessellations, including the regular, uniform, and k-uniform families it documents. It should not be treated as proof that every eventual Surveyor periodic-tiling family can be uniquely parameterized by GJ-H alone. In particular, non-edge-to-edge isogonal families can contain continuous geometric parameters such as offsets or edge-length ratios. Future support for those families should preserve the resource/catalog boundary and introduce explicit parameterized identity rather than overloading the parser or pretending the notation contains information it does not encode.

## Concurrency

CPU-heavy lattice detection runs in a fixed worker-thread pool. Worker count and queued work are bounded. A full queue produces explicit overload rather than spawning unbounded workers. Cancellation or timeout terminates the affected worker and replaces it, preventing abandoned CPU-heavy analysis from continuing indefinitely.

The current periodic-tiling resource uses one worker contract carrying the selected Regular geometry profile. The worker validates that geometry at runtime instead of falling through to another profile if a malformed internal payload bypasses TypeScript. Future CPU-heavy resources can own separate pools or share a generalized worker dispatcher without changing the HTTP server contract.

## Security boundary

Analysis routes accept encoded raster bytes only. Surveyor has no URL-fetching capability. Analysis requires an internal bearer token. Health endpoints are intentionally unauthenticated for service monitoring. Upload bytes, decoded pixels, dimensions, options, worker count, queue depth, and analysis duration are bounded by configuration.
