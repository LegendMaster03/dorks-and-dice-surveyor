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

### Notation parsers

`src/resources/periodic-tiling/notation/` contains independent parsers for Cundy-Rollett and GomJau-Hogg notation.

The parsers validate notation structure and return canonical parsed representations. They do not ask whether Surveyor currently knows or implements the represented tiling. Therefore adding a new catalog entry or detector does not require editing the parser merely to accept that notation's structure.

Cundy-Rollett parsing handles polygon side counts and exponents, cyclic vertex configurations, semicolon-separated vertices, ambiguity/variant brackets, insignificant whitespace, braced exponents, Unicode superscripts, and redundant grouping. Cyclic rotations and reflected readings of one vertex configuration canonicalize to the same form. The overloaded parenthesized repetition is resolved using Euclidean vertex angle closure: `(3.6)^2` expands one local polygon sequence because `3.6.3.6` closes 360 degrees, while `(3^6)^2` represents two complete `3^6` vertices because `3^6` already closes 360 degrees. Repeated equivalent vertices are canonicalized to a vertex multiplicity. Published ambiguity variants use a superscript discriminator on the complete bracketed expression and canonicalize to `[... ]^N` without the insignificant space.

GomJau-Hogg parsing follows the published construction grammar: the seed phase is exactly one polygon with `3`, `4`, `6`, `8`, or `12` sides; later shape-placement phases are hyphen-separated and can contain comma-separated polygon placements or `0` side skips; and at least two mirror/rotation transformation stages follow, with optional angles and `c`, `v`, or `h` indexed origins. Centered transformations with an omitted angle canonicalize to the published 180-degree default. Eccentric transformations retain the omitted angle because the selected origin participates in determining the construction geometry. Parsed origin indices are bounded to safe integers.

### Tiling catalog

`src/resources/periodic-tiling/catalog.ts` maps canonical notation to known logical tiling identities. This is where equivalence between a Cundy-Rollett form and a GomJau-Hogg form is asserted.

Cundy-Rollett is intentionally indexed to a candidate set rather than a single definition because the notation is not unique for every tiling. GomJau-Hogg is indexed as a unique identity. If a future Cundy-Rollett entry maps to multiple registered definitions, C&R alone reports an ambiguous selector instead of silently choosing one; supplying GJ-H allows the catalog to intersect the candidates and resolve an exact identity.

Catalog definitions must store canonical C&R and GJ-H strings. Detector registration is also an all-or-none type invariant: a definition either has both a detector ID and its detector geometry or neither. This prevents discovery from advertising a partially wired implementation.

The first cataloged and implemented family is `Regular`:

- `regular.triangular`: `3^6` / `3/m30/r(h2)`;
- `regular.square`: `4^4` / `4/m45/r(h1)`;
- `regular.hexagonal`: `6^3` / `6/m30/r(h1)`.

All three identities register the `regular-lattice` detector with a geometry-specific profile. Catalog identity remains separate from detector implementation so future families can use different detector models without changing notation resolution.

### Request resolution

The public tiling identity boundary remains notation-only. A caller supplies `crNotation`, `gjhNotation`, or both. `periodicTilingType`, shape names, and polygon side counts are derived identity and are rejected as request selectors.

Resolution distinguishes:

- malformed or geometrically impossible Euclidean Cundy-Rollett notation -> `400 invalid_cr_notation`;
- malformed GomJau-Hogg notation -> `400 invalid_gjh_notation`;
- structurally valid but uncataloged identity -> `501 tiling_identity_unregistered`;
- registered but ambiguous Cundy-Rollett identity -> `400 tiling_selector_ambiguous`;
- registered but detectorless tiling -> `501 tiling_not_implemented`;
- two registered notations resolving to different tilings -> `400 tiling_selector_conflict`;
- registered and implemented tiling -> detector dispatch.

When both notation systems are supplied, Surveyor only claims equivalence when the catalog can prove that the GJ-H identity is a member of the C&R candidate set. It does not infer identity merely because both strings parse.

## Generalized Regular-lattice detector

`src/analysis/regular-tiling/detector.ts` is a small generalization around the existing proven hex detector rather than a replacement for it.

### Hexagonal `6^3`

`regular.hexagonal` delegates directly to the existing extracted `detectHexLattice` implementation. The existing three-family Hough/autocorrelation pipeline, continuous spacing refinement, phase fitting, canonical-spacing candidates, multi-region checking, and distant rigid-lattice residual logic remain unchanged. The generalized layer maps the legacy result into the common Regular fit.

This preserves the behavior that prevents a strong local near-period fit from incrementally pulling the final solution away from the one rigid lattice supported by the original raster across distant regions.

### Triangular `3^6`

A triangular grid exposes the same three edge-normal families separated by 60 degrees as the hexagonal grid. The triangular profile therefore reuses the proven three-family detector and converts between its natural hex-center spacing and triangular edge length. This avoids duplicating the most mature detector path.

### Square `4^4`

The square profile uses two perpendicular edge-normal families. It retains the same overall strategy:

1. build a broad Sobel edge field from the original raster;
2. search for a pair of perpendicular orientation families;
3. project each family and score shared periodicity through autocorrelation and harmonics;
4. estimate one common phase/origin;
5. validate the candidate against distant image regions;
6. report detected, inconclusive, or gridless conservatively.

Regression coverage explicitly checks clean detection, continuous non-integer spacing, resistance to a stronger local near-period distractor, and rejection of incompatible periods across distant halves. These tests preserve the global-fit behavior that motivated the original multi-instance correction work.

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
