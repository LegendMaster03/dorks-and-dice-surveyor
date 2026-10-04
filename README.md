# Dorks & Dice Surveyor

Surveyor is the shared headless map-analysis and image-processing service for Dorks & Dice tools.

> Surveyor observes map imagery and returns analysis results. Consuming tools own accepted domain state.

Surveyor is intentionally stateless. It does not own maps, grids, campaigns, routes, terrain, locations, Battle Map scenes, Bastion state, or any other consumer domain state.

## Current capability

Phase 13 provides `map.hex-grid.detect` through the versioned `POST /v1/hex-grid/detect` API. The service accepts PNG, JPEG, and WebP bytes, performs bounded decode/downsampling and grayscale conversion, executes the extracted Hex Crawl lattice detector in a bounded worker pool, and returns source-image pixel-space observations.

No arbitrary URL fetching, terrain recognition, road recognition, OCR, semantic feature classification, or machine-learning inference is implemented.

## Local development

Requirements: Node.js 24+ and npm.

```sh
npm ci
npm test
```

Run the service:

```sh
SURVEYOR_SERVICE_TOKEN='replace-with-a-long-internal-token' npm start
```

## Configuration

- `PORT` (default `8080`)
- `SURVEYOR_SERVICE_TOKEN` (required, at least 16 characters)
- `SURVEYOR_MAX_UPLOAD_BYTES` (default 32 MiB)
- `SURVEYOR_MAX_PIXELS` (default 100,000,000)
- `SURVEYOR_WORKER_COUNT` (default is bounded from available CPU parallelism)
- `SURVEYOR_QUEUE_LIMIT` (default `2 × worker count`)
- `SURVEYOR_ANALYSIS_TIMEOUT` in milliseconds (default 30,000)
- `SURVEYOR_ANALYSIS_MAX_DIMENSION` (default 2048)

Analysis routes require the service bearer token. Health routes are unauthenticated for internal monitoring. Tokens and image bytes are never logged.

## Docker

```sh
docker build -t dorks-and-dice-surveyor .
docker run --rm -p 8080:8080 -e SURVEYOR_SERVICE_TOKEN='replace-with-a-long-internal-token' dorks-and-dice-surveyor
```

The production container runs as the unprivileged `node` user and exposes lightweight liveness/readiness endpoints.

## API and architecture

See `docs/api.md` and `docs/architecture.md`.
