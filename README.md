# Dorks & Dice Surveyor

Surveyor is the shared headless map-analysis and image-processing service for Dorks & Dice tools.

> Surveyor observes map imagery and returns analysis results. Consuming tools own accepted domain state.

Surveyor is intentionally stateless. It does not own maps, grids, campaigns, routes, terrain, locations, Battle Map scenes, Bastion state, or any other consumer domain state.

## Capability model

Surveyor is one service with separate APIs for separate computer-vision operations. Phase 13 implements only known periodic-tiling detection through the versioned `POST /v1/periodic-tiling/detect` API. Future operations such as recognizing an unknown tiling or performing unrelated computer vision belong on separate capability endpoints rather than being folded into this route.

Periodic tilings are selected with standard notation. The notation already carries the tiling identity, so callers do not separately provide `periodicTilingType`, shape names, or polygon side counts.

The preferred workflow uses Cundy-Rollett notation, for example `crNotation=6^3` for the regular hexagonal tiling. GomJau-Hogg (GJ-H) notation is also a first-class selector, for example `gjhNotation=6/m30/r(h1)`. Surveyor resolves either notation to the same known tiling, derives its periodic-tiling classification, and returns both normalized notations plus the derived `periodicTilingType` in the response.

Phase 13 implements only the Regular hexagonal tiling. Triangle and square Regular tilings are recognized by notation but intentionally return not implemented until detectors exist.

The service retains classification vocabulary for additional periodic-tiling families, including `semiregular`, `k-uniform`, `Plane-vertex`, `2-uniform`, `Fractalizing`, and `non-edge-to-edge`. `semiregular` also retains `Archimedean` and `uniform`. These are derived classification values rather than request selectors.

The service accepts PNG, JPEG, and WebP bytes, performs bounded decode/downsampling and grayscale conversion, executes the extracted Hex Crawl lattice detector in a bounded worker pool, and returns source-image pixel-space observations.

No arbitrary URL fetching, terrain recognition, road recognition, OCR, semantic feature classification, general tiling recognition, or machine-learning inference is implemented in Phase 13.

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
