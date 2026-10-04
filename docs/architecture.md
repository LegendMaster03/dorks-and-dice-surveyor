# Surveyor architecture

Surveyor is a stateless internal computation service. It observes map imagery and returns pixel-space analysis. A consuming tool validates and interprets the observation and remains authoritative for accepted domain state.

The dependency direction is consumer -> Surveyor. Surveyor has no dependency on Hex Crawl world, campaign, expedition, grid, or persistence types.

## Capability boundaries

Surveyor is one service with separate capability endpoints for separate computer-vision operations. Phase 13 exposes only `map.periodic-tiling.detect` at `POST /v1/periodic-tiling/detect`.

Known-tiling detection, unknown-tiling recognition, generic line/feature analysis, terrain analysis, OCR, and other future computer-vision operations are distinct capabilities. They should not be multiplexed behind a single catch-all analysis route merely because they share image-processing infrastructure.

## Periodic-tiling capability model

Standard notation is the public tiling identity boundary. The notation already identifies the periodic tiling, so the caller does not separately provide `periodicTilingType`, shape names, or polygon side counts.

- `crNotation` is Cundy-Rollett notation and is the preferred selector;
- `gjhNotation` is GomJau-Hogg notation and is an equivalent first-class selector.

At least one notation is required. Both may be supplied only when they resolve to the same tiling. Surveyor derives `periodicTilingType` from the resolved tiling and returns the normalized C&R notation, GJ-H notation, and derived type together. If a notation is ambiguous among known tilings, Surveyor should report that ambiguity or require the more specific notation rather than reintroducing a caller-supplied family discriminator.

Known but currently unimplemented periodic-tiling classifications include `semiregular`, `k-uniform`, `Plane-vertex`, `2-uniform`, `Fractalizing`, and `non-edge-to-edge`. `semiregular` retains the classification vocabulary `Archimedean` and `uniform`. Adding detectors for these families should extend the notation registry and dispatch behind the periodic-tiling detection capability without changing the Hex Crawl integration contract.

## Phase 13 implementation

The current `Regular` `6^3` / `6/m30/r(h1)` detector performs:

1. bounded PNG/JPEG/WebP decode;
2. bounded-resolution raster preparation;
3. browser-parity grayscale conversion using `0.2126 R + 0.7152 G + 0.0722 B`;
4. the extracted deterministic hex-lattice detector;
5. normalization of spacing, anchor, and residual back into source-image pixels.

Hex Crawl requests `crNotation=6^3` and validates the returned derived `Regular` / `6^3` / `6/m30/r(h1)` identity before accepting the observation. Hex Crawl continues to own physical scale, Wonderdraft reconciliation, registration proposals, preview, confirmation, grid identity, optimistic concurrency, expedition safety, and persistence.

## Concurrency

CPU-heavy lattice detection runs in a fixed worker-thread pool. Worker count and queued work are bounded. A full queue produces explicit overload rather than spawning unbounded workers. Cancellation or timeout terminates the affected worker and replaces it, preventing abandoned CPU-heavy analysis from continuing indefinitely.

## Security boundary

The analysis route accepts encoded raster bytes only. It has no URL-fetching capability. It requires an internal bearer token. Health endpoints are intentionally unauthenticated for service monitoring. Upload bytes, decoded pixels, dimensions, options, worker count, queue depth, and analysis duration are bounded by configuration.
