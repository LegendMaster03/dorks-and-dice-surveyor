# Dorks & Dice Surveyor

Surveyor is a stateless collection of headless map-analysis and image-processing resources for Dorks & Dice tools.

> Surveyor observes input and returns analysis results. Consuming tools own accepted domain state.

Surveyor does not own maps, grids, campaigns, routes, terrain, locations, Battle Map scenes, Bastion state, or other consumer domain state.

## Resource model

The process hosts multiple independent headless resources behind one service boundary. Each resource owns its API routes, discovery metadata, domain-specific parsing and identity logic, and analysis dispatch. Shared HTTP/authentication, bounded image preparation, logging, configuration, raster transport types, and worker infrastructure remain service-level concerns.

The first resource is `periodic-tiling`, exposed through:

`POST /v2/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

Future resources can be registered beside it without adding their domain logic to the root HTTP server.

## Euclidean periodic tilings

Standard two-dimensional Delaney-Dress numerical symbols are Surveyor's sole tiling notation.
The POST /v2/periodic-tiling/detect endpoint accepts an image and an optional
expectedDsSymbol hint. The hint affects detector evaluation order, never the observed result.
Without a hint Surveyor evaluates all currently supported periodic tiling models.

The symbol parser validates the chamber structure, orbit data and Euclidean curvature;
valid symbols do not require a catalog registration. The detector catalog currently
recognizes three profiles:

| D-symbol | Detector geometry |
| --- | --- |
| `<1:1,1,1:3,6>` | triangular |
| `<1:1,1,1:4,4>` | square |
| `<1:1,1,1:6,3>` | hexagonal |

When an image supports a unique model, Surveyor returns its canonical tiling.dsSymbol
along with the measured fit. For inconclusive or gridless images, tiling is null and
no fitted identity is asserted. A future detector can be registered independently
of the D-symbol parser.

Surveyor continues using the existing two-family square and three-family
triangular/hexagonal image-fitting algorithms. The shared geometric fit exposes
rotation, edge length, pixel anchor, confidence and residual measurements.
Hexagonal fits additionally include orientation and center spacing.

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
