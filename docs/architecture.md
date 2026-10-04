# Surveyor architecture

Surveyor is a stateless internal computation service. It observes map imagery and returns pixel-space analysis. A consuming tool validates and interprets the observation and remains authoritative for accepted domain state.

The dependency direction is consumer -> Surveyor. Surveyor has no dependency on Hex Crawl world, campaign, expedition, grid, or persistence types.

## Phase 13 capability

`map.hex-grid.detect` performs:

1. bounded PNG/JPEG/WebP decode;
2. bounded-resolution raster preparation;
3. browser-parity grayscale conversion using `0.2126 R + 0.7152 G + 0.0722 B`;
4. the extracted deterministic hex-lattice detector;
5. normalization of spacing, anchor, and residual back into source-image pixels.

Hex Crawl continues to own physical scale, Wonderdraft reconciliation, registration proposals, preview, confirmation, grid identity, optimistic concurrency, expedition safety, and persistence.

## Concurrency

CPU-heavy lattice detection runs in a fixed worker-thread pool. Worker count and queued work are bounded. A full queue produces explicit overload rather than spawning unbounded workers. Cancellation or timeout terminates the affected worker and replaces it, preventing abandoned CPU-heavy analysis from continuing indefinitely.

## Security boundary

The analysis route accepts encoded raster bytes only. It has no URL-fetching capability. It requires an internal bearer token. Health endpoints are intentionally unauthenticated for service monitoring. Upload bytes, decoded pixels, dimensions, options, worker count, queue depth, and analysis duration are bounded by configuration.
