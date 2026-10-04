# Surveyor architecture

Surveyor is a stateless internal computation service. It observes map imagery and returns pixel-space analysis. A consuming tool validates and interprets the observation and remains authoritative for accepted domain state.

The dependency direction is consumer -> Surveyor. Surveyor has no dependency on Hex Crawl world, campaign, expedition, grid, or persistence types.

## Periodic-tiling capability model

Surveyor exposes the generic capability `map.periodic-tiling.detect` rather than a hex-specific service API.

A request first declares `periodicTilingType`. That value selects the parser, required number of ordered shape arguments, and detector family. Phase 13 implements only `Regular`, whose contract requires exactly one shape argument. The argument may be a canonical shape name or a numeric side-count shorthand that resolves to a configured default shape.

Shape side count is not identity. Multiple named shapes may share a side count. The side-count map exists only to choose a default when the caller uses numeric shorthand.

Responses return `tiling.shapes` as an ordered array even for `Regular`, where the array has exactly one entry. This keeps the response shape compatible with future periodic-tiling families that may require multiple ordered shapes.

Known but currently unimplemented periodic-tiling families include `semiregular` and `k-uniform`. Adding them should register a new family-specific parser and detector behind the existing endpoint rather than changing the Regular contract or the Hex Crawl integration.

## Phase 13 implementation

The current `Regular` hex detector performs:

1. bounded PNG/JPEG/WebP decode;
2. bounded-resolution raster preparation;
3. browser-parity grayscale conversion using `0.2126 R + 0.7152 G + 0.0722 B`;
4. the extracted deterministic hex-lattice detector;
5. normalization of spacing, anchor, and residual back into source-image pixels.

Hex Crawl explicitly requests `periodicTilingType=Regular` with one hex shape argument and validates that same resolved tiling identity in the response. Hex Crawl continues to own physical scale, Wonderdraft reconciliation, registration proposals, preview, confirmation, grid identity, optimistic concurrency, expedition safety, and persistence.

## Concurrency

CPU-heavy lattice detection runs in a fixed worker-thread pool. Worker count and queued work are bounded. A full queue produces explicit overload rather than spawning unbounded workers. Cancellation or timeout terminates the affected worker and replaces it, preventing abandoned CPU-heavy analysis from continuing indefinitely.

## Security boundary

The analysis route accepts encoded raster bytes only. It has no URL-fetching capability. It requires an internal bearer token. Health endpoints are intentionally unauthenticated for service monitoring. Upload bytes, decoded pixels, dimensions, options, worker count, queue depth, and analysis duration are bounded by configuration.
