# Surveyor architecture

Surveyor is a stateless host for independent headless analysis resources. It observes supplied input and returns analysis. A consuming tool validates and interprets that observation and remains authoritative for accepted domain state.

The dependency direction is consumer -> Surveyor. Surveyor has no dependency on Hex Crawl world, campaign, expedition, grid, or persistence types.

## Service and resource boundaries

`src/server.ts` is intentionally a thin service router. It owns only service-level health/discovery routes and dispatches requests to registered resources.

A resource implements the `SurveyorResource` boundary in `src/resources/resource.ts`:

- a stable resource identifier;
- one or more capability descriptors for service discovery;
- route matching;
- request handling for that resource.

Domain-specific parsing, catalogs, analysis orchestration, and dispatch belong inside the resource rather than the root server. Shared HTTP/authentication/error helpers live outside resources. Shared bounded image preparation and worker infrastructure can likewise be reused by multiple resources without coupling their domain models.

The current resource registry contains `periodic-tiling`. Additional headless resources should be added as siblings under `src/resources/` and registered by the server rather than expanding `server.ts` into a catch-all controller.

## Periodic-tiling resource

The periodic-tiling resource exposes `map.periodic-tiling.detect` at `POST /v1/periodic-tiling/detect`.

Its internal dependency direction is:

`HTTP selector -> notation parser -> tiling catalog -> detector registration -> detector implementation`

These layers have deliberately different responsibilities.

### Notation parsers

`src/resources/periodic-tiling/notation/` contains independent parsers for Cundy-Rollett and GomJau-Hogg notation.

The parsers validate notation structure and return canonical parsed representations. They do not ask whether Surveyor currently knows or implements the represented tiling. Therefore adding a new catalog entry or detector does not require editing the parser merely to accept that notation's structure.

Cundy-Rollett parsing handles polygon side counts and exponents, cyclic vertex configurations, semicolon-separated vertices, ambiguity/variant brackets, insignificant whitespace, braced exponents, and Unicode superscripts. Cyclic rotations and reflected readings of one vertex configuration canonicalize to the same form. The overloaded parenthesized repetition is resolved using Euclidean vertex angle closure: `(3.6)^2` expands one local polygon sequence because `3.6.3.6` closes 360 degrees, while `(3^6)^2` represents two complete `3^6` vertices because `3^6` already closes 360 degrees. Repeated equivalent vertices are canonicalized to a vertex multiplicity.

GomJau-Hogg parsing follows the published construction grammar: the seed phase is exactly one polygon with `3`, `4`, `6`, `8`, or `12` sides; later shape-placement phases are hyphen-separated and can contain comma-separated polygon placements or `0` side skips; and at least two mirror/rotation transformation stages follow, with optional angles and `c`, `v`, or `h` indexed origins.

### Tiling catalog

`src/resources/periodic-tiling/catalog.ts` maps canonical notation to known logical tiling identities. This is where equivalence between a Cundy-Rollett form and a GomJau-Hogg form is asserted.

The first cataloged family is `Regular`:

- `regular.triangular`: `3^6` / `3/m30/r(h2)`;
- `regular.square`: `4^4` / `4/m45/r(h1)`;
- `regular.hexagonal`: `6^3` / `6/m30/r(h1)`.

Catalog membership and detector availability are separate. The first detector registration is `regular.hexagonal`, which points to the existing extracted hex-lattice analysis path. The triangular and square identities are cataloged but intentionally have no detector registration yet.

### Request resolution

The public tiling identity boundary remains notation-only. A caller supplies `crNotation`, `gjhNotation`, or both. `periodicTilingType`, shape names, and polygon side counts are derived identity and are rejected as request selectors.

Resolution distinguishes:

- malformed or geometrically impossible Euclidean Cundy-Rollett notation -> `400 invalid_cr_notation`;
- malformed GomJau-Hogg notation -> `400 invalid_gjh_notation`;
- syntactically valid but uncataloged identity -> `501 tiling_identity_unregistered`;
- registered but detectorless tiling -> `501 tiling_not_implemented`;
- two registered notations resolving to different identities -> `400 tiling_selector_conflict`;
- registered and implemented tiling -> detector dispatch.

When both notation systems are supplied, Surveyor only claims equivalence when the catalog can prove that they resolve to the same tiling. It does not infer identity merely because both strings parse.

## Current Regular hexagonal detector

The existing `Regular` `6^3` / `6/m30/r(h1)` detector performs:

1. bounded PNG/JPEG/WebP decode;
2. bounded-resolution raster preparation;
3. browser-parity grayscale conversion using `0.2126 R + 0.7152 G + 0.0722 B`;
4. the extracted deterministic hex-lattice detector;
5. normalization of spacing, anchor, and residual back into source-image pixels.

The public contract is now named for periodic tilings rather than hex grids. Transitional TypeScript aliases retain source compatibility for the extracted hex implementation while future detector-specific fit contracts are designed.

## Future detector geometry

The current response `fit` is still the hex-lattice fit because hexagonal Regular tiling is the only implemented detector. A square or triangular detector should not overload `PointyTop`/`FlatTop` or other hex-specific semantics. Before those detectors are added, the periodic-tiling fit contract should become a geometry-neutral common envelope or a discriminated union of detector-specific fits.

That contract change is deliberately separate from this resource/parser cleanup.

## Notation scope beyond edge-to-edge tilings

The published GomJau-Hogg system is a construction notation for edge-to-edge regular-polygon tessellations, including the regular, uniform, and k-uniform families it documents. It should not be treated as proof that every eventual Surveyor periodic-tiling family can be uniquely parameterized by GJ-H alone. In particular, non-edge-to-edge isogonal families can contain continuous geometric parameters such as offsets or edge-length ratios. Future support for those families should preserve the resource/catalog boundary and introduce explicit parameterized identity rather than overloading the parser or pretending the notation contains information it does not encode.

## Concurrency

CPU-heavy lattice detection runs in a fixed worker-thread pool. Worker count and queued work are bounded. A full queue produces explicit overload rather than spawning unbounded workers. Cancellation or timeout terminates the affected worker and replaces it, preventing abandoned CPU-heavy analysis from continuing indefinitely.

The present worker contract is hex-detector-specific because only `regular.hexagonal` is registered. As additional CPU-heavy resources or tiling detectors are implemented, worker dispatch can be generalized behind the resource boundary without changing public routing.

## Security boundary

Analysis routes accept encoded raster bytes only. Surveyor has no URL-fetching capability. Analysis requires an internal bearer token. Health endpoints are intentionally unauthenticated for service monitoring. Upload bytes, decoded pixels, dimensions, options, worker count, queue depth, and analysis duration are bounded by configuration.
