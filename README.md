# Dorks & Dice Surveyor

Surveyor is a stateless collection of headless map-analysis and image-processing resources for Dorks & Dice tools.

> Surveyor observes input and returns analysis results. Consuming tools own accepted domain state.

Surveyor does not own maps, grids, campaigns, routes, terrain, locations, Battle Map scenes, Bastion state, or other consumer domain state.

## Resource model

The process hosts multiple independent headless resources behind one service boundary. Each resource owns its API routes, discovery metadata, domain-specific parsing and identity logic, and analysis dispatch. Shared HTTP/authentication, bounded image preparation, logging, configuration, and worker infrastructure remain service-level concerns.

The first resource is `periodic-tiling`, exposed through:

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

Future resources can be registered beside it without adding their domain logic to the root HTTP server.

## Euclidean periodic tilings

Periodic tilings are selected with standard notation rather than caller-supplied family, shape, or polygon-side discriminators.

- `crNotation` accepts Cundy-Rollett notation and is the preferred selector.
- `gjhNotation` accepts GomJau-Hogg notation as an equivalent first-class selector.

The notation parsers are independent from the detector catalog. They parse and canonicalize structurally valid notation even when Surveyor does not yet have a catalog identity or detector for that tiling. This separates three outcomes:

1. malformed notation: request error;
2. valid notation whose identity is not yet registered: recognized syntax, unavailable catalog identity;
3. registered tiling with no detector yet: known identity, detector not implemented.

The Regular Euclidean family is the first initialized tiling family. Its three canonical tilings are registered:

| Cundy-Rollett | GomJau-Hogg | Detector |
| --- | --- | --- |
| `3^6` | `3/m30/r(h2)` | not implemented |
| `4^4` | `4/m45/r(h1)` | not implemented |
| `6^3` | `6/m30/r(h1)` | implemented |

The existing extracted hexagonal-lattice code is registered as the `regular.hexagonal` detector. Square and triangular Regular detectors can be added behind the same resource without changing notation parsing or the public selector contract.

The service retains classification vocabulary for additional periodic-tiling families, including `semiregular`, `k-uniform`, `Plane-vertex`, `2-uniform`, `Fractalizing`, and `non-edge-to-edge`. `semiregular` also retains `Archimedean` and `uniform` classification vocabulary. These are derived values, not request selectors.

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
