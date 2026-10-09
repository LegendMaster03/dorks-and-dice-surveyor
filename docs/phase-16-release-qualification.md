# Phase 16 — deterministic release qualification and blockers (2026-10-09)

**Status: NO-GO for authoritative generalized Surveyor detection.**
This document is an actionable bounded acceptance checklist, not a proposal
to extend Phase 16 indefinitely. The existing deployed **Surveyor v2** and
Hex Crawl tester workflows remain unchanged. No schema or asset migration is
part of this work. Feature branches must not be merged without authorization.

## Declared supported raster envelope for current qualification

- Finite rank-two Euclidean polygonal patterns with complete periodic motifs:
  one or more inequivalent cells, mixed triangles/quadrilaterals, non-edge-to-edge
  T-junctions and regular square/triangle/hexagon/rhombille geometry.
- High-contrast, rasterized **closed polygon boundary lines**, 3-pixel dark
  strokes over a largely bright background; a separate experimental Sobel
  segmentation allows uniform nonwhite fills. Normalized analysis images
  have at most 640 px per long side for the current benchmark. Source-image
  originals are not recursively aligned, warped or locally repaired.
- Seeded unfamiliar multi-orbit motifs are tested clean, 8° rotated/1.1×
  scaled, −7° noisy, and .96× resized. An additional 9° rotated/cropped
  stress map must work; a cropped/noisy/distractor stress image may be
  explicitly inconclusive. Texture, clutter and incorrect basis are negatives.
- The deterministic bounded fixture contract requires **at least 3/4**
  exact D-symbol matches on independently generated multi-orbit patterns,
  **the rotated/scaled and clean cropped cases** individually, **zero wrong
  confident identities**, original-image ink support **≥.83** and maximum
  rigid image corner drift **≤5 analysis pixels** on any positive detection.
  A bounded 640-pixel held-out case is required to finish in **≤15 s** on
  the GitHub Actions runner. These are hard *correctness/feasibility* gates,
  **not calibrated statistical error bars** or promises for every uploaded map.
- Heavy perspective, curved/aperiodic tilings, large uninterrupted artwork,
  missing polygon boundaries and photographic shadows are **not** part of this
  narrow planar line-map envelope. The existing detector remains available
  for supported current regular hex-grid imports. Inconclusive must never
  change the world or fabricate an identity.

## Actual tests and observed outcomes

The qualifying synthetic benchmark is
`test/phase16-heldout-raster.test.mjs`, with independent ground-truth
D-symbols from polygon witnesses and zero hints to the image detector.
Previously recorded measurements on exact CI commit `06b121af`:

| Fixture | Actual outcome | Drift (px) |
| --- | --- | --- |
| mixed-1907, clean | exact identity | 0 |
| mixed-2911, rotated/scaled | exact identity | 1.89 |
| mixed-5023, modest noise | inconclusive | — |
| mixed-8011, .96× scale | exact identity | 1.71 |
| stress-14011, clean cropped/rotated | exact identity | 1.57 |
| stress-24109, noisy plus distractors | inconclusive | — |
| negative-311, random texture | inconclusive | — |
| negative-719, low-contrast texture | inconclusive | — |
| negative-ink-72019, dense irregular lines | inconclusive | — |

Those observations now have explicit automated `>=3/4`, individually
required rotation/crop, runtime, source ink and drift assertions.
Their green result is only **one component of Phase 16 acceptance**.

The newly authored `test/phase16-regular-raster-qualification.test.mjs`
tests the **unhinted image path** separately from pre-supplied valid mathematical
polygon witnesses. It identified gaps that the previous full test suite missed:

| Ground-truth motif | Image investigation | Release consequence |
| --- | --- | --- |
| Square | correct eight-chamber translation D-symbol; registered metric and supported raster projection | passes this regular-pattern case |
| Triangle | five translation hypotheses and repeated interiors found, but the raster contour has spurious four-sided geometry; reciprocal boundaries do not form a complete chamber graph | blocker: contour-to-incidence reconstruction |
| Hexagon | five translation hypotheses and repeated interiors found, but observed contours have seven/eight sides; at larger allowed simplification, adjacency sometimes derives a graph, not the correct hexagon proof | blocker: robust polygon corner/edge reconstruction |
| Rhombille | a valid **48-chamber / 6-cell** translation cover rather than expected **24-chamber / 3-cell** primitive motif; independently proven chamber projection and 2× lattice-area index | blocker: recover the primitive observed translation identity, never claim the larger symbol is the exact canonical presentation |

The code verifies the rhombille relationship by independently computing
a chamber covering map and verifying the integer area index, rather than
assuming two different strings mean the same tiling. A valid nonprimitive
presentation is **not equivalent to detecting the agreed identity**.

The separately authored Wikimedia Commons corpus executed successfully
[under CI](https://github.com/LegendMaster03/dorks-and-dice-surveyor/actions/runs/37996396637).
All three images returned inconclusive. Both photos were rejected at the
periodicity stage; colored vector artwork produced three viable translations
but failed complete closed-boundary reconstruction. Those real-image outcomes
are useful scope evidence **outside the frozen narrow synthetic envelope**.
They are not counted as successful detections or as a calibrated false-positive
rate. The external-image research workflow is again manual-only.

## Ordered remaining release work — do not broaden scope

1. **Repair polygon contour recovery for slanted acute/obtuse boundaries**
   without globally deleting legitimate short boundary segments, T-junctions
   or adding named pattern special cases. Preserve the same Sobel translation
   hypotheses, global rigid fit and distant-region drift proof. Require no-hint
   regular triangle/hexagon tests to return the exact independent D-symbol,
   not just an arbitrary valid alternative polygon graph.
2. **Recover/check the primitive translation lattice** for rhombille and any
   other detected multiple cover. Use independently tested periodic geometry
   and original-raster evidence. Do not infer minimality solely from cell
   count, text labels or a catalog. Ambiguity must remain explicit when the
   true primitive period cannot be proved.
3. **Finalize outcome/uncertainty policy** for the declared clean-line
   envelope. Only registered, proven source-image geometry with sufficient
   complete-stroke, negative-space, area, and distant-region support may be
   considered for a future authoritative result. Unsupported/uncertain images
   remain inconclusive. Any numeric confidence must be externally calibrated;
   current .83 support is **not** a probability of correctness.
4. **Run end-to-end old/new compatibility and tester protection gates**:
   old Hex Crawl + old Surveyor, old client + new Surveyor, new client +
   old Surveyor, and new client + new Surveyor. Preserve the existing v2
   authenticated detection and map-import workflow; exercise a signed-in
   existing tester world/map and persisted expedition without changing it,
   then test rollback. Phase 16 makes **no database or asset schema changes**.
   Never reset or migrate the tester DB as part of this acceptance test.

No additional tiling classes, arbitrarily photographed perspective,
world traversal refactor, general runtime rendering, ruleset cutover,
database schema migration or arbitrary photo recognition is necessary for
Phase 16. Those additions must not silently become new release requirements.
Phase 17 owns world/cell authority and persistence.

## Verification command

`npm test` includes both the strengthened held-out suite and the regular
image qualifications, as well as all existing v2 and mathematical tests.
CI additionally builds and smokes the existing container and v2 endpoint.
A **green run is necessary but not sufficient** until the regular cases,
primitive representation and cross-service signed-in checks above pass.

No authority switch, production deployment or merge is authorized by these
research and qualification tests.
