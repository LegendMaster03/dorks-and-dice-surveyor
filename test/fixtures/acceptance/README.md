# Exact D02 browser acceptance rasters

The four Fallout-named PNGs are the user's supplied, purpose-built square-grid test maps, not publisher scans. The regular hex PNG is the original supplemental browser-review fixture. These are frozen original image bytes, not cleaner substitutes generated for a unit test.

The detector receives only decoded source pixels. Names, counts, and ground-truth polygon coordinates are never passed as detector hints. The test independently rejects shifted and drifting full-image covers. Small center labels must not be classified as solid cell interiors; genuinely filled interiors remain a negative control.

Run `npm run build` and `node research/d02-acceptance-corpus.mjs [output-directory]` to reproduce discovery and optionally export v3 wire responses for Tile Crawl's parser/registration tests. Replacing golden responses requires reviewing final transforms against the independent printed-grid oracle, not merely accepting a candidate status.

SHA-256:

- `fallout-wanderer-5x5-blank.png`: `7b1b1d16061909add0bece927818a84089c1e2013fbdb556d0afa496c6888110`
- `fallout-wanderer-5x5-populated.png`: `0b735e5502d61eadb93f3e8f9b8ddbde31e60bd8682b65eae418802975edc47c`
- `fallout-warfare2-9x9-blank.png`: `6ca55d19551470ff42808e700c07ea91ac6e583f4244c59e09ff6088031e757d`
- `fallout-warfare2-9x9-populated.png`: `94474f1c923b8582241f4305a63347b1b2118fb70a39ff6aeb9249382c2ac198`
- `qa-regular-hex-grid.png`: `e1195be67dc95e116609c4faa7648fcb763105bf8430acd7badd6fc2a394a113`
