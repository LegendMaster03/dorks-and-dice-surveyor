# Dorks & Dice Surveyor

Surveyor is a stateless collection of headless map-analysis and image-processing resources for Dorks & Dice tools.

> Surveyor observes input and returns analysis results. Consuming tools own accepted domain state.

Surveyor does not own maps, grids, campaigns, routes, terrain, locations, Battle Map scenes, Bastion state, or other consumer domain state.

## Resource model

The process hosts multiple independent headless resources behind one service boundary. Each resource owns its API routes, discovery metadata, domain-specific parsing and identity logic, and analysis dispatch. Shared HTTP/authentication, bounded image preparation, logging, configuration, raster transport types, and worker infrastructure remain service-level concerns.

The first resource is `periodic-tiling`, exposed through:

`POST /v1/periodic-tiling/detect`

Capability: `map.periodic-tiling.detect`

Future resources can be registered beside it without adding their domain logic to the root HTTP server.

## Euclidean periodic tilings

Periodic tilings are identified using standard Delaney-Dress symbols only.
The optional expectedDsSymbol hint prioritizes image-analysis candidates but
does not constrain the observed tiling returned as tiling.dsSymbol.
When absent, Surveyor evaluates its supported candidate families automatically.
The parser validates and canonicalizes symbols independently of detector registration.

- `expectedDsSymbol` accepts Cundy-Rollett notation and is the preferred selector.
- `expectedDsSymbol` accepts GomJau-Hogg notation as an equivalent first-class selector.

The notation parsers are independent from the detector catalog. They parse and canonicalize structurally valid notation even when Surveyor does not yet have a catalog identity or detector for that tiling. This separates malformed notation, valid but uncataloged identity, and cataloged detector support.

The Regular Euclidean family is the first implemented tiling family. All three Regular tilings use the generalized `regular-lattice` detector:

| Cundy-Rollett | GomJau-Hogg | Geometry |
| --- | --- | --- |
| `3^6` | `3/m30/r(h2)` | triangular |
| `4^4` | `4/m45/r(h1)` | square |
| `6^3` | `6/m30/r(h1)` | hexagonal |

The existing extracted hexagonal detector remains the proven three-family implementation and is not rewritten. The generalized detector delegates `6^3` to it directly. `3^6` uses the same three 60-degree line-family analysis with triangular spacing/output semantics. `4^4` uses a two-family perpendicular profile with the same global gradient, periodicity, phase, and distant-region consistency principles.

The detector returns a common Regular fit with `geometryId`, `rotationDegrees`, `edgeLengthPixels`, anchor, confidence, residual, support, and periodicity metrics. `rotationDegrees` and `anchorPixel` describe the selected geometry profile's lattice orientation and phase; they are not defined as one universal polygon-centroid convention across all three geometries. Hexagonal results additionally retain the legacy `PointyTop`/`FlatTop` orientation and `centerSpacingPixels` fields for compatibility.

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
