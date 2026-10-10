# Phase 16 — deterministic release qualification and blockers (2026-10-09)

**Status: synthetic detection qualification PASS; Phase 16 release remains NO-GO**
until the deployed cross-version and signed-in existing-tester verification gates
are completed. The existing deployed **Surveyor v2** and Hex Crawl tester
workflows remain authoritative and unchanged. The v3 API is explicitly
experimental and non-authoritative. No schema or asset migration is part of
Phase 16. Do not merge or deploy either feature branch without authorization.

**Current Surveyor head at this checkpoint:** `eafc46ee4592f7262598d54229b22257a748ee1e`.
[Successful CI run 38003815381](https://github.com/LegendMaster03/dorks-and-dice-surveyor/actions/runs/38003815381):
**171 tests passed, 0 failed**, including TypeScript build, the full bounded
qualification and existing v2 suite, container build, and endpoint smoke tests.
The Hex Crawl feature branch remains `3e4794eca7233e42e3666860972b9ef08687017c`
with [passing CI 37987736138](https://github.com/LegendMaster03/dorks-and-dice-hex-crawl/actions/runs/37987736138).

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

The no-hint `test/phase16-regular-raster-qualification.test.mjs` initially
exposed the following defects, missed by the previous suite. The table below
records the **initial failures**, not the current result:

| Ground-truth motif | Image investigation | Release consequence |
| --- | --- | --- |
| Square | correct eight-chamber translation D-symbol; registered metric and supported raster projection | passes this regular-pattern case |
| Triangle | five translation hypotheses and repeated interiors found, but the raster contour has spurious four-sided geometry; reciprocal boundaries do not form a complete chamber graph | blocker: contour-to-incidence reconstruction |
| Hexagon | five translation hypotheses and repeated interiors found, but observed contours have seven/eight sides; at larger allowed simplification, adjacency sometimes derives a graph, not the correct hexagon proof | blocker: robust polygon corner/edge reconstruction |
| Rhombille | a valid **48-chamber / 6-cell** translation cover rather than expected **24-chamber / 3-cell** primitive motif; independently proven chamber projection and 2× lattice-area index | blocker: recover the primitive observed translation identity, never claim the larger symbol is the exact canonical presentation |

The original doubled rhombille result had a verified chamber projection and
twofold lattice-area index. That proof did not make it the correct primitive
presentation. The generalized primitive search now resolves that presentation
from original observed polygons and prime-index lattice candidates; it never
uses a pattern-name catalog to select a period.

**Current independently checked no-hint image outcomes (CI 38003815381):**

| Raster | Derived translation D-symbol | Registered metric | Unchanged-image polygon projection |
| --- | --- | --- | --- |
| Square | exact 8-chamber / 1-cell primitive | registered | supported |
| Triangle | exact 12-chamber / 2-cell primitive | registered | supported |
| Hexagon | exact 12-chamber / 1-cell primitive | registered | supported |
| Rhombille | exact 24-chamber / 3-cell primitive | registered | supported |

Every positive still satisfies **≥.83 original-image ink support**, **≤5 px
global rigid corner drift**, and the independent polygon projection gate.
Acute raster corners use a bounded ink-width/angle-based contour uncertainty,
not a looser global drift threshold. The detection identity remains a
translation-group D-symbol; maximal combinatorial or metric symmetry claims
are separately established and not silently substituted.

Additional regressions prove that a true raster T-junction needs two distinct
opposing polygon-cell witnesses, while a displaced raster corner cannot invent
one. A deliberate **threefold** oversize translation cover reduces to a
verified primitive period; a geometrically different neighboring cell does
not permit a false half-period. If a shorter polygon period is geometrically
plausible but lacks a complete reciprocal chamber/metric/image proof, the
result is **ambiguous** rather than a confident larger identity.

The separately authored Wikimedia Commons corpus executed successfully
[under CI](https://github.com/LegendMaster03/dorks-and-dice-surveyor/actions/runs/37996396637).
All three images returned inconclusive. Both photos were rejected at the
periodicity stage; colored vector artwork produced three viable translations
but failed complete closed-boundary reconstruction. Those real-image outcomes
are useful scope evidence **outside the frozen narrow synthetic envelope**.
They are not counted as successful detections or as a calibrated false-positive
rate. The external-image research workflow is again manual-only.

## Release gates and remaining verification

1. **PASS — General contour recovery.** Original raster segmentation, coherent
   slanted polygon corners, full T-junction subdivisions, repeatability and
   reciprocal chamber reconstruction now recover exact triangle/hexagon
   topology. They do not erase the previously passing mixed-motif,
   cropped/rotated, noise-control, or staggered T-junction tests.
2. **PASS — Primitive translation identity for the declared fixtures.**
   Prime-index translation superlattices are proposed from group mathematics,
   and accepted only after actual observed polygon congruence, class
   repartition, reciprocal incidence, proved chamber cover, global unchanged
   raster fit, exact joint metric registration, and polygon/negative-space
   projection. Index-two rhombille/hexagon and independent index-three square
   regressions now pass. Unsupported or unproved shorter candidates remain
   ambiguous. This is a bounded supported raster envelope, not a claim about
   every possible photo or aperiodic image.
3. **PASS — Frozen *experimental* detection evidence contract.** A future
   supported result must demonstrate a verified Euclidean D-symbol topology,
   an independently checked primitive translation presentation, complete
   polygonal metric realization, original-image edge support ≥.83,
   unchanged-image polygon/negative-space plausibility, global alignment
   corner drift ≤5 analysis pixels, sufficient distant-region evidence,
   and explicit uncertainty. The research support threshold is not calibrated
   statistical confidence. Current API results remain `consistent-candidate`,
   `ambiguous`, or `inconclusive`, never an authoritative world mutation.
4. **PASS — Isolated four-version real-HTTP compatibility and rollback
   rehearsal; OPEN — deployed existing-tester qualification.** On pinned
   baseline and feature revisions, a separate disposable-container matrix
   passed old Hex Crawl + old Surveyor, old Hex Crawl + augmented Surveyor,
   new Hex Crawl + old Surveyor, and new Hex Crawl + augmented Surveyor.
   It exercised positive authenticated v2 hex detection, saved PNG import,
   the opt-in v3 old-provider fallback and new-provider candidate, and
   retained world/map/expedition state. An actual old Hex Crawl image also
   reopened the exact same ephemeral CI database and map-asset volume after
   new Hex Crawl was stopped. The independent
   [four-way CI run 38015153101](https://github.com/LegendMaster03/dorks-and-dice-hex-crawl/actions/runs/38015153101)
   is evidence for these **isolated** contracts, not for deployed login,
   production assets or existing tester data. Still perform signed-in,
   read-only checks on representative existing tester worlds, source assets
   and persisted expeditions, confirm actual deployed versions, and verify
   operational rollback. The v2 endpoint and schema remain unchanged;
   no database reset or asset migration is permitted.

No perspective-rectification, new tiling-specific algorithms, generalized
world rendering/movement, schema migration, or user-facing authority switch
is necessary for this release. Those belong to later authorized phases.
The separate Wikimedia originals returned inconclusive, and no successful
real-image generality or calibrated accuracy claim has been established
outside the declared narrow raster envelope.

## Verification command

`npm test` includes both the strengthened held-out suite and the regular
image qualifications, as well as all existing v2 and mathematical tests.
CI additionally builds and smokes the existing container and v2 endpoint.
The regular exact-identity, primitive representation, source-projection and
bounded held-out gates now pass. **A green run is necessary but not sufficient**
while the actual old/new cross-deployment and signed-in existing-tester
workflow/rollback checks remain incomplete.

No authority switch, production deployment or merge is authorized by these
research and qualification tests.
