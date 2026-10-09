# Phase 16 generalized Surveyor detection — evidence and open blockers

The authoritative merged roadmap is Hex Crawl PR #66. Generalized detection is now **within Phase 16**, not a deferred Phase 20 deliverable.

## Preserved architecture

Keep Surveyor v2 detection and all three current regular kernels available during development. Reuse `buildEdgeField` from `src/analysis/hex-grid/detector.ts` (Sobel gradient samples, normal evidence and distributed sampling) and retain established periodic projection, Hough/autocorrelation, continuous phase/spacing refinement, multi-region and distant rigid-residual checks. The new additive `discoverTranslations` module consumes the same edge samples and ranks pairs of candidate lattice vectors by original-image reciprocal evidence. No image is recursively transformed or locally corrected.

**Stage 1 status:** synthetic mixed square+triangle motifs, including 14-degree rotation and 17-degree rotation at 1.1x scale, produce translation candidates at the ground-truth basis (128,0) and (0,64) from original raster gradient observations. A synthetic event with suppressed edge samples is classified inconclusive. Early staged results are not a calibrated benchmark; these tests do not establish noise robustness or other supported tiling classes. Runtime for the 768×768 Sobel-observation test was approximately 3.7 s under the local run (test machine, not production host). No detector API endpoint or identity assertion is added.

## Four ordered checkpoints

1. Detect a stable, independently verified translation lattice with the established edge evidence. **Prototype only**; must benchmark rotations, scaling, occlusion, noise, and ambiguous periods.
2. Reconstruct a periodic geometric motif with polygon boundaries, internal and cross-period adjacencies from **observed raster evidence**. **Partially implemented**. The high-contrast closed-line probe (`motif-interiors.ts` followed by `observed-topology.ts`) observes repeated polygon interiors, matches opposite ink-separated sides, rejects T-junctions/incomplete boundaries, and requires reciprocal displacement consistency over multiple distant repetitions. Metric shared-edge lines and robust segmentation of arbitrary artwork are **unmet**.
3. Construct a chamber graph and validate/derive D-symbol for the observed motif, with reliable treatment of nontrivial symmetry quotients. **Partially implemented on synthetic raster input**. Without shape registrations or supplied polygon coordinates, `experimental-observer.ts` now composes original-image Sobel translation search, segmentation and reciprocal incidence to derive a Euclidean translation-group D-symbol for both independent mixed arrangements. Tested symbols match an independently generated exact geometric witness, including a rotated/scaled raster. A nonprimitive translation basis can produce a larger quotient; where the larger valid chamber graph provably projects onto the smallest observed quotient, the pipeline reconciles the presentation. This is **not proof of maximal symmetry** and does not derive translation covers from arbitrary input D-symbols.
4. Fit complete motif hypotheses jointly to the **unchanged source raster** across distant regions, reject false positives and report calibrated uncertainty. **Rigid validation added; production gate still unmet**. Original Sobel translation hypotheses require distant-region support and observed edges must be reciprocally repeated. The new `global-motif-fit.ts` fixes exactly one observed polygon per motif class, translates it rigidly using each candidate basis, and measures original-raster stroke coverage and maximum pixel-corner residual across multiple distant regions. A synthetic basis deliberately distorted by 2.5 pixels fails the rigid global test. Nonprimitive presentations are reconciled only by verified chamber projections. General continuous global metric optimization, occlusion/noise/artwork rejection benchmarks, calibrated confidence, admissible metric reconstruction and the supported public detector contract remain **unmet**.

## Research spike (not acceptance)

A reproducible Python-only offline probe `research/phase16_mixed_motif_spike.py` generated the fixed 768×768 mixed-cell raster in `research/phase16_mixed_ground_truth.png`. FFT autocorrelation recovered basis generators matching (128,0) and (0,64) up to sign and ordering. Connected-component contour approximation labeled the expected triangle/quadrilateral classes on clear interior cells; it did **not** reconstruct a reliable incidence graph or D-symbol. The recorded clean-image CPU time was approximately 0.17 s with peak RSS approximately 131 MB; hardware and Python library configuration were not standardized. Ground truth is synthetic, not held out. This is a preliminary feasibility signal, not a completed generalized detector.

## Continuous candidate refinement (additive, Phase 16)

The internal research path now fits both periodic translation vectors simultaneously from centroids of repeated cells segmented on the original raster. Each motif class has its own intercept; shared vectors are estimated through class-centered least squares. Address rounding is performed only from the original candidate, and the fit is bounded to a small seed neighborhood. Failure returns an explicit inconclusive outcome and the original candidate still must pass the independent rigid source-ink/corner verification. No resampled or recursively corrected raster is used. This is additional geometric evidence, not a mathematically derived translation cover or a calibrated production detector.

## Additional unfamiliar-motif validation and noise boundary

Three independently constructed four-region motifs composed of unsplit quadrilaterals and two alternative triangle diagonals were rasterized as nine clean, rotated/scaled, or gray-stroke scenarios plus three deterministic additive-noise scenarios. Each expected translation-group D-symbol was derived separately from the input polygon witness and compared with the completely no-hint experimental observer. The nine clean/rotated/gray-stroke scenarios returned the expected canonical candidate; one of three moderately noisy scenarios was recovered, while the other two were inconclusive (none returned a wrong confident candidate). A texture-only negative control also remained inconclusive. These are synthetic programmatically generated cases, not a frozen external held-out benchmark; they do **not** establish production noise robustness, maximal-symmetry identity, or general artwork tolerance.

When diffuse edge noise swamps the current Sobel candidates, an additive *single strongest-gradient retry* filters the **existing original-raster edge samples**; it does not apply any new shape-specific detector or modify the source raster. Every surviving candidate must still pass the separate reciprocal topology and original-raster global rigid-fit checks. General artwork, occluded strokes, non-edge-to-edge raster junctions and final false-positive rate remain unqualified.

## First image-independent D-symbol translation-cover constructor

`src/resources/periodic-tiling/topology/translation-cover-from-symbol.ts` now constructs a finite, deterministic, integer-addressed and reciprocal periodic motif **from a supplied D-symbol alone**, provided that symbol is already a fully expanded, orientable, unbranched torus quotient. Face/edge/vertex orbits are recovered from the chamber involutions; a primal/dual tree-cotree decomposition derives two integer cohomology generators; closure around every vertex is checked before emitting cell interface voltages. No geometry, image, name, or catalog is consulted. Verified examples include square, two-cell checkerboard, hexagonal, triangular, rhombille, mixed triangle/quadrilateral and non-edge-to-edge T-junction witnesses; all address domains are deterministic and reciprocally traversable.

**This is a strictly bounded mathematical subset**. One-chamber square, triangle and hexagonal full-symmetry D-symbols remain valid but do not directly describe an unbranched torus and are correctly reported unsupported by this constructor. Deriving a finite translational subgroup / unbranched torus cover from an arbitrary valid Euclidean symmetry quotient remains a Phase 16 acceptance blocker, as does choosing an admissible metric realization. The new algorithm is useful to verify/operate already expanded D-symbols; it must not be used to misclassify other valid symbols as mathematically invalid.

## Explicit unresolved risks

- Image borders and cropping can reduce three-by-three support even for a correct lattice; validity must account for visible overlap rather than penalizing unsupported regions as false evidence.
- A translation lattice cannot uniquely determine cell outlines or distinguish line families generated by artwork. Cell reconstruction must use actual supporting pixels and topology checks.
- A candidate basis can be nonprimitive (a sublattice) or have unimodularly equivalent generators. Canonical identity must not depend on arbitrary Hough peak ordering.
- The finite translation D-symbol is not automatically the symmetry quotient of the observed tiling. A verified reduction step or explicit convention is required; do not call a translation-cover string a canonical full-symmetry symbol.
- Multi-region residuals and phase consistency must be jointly fitted once to the original evidence, with bounded hypotheses, memory, runtime and cancellation.
- This is not production-ready, and the old `/v2/periodic-tiling/detect` response must not be extended to claim support for unfamiliar motifs before those gates pass.

**Operating envelope of this internal experiment:** image at most 1,500,000 pixels by default, at most 600 observed cells for incidence and original-image rigid-fit verification, maximum 24 motif classes and 12 polygon sides per observed cell, 5 original-image lattice hypotheses by default, at least 3 repeated independent matching edges per motif boundary, at least 1.4 normalized unit-domain lengths of spatial span per accepted boundary, at least 83% original-raster edge ink support and at most 5 pixels maximum rigidly predicted corner residual in at least four raster regions. High-contrast closed-line polygons only; clearly evidenced non-edge-to-edge T-junctions can now be reconstructed, while missing or ambiguous boundaries remain inconclusive. Actual deployed Surveyor limits remain unchanged. These provisional limits are not a final calibrated operating envelope.

**Recommendation:** continue global metric registration, arbitrary-image robustness and the automatic D-symbol-to-translation-cover mathematical construction as blockers. Maintain the current v2 behavior and a compatible, additive future result contract. Do not request a Phase 17 migration or generalized runtime cutover until Phase 16 mathematical/Surveyor acceptance tests are satisfied.

## Phase 16 structural witness hardening

Reciprocal edge indices and the assertion of a valid D-symbol are insufficient to certify a periodic cover. The independent `witness-validation.ts` reconstructs all barycentric chamber involutions and orbit labels from cyclic motif boundary records, verifies the asserted canonical translation D-symbol, checks zero translation holonomy at every vertex, and proves that closed walks generate the entire primitive integer translation lattice (index one), not disconnected sublattices. Every new raster-derived motif candidate must pass this check before being reported as structurally consistent. The verifier uses exact integer and BigInt arithmetic for wire coordinates and lattice-index tests; it does not claim that an arbitrary metric embedding is admissible. The corresponding C# validator applies to all accepted witnesses without changing saved world authority.

This check found a genuine flaw in the existing symbol-to-torus constructor: choosing an arbitrary face's first chamber can reverse different face cycles, giving nominally reciprocal edges inconsistent oriented vertex holonomy. Both language implementations now choose a globally consistent chamber parity to enumerate the face boundaries. Regression tests check a constructed mixed motif, wrong claimed D-symbols, primitive lattice disconnection, broken vertex loops, unsafe coordinate formats and valid geometric witnesses. General symmetry-quotient unfolding, metric realization, and broad arbitrary-raster support remain Phase 16 blockers.

## Bounded image-free realization from a D-symbol and explicit scale

`reflection-realization.ts` now accepts a **one-chamber Euclidean reflection symbol** and explicit edge length, units and rotation, then unfolds the regular cell boundary directly through reflected copies. It infers a primitive two-vector translation lattice, enumerates a finite polygonal motif and validates the derived chamber cover against the input symbol using the independent geometric and structural verifiers. No named tiling lookup, raster or shape registration determines the construction. In this mathematically narrow class, the Euclidean condition `(m01 - 2) * (m12 - 2) = 4` yields the triangular, quadrilateral and hexagonal reflection cases without separate shape implementations. Metric constraints are applied as a global similarity transformation *after* the unit-scale combinatorics are verified; they do not change D-symbol identity or adjacency. Nontrivial multi-chamber symmetry quotients return `unresolved-geometry` until a general unfolding method is implemented. This is an additive internal constructor, not the general Phase 16 acceptance gate or an API endpoint.


### Additive experimental HTTP contract (Phase 16 branch only)

The opt-in `POST /v3/periodic-tiling/investigate` endpoint shares the existing
service-token authentication, bounded raster decoder, worker queue,
cancellation and timeout limits with unchanged production
`POST /v2/periodic-tiling/detect`. Discovery marks this separate capability
`maturity: experimental` and `authoritative: false`. **It does not claim to
identify an accepted pattern, offer production tiling creation or replace the
existing detector.** No `expectedDsSymbol`, other selector, or query option is
accepted. A consistent structural hypothesis is returned as a **candidate**,
never as `tiling`, `detected`, or an authenticated world decision.

The v3 investigation response includes the source media/dimensions, analysis
scale, derived candidate D-symbol, source-pixel translation-basis vectors,
edge support, measured geometric residuals in source pixels, candidate counts
and timings. Ambiguous/inconclusive results carry no candidate identity.
The non-authoritative result is returned even if a downscaled analysis image
was used; `sourceResolutionVerified` explicitly records whether full-size
pixels were examined. v3 error envelopes advertise v3; all v2 envelopes remain
unchanged. This is a compatibility seam for later calibration and integration,
not the final generalized detector acceptance gate.


Candidate geometry exposure: the experimental v3 investigation also carries
provisional motif-cell IDs, measured source-pixel contour polygons, reciprocal
side/neighbor interfaces with integer translation offsets, and the per-edge
observation count. IDs and polygon coordinates are **observations**, not
persistent Tile Crawl cells or a certified non-overlapping geometric witness.
These values cannot replace full mathematical realization validation or the
remaining held-out image-detection acceptance suite.


### Non-edge-to-edge raster boundaries

A bounded spatial-index pass now restores collinear T-junction subdivisions on long observed contour sides when independent, oppositely oriented neighboring sides provide ink-separated geometric evidence. It does not assume a tiling catalog, alter the original raster, or permit partial segment matching to bypass reciprocal/holonomy validation. This specifically addresses complete, high-contrast periodic T-junction patterns; noisy, occluded, and ambiguously segmented junctions still require held-out validation before confident detection. The usual D-symbol and global rigid-fit checks remain mandatory.


## Predeclared held-out synthetic regression suite

`test/phase16-heldout-raster.test.mjs` is an additional reproducible, seeded
benchmark. A generator separate from Surveyor's detector chooses unknown 3-by-2
mixed-square/triangle motifs with inequivalent cell types, computes polygonal
ground truth independently, draws original raster images and applies rotations,
scales, deterministic grayscale noise, crop offsets and unrelated strokes.
Neither the symbol nor the translation basis is passed into the investigator.

The **provisional** gate is fixed before running: among four complete new
mixed motifs, at least two must reconstruct exactly and **none** may assert a
wrong symbol; two crop/distractor stress maps must never produce a wrong
candidate; two gridless texture negatives must never become motif candidates.
An inconclusive stress image is not counted as a successful detection. Every
sample emits machine-readable status, correctness, milliseconds and geometric
residuals for later baseline comparison. These are synthetic held-out seeds,
**not** an independent real-world image corpus, confidence calibration or the
full Phase 16 acceptance gate. The stated thresholds must not be lowered in
response to a failed CI run without explicit documented scope approval.


### Held-out baseline and unsuccessful ink-edge recovery experiment

The first four previously unseen seeded 3-by-2 mixed-polygon motifs yielded
**1/4** exact identities (all other clean motifs inconclusive, zero wrong).
Stage diagnostics traced two failures to the old 260-interior topology cap.
The spatially indexed candidate-neighbor search now admits up to 600 observed
interiors and runs the same reciprocal incidence and original-image rigid-fit
checks; the held-out result improved to **3/4** exact identities, zero wrong.
The cropped test yielded a correct motif; the noisy distracted stress test was
inconclusive. Two texture-only negatives and an additional high-contrast
nonperiodic ink-stroke negative were inconclusive. Tests retain the original
minimum 2/4 clean success threshold; adding the third negative is strictly
stronger and does not weaken the declared gate.

The remaining noisy rotated mixed map (seed 5023, deterministic noise ±7)
failed initial translation discovery, despite intact structural ground truth.
A candidate-only Sobel gradient/ink retry briefly improved translation
hypothesis count, but none survived independent repeated boundary evidence.
That unproven retry and its more permissive ranking weights were removed rather
than shipping extra CPU cost or relaxing the reciprocal adjacency checks.
The failing noise variant remains visible as a benchmark inconclusive result.
These tests do not replace independent real-map held-out validation or
probabilistic confidence calibration.


## Uniform Euclidean multi-chamber symmetry quotients

The bounded, additive `unfoldUniformEuclideanQuotient` constructor now derives
an **unbranched orientable translational torus** for more than one chamber
whenever *all* chambers have the same face and vertex orders and satisfy
`(p-2)(q-2)=4`. It constructs the one-chamber reflection tiling's verified
torus without any registered shape name, forms a **connected fiber product**
of the two chamber involution actions, validates its Euclidean order and
covering projections to both factors, and derives primitive integer
translations using the existing tree/cotree and witness verification.
Inputs with mixed face degrees, mixed vertex valences, excessive product size,
or no proved cover remain explicitly unsupported or inconclusive. This
does not infer a unique geometric embedding or produce generalized mixed-cell
orbifold unfolding, which remain Phase 16 blockers.


### Verified geometric lift of uniform quotient covers

The bounded `realizeUniformEuclideanQuotient` research constructor now
attempts an image-independent metric realization in world units. It
constructs actual polygon coordinates and a primitive translation basis
by lifting the regular reflection-torus geometry through its finite-index
fiber-product cover. An exact integer cocycle consistency check determines
the projected sublattice; a final independent polygon-overlap, complete
interface, primitive lattice, and D-symbol witness check controls acceptance.

This remains restricted to uniform Euclidean local orders and the finite
24-cell metric verification envelope. Failure to construct a complete
embedding is `unresolved-geometry`, not a fabricated tile. It is not
yet a production world-realization API or a solution for arbitrary
nonuniform Delaney–Dress symbols.


### General Euclidean orientation double cover

A new bounded, cross-language `constructOrientableChamberCover` /
`DelaneyDressOrientationCover.Construct` independently builds the connected
orientation double of **any** valid Euclidean D-symbol, including nonuniform
mixed-cell quotients. Each involution toggles a parity bit. The construction
removes mirror/fixed-chamber identifications, proves a D-symbol covering
projection, preserves curvature and avoids duplicating already orientable
covers. Its `remainingBranchedOrbits` field explicitly counts cone/rotation
and edge branching still unresolved. **This alone is not a torsion-free
translation torus or a geometric realization.** The orientability step is
proved and tested, but general branched-orbifold unfolding remains outstanding.

## Exact metric chamber symmetry from separately verified polygons

`verifyMetricChamberSymmetry` is a second, more restrictive bounded
research constructor. Its input is an **independently verified exact periodic
polygon cover**, not raw image measurements or the untrusted provisional
contours from Surveyor v3. It reconstructs the barycentric chamber graph,
enumerates every possible chamber automorphism, and finds its planar
rotation/reflection, if any. For each candidate isometry it checks the image
of all vertices, edge midpoints and representative cell centers under **one
global transform**, a primitive integer-unimodular action on both lattice
generators, and exact reciprocal translation-voltage equations on every
edge. Voltage checks use `BigInt` to avoid numerical overflow. The resulting
chamber orbit quotient is independently parsed as Euclidean and must be
covered by the original translation D-symbol.

A square metric realizes eight automorphisms and reduces to one chamber;
an unequal-sided rectangle retains four, while an oblique parallelogram
retains two, despite all three sharing the combinatorial square torus.
Separate tests exercise mixed triangle/quadrilateral motifs and periodic
T-junction boundaries. Loose numerical tolerances are explicitly rejected.

This proves only metric isometries **of a supplied valid finite polygonal
witness**. It does not prove that noisy source-image contours, polygon
segmentation, image registration, or distant image regions support those
isometries. The v3 response remains unchanged and non-authoritative; it
still carries the verified *observed translation-group* D-symbol.
Before exposing any maximal-symmetry identity, Surveyor needs
original-raster isometry verification and calibrated ambiguity checks.
Hex Crawl has an independent C# implementation of the same proof boundary.

## Independent combinatorial chamber-symmetry reduction (not geometric detection)

The new `reduceCombinatorialChamberSymmetry` research function accepts a
valid bounded Euclidean D-symbol, enumerates every possible chamber-image
automorphism by propagating the three involutions, enforces face/vertex
multiplicity preservation, and forms the orbit quotient. An independent
D-symbol parser and chamber-cover projection certify the derived quotient.
The search is quadratic in the bounded chamber count, with no named-pattern
catalog, guessed symmetry, or factorial permutation enumeration. Regression
tests show the eight-chamber square translation torus reducing to the
one-chamber square quotient and require valid, idempotent reductions of
mixed-polygon and non-edge-to-edge motifs. The same construction and
tests exist independently in Hex Crawl's C# domain.

A D-symbol chamber automorphism is **combinatorial**; it may not represent a
rigid isometry of the observed raster or of a selected metric embedding.
Consequently the observer still reports its separately verified
**translation-group D-symbol**, not the maximal combinatorial quotient,
as its experimental candidate. The remaining real-image/geometric symmetry
proof, confidence calibration, and production observed identity convention
are not satisfied by this mathematical reduction.

## General Euclidean cone-point unfolding (cross-language proof)

The additional `constructGeneralEuclideanTranslationCover` constructor no
longer assumes uniform polygon degrees or an already expanded torus.
After the orientation double, it constructs the oriented orbifold's
face/edge/vertex chamber-orbit graph. For each local stabilizer of order
`b`, it assigns finite cyclic holonomy of exact order `b`. Such charges
must sum to zero on the closed oriented surface. A sparse spanning-tree
flow then computes chamber-edge voltages realizing those charges.

The connected lifted chamber graph is independently required to have
**no residual face, edge, or vertex branching**, to form an orientable
Euclidean torus, to possess primitive rank-two translational adjacency
and to project back to the user's original D-symbol. The same method
works for square, triangular, hexagonal, mixed square/triangle and
non-edge-to-edge polygonal quotient test cases, with no named-pattern
selection. Strict chamber and sheet limits still produce unsupported
results rather than invalidating a valid mathematical symbol.

The shared `generalQuotientCases` fixture checks 12 supported,
unsupported and invalid cases across TypeScript and C#.

### Image-independent harmonic metric realization

`realizeGeneralEuclideanQuotient` provides an additive, bounded
image-free realization attempt. It reconstructs every vertex orbit
from the topology's reciprocal interfaces and exact lattice shifts.
A periodic harmonic (minimum squared-edge) embedding solves a
gauge-fixed Laplacian for polygon vertices. The resulting polygons
are accepted **only if the independent complete-motif geometric
validator proves nonoverlap, all reciprocal boundaries, the primitive
translation basis and the original D-symbol**. Eight representative
regular and mixed-cell quotient examples pass.

Harmonic embedding is not a theorem that *every* valid Euclidean
D-symbol will have a nondegenerate admissible embedding under these
choices. A bounded, orientation-preserving affine fitting stage now accepts
explicit unequal period-u/v lengths and the included lattice angle; every
output is independently reverified after normalization back to lattice
coordinates so fixed absolute pixel/world tolerances do not manufacture
false overlaps after scale or rotation. Invalid, collapsed and excessive
period requests return `unresolved-geometry`. Arbitrary fixed polygon
corner angles, individual edge-length constraints and nonlinear coupled
metric requirements remain unsupported. The operational Tile Crawl metric
validator and UI integration remain Phase 16 work; no saved world consumes
this candidate automatically.

## Original-raster metric symmetry cross-check — bounded internal research seam

`verifyOriginalRasterIsometry` checks a **proposed**, rigid orthogonal
rotation/reflection against the unchanged grayscale image. It does not
discover transformations or infer a D-symbol. A deterministic bounded sampling
pass checks dark ink and bright negative space independently, including their
spatial support in a 3×3 grid. A single local patch cannot qualify as a
global-image symmetry; a candidate must have at least six supported distant
regions spanning all three rows and columns. The conservative research
defaults require 87% total ink correspondence, 94% bright-background
correspondence, 72% minimum region ink correspondence, at least 200 ink
and 600 background samples, and a maximum 1.5-million-pixel raster.
No image is resampled, locally warped, or repeatedly aligned.

`crossCheckMetricSymmetryWithOriginalRaster` joins the **already independently
verified** exact polygon metric-chamber symmetry path to this pixel check.
Its input must be a complete `OperationalCover` whose metric realization
is registered directly in the analyzed image's **pixel coordinate system**.
For each mathematically proved nonidentity rigid transform, a deterministic
**whole integer lattice displacement** centers the isometry in the visible
crop. This uses only the known metric basis and crop dimensions, never a
pixel-search best fit. Every such transformation is independently measured
against the original raster; the output records the candidate count and the
number supported by image evidence, explicitly labeled non-authoritative.

The square and unequal-sided rectangular fixtures pass their appropriate
whole-image transformations. Rotating a rectangular lattice by 90° fails,
as do a grid confined to one local patch, deleted distant lines, unrelated
asymmetric strokes, and entirely gridless imagery. The test-fixture
registration also exposed a precise half-pixel error: rotating a synthetic
line grid around the image-box midpoint is **not** always the same as
rotating around its true lattice center. The tests correct the supplied
registration rather than reducing evidence thresholds.

**Acceptance boundary:** a complete precise image-registered polygon witness
is **not yet obtainable automatically from arbitrary user-supplied raster
artwork**. The current detector observes noisy contours and provisional
translation cells; applying this mathematical metric proof directly to
those observations would make an unsupported identity claim. This research
seam therefore does not alter the v3 HTTP contract, the v2 detection path, or
authoritative world data. Production-capable raster registration,
original-image geometric-error calibration, independent real-map corpus,
reliable ambiguity semantics, and symmetry reduction backed by those image
observations remain explicit Phase 16 blockers.

### CI discovery regression and correction

The earlier Phase 16 symmetry test files were accidentally omitted from
the old explicitly enumerated `npm test` command, making its green result
insufficient evidence for those new algorithms. The Surveyor script now
executes `test/*.test.mjs` in addition to compiled TypeScript test files,
so all new Phase 16 regression suites are automatically discovered. The
first expanded run exposed the half-pixel test registration defect.
After correction, the complete **152-test suite passed with zero failures**
and container smoke checks remained green. This evidence is for the
research code and synthetic test corpus, not for final Phase 16 acceptance.

## Experimental joint registration of source-raster polygon contours

`registerObservedMetric` is an independent, bounded research step after
the existing Sobel/periodicity pipeline, interior segmentation, reciprocal
incidence reconstruction, and global rigid-fit analysis. It converts
**ink-separated white-region contours** into candidate shared boundaries
without selecting a known shape or perturbing the source image.

Each pair of reciprocal atomic sides contributes translated endpoint
equalities. A graph potential calculation checks the entire periodic
holonomy for contradictions; one robust vertex position is estimated
for every connected equivalence class from all repeated source-image
contour observations, using a **single fixed lattice basis**. An observed
corner must lie within six analysis pixels of its jointly fitted ideal
shared vertex (to account for both sides of a three-pixel raster ink
stroke). The earlier, independent **five-pixel maximum accumulated rigid
translation drift** rule remains unchanged. No cell-specific geometric
registration, snapping, or accumulated error correction is permitted.

A cropped raster may show the first complete polygon of each motif class
several whole periods apart. The constructor chooses a representative
for each class by an **integer whole-lattice displacement only**. This is
a translation-cover addressing convention: shapes and real pixel samples
are not moved or modified. The exact polygon constructor then **re-derives**
every adjacency and D-symbol from the candidate geometry, rejects
overlapping or degenerate periodic polygons and other unsupported
embeddings, and requires exact agreement with the independently observed
chamber symbol. This new path does not bypass its geometric verification
or add an authoritative return value to the v3 API.

Initial synthetic closed-line checks:
- Two independent axis-aligned mixed-polygon maps admit a globally shared
  exact polygon witness, consistent with the independently recovered
  D-symbol and original-image edge checks.
- The initial rotated and scaled mixed map *appeared* to overlap due
  to a numerical bug in the exact segment-intersection predicate.
  Each signed orientation is now compared with a length-scaled tolerance.
  With the non-overlap proof retained, this map now produces an exact
  metric witness. The separate actual-overlap negative fixture still fails.
- Reciprocal boundary corruption, contradictory constraints, excessive
  contour residuals and inaccurate periodic basis are refused, and no
  database state or existing production analysis behavior changes.

This closes one narrow raster-to-exact-geometry gap for the supported
high-contrast cases, **not** the full Phase 16 generalized-detector
acceptance requirements. Rotated/occluded/artwork-heavy polygon metric
reconstruction, larger unfamiliar motifs, quantified image uncertainty,
independent real-world holdouts and end-to-end image-to-metric-symmetry
confidence calibration remain blockers.

## Numerical periodic intersections and v3 metric evidence bridge

The independent polygonal torus constructor previously checked whether the
product of two signed segment-side determinants was negative. For a shared
vertex in a rotated motif, one determinant can be a tiny nonzero floating
point rounding error while the other is large. Their product can cross the
fixed threshold and incorrectly classify two touching boundaries as a
proper interior crossing. The constructor now checks **each signed
orientation separately against its own segment-length-scaled distance
tolerance**, consistent with the existing boundary point tolerance.
A numerical regression confirms a valid independently constructed rotated
square/triangle motif is not rejected, and a separate overlapping-polygon
fixture still fails the strict non-overlap proof.

The original rotated and scaled mixed-raster fixture now produces a fully
verified **exact shared polygon translation witness** from original image
contours. The original contour-uncertainty ceiling, independent five-pixel
multi-region drift gate, topology agreement, and exact polygon non-overlap
checks remain intact. No pattern-name catalog or locally accumulated
alignment corrections were introduced.

The experimental v3 investigator now also runs that geometric constructor
on its selected complete topology candidate. Its additive
`evidence.metricRegistration` property records `registered`,
`inconclusive`, or `unsupported`, the bounded source-pixel residuals when
registered, and a separate count of mathematically available isometries
versus transformations actually supported by original-image ink/background
checks. The previous provisional polygons, candidate D-symbol, non-authoritative
status, and source-image scaling semantics are unchanged. Metric fit failure
never silently changes a topologically supported observation into an
accepted geometric world. Older candidate evidence lacking this optional
field remains readable, and the existing v2 response and endpoint do not
change.

This is stronger end-to-end evidence for the supported synthetic closed-line
map envelope, but not calibrated real-map correctness or a general source-image
symmetry certificate. A fully confirmed metric quotient would require every
claimed isometry to be supported under a declared operating envelope, with
measured false-positive bounds and tested adversarial artwork.


## Independent public artwork and photographic research corpus (manual-only)

The previous held-out raster suite is entirely programmatically generated and
cannot establish performance on maps from other authors. The new
`research/phase16-public-image-corpus.mjs` manifest identifies THREE independently
authored, unmodified Wikimedia Commons originals and pins their **published SHA-1
checksums**. They are downloaded from their Commons file redirects at manual
probe time. Their actual checksum is verified *before* resizing and analyzing.
No guessed pattern, raster translation, polygon or known D-symbol is passed
to the Surveyor detector. The research output records the provisional D-symbol,
polygon-side counts, exact metric registration status, source-image symmetry
support and runtime; it expressly **does not** assign acceptance confidence or
promote any user-world tiling. The manifest and checksums have an offline
mandatory CI test, while actual Wikimedia downloads have an optional
`workflow_dispatch` workflow to avoid brittle, network-dependent required CI.
There are no stored copyrighted image assets in the repository.

Independent sources and license provenance:

- **Arthur Baelde**, *A periodic tiling by regular hexagons and equilateral
  triangles.svg* (2013/2022 revision), non-edge-to-edge mixed tiling,
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:A_periodic_tiling_by_regular_hexagons_and_equilateral_triangles.svg),
  Creative Commons Attribution-ShareAlike **3.0**, original SHA-1
  `5a03bd6bf603642d524cea6d26d7f96e9a5946bd`.
- **David Shay**, *Hexagonal tessellation.JPG*, photograph of floor tiling
  in Rome, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Hexagonal_tessellation.JPG),
  Creative Commons Attribution-ShareAlike **3.0**, original SHA-1
  `68f08e84b5ce0ad0adda1ff07a3519f7d10bc952`.
- **121 Unbiunium**, *Square Tiles.jpg* (2026), photograph of square
  floor tiles, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Square_Tiles.jpg),
  Creative Commons Attribution-ShareAlike **4.0**, original SHA-1
  `8fc47cec443788ca38544562dd051fd044f2008f`.

The optional probe re-renders downloaded images as a single bounded grayscale
image **for analysis only** and records dimensions of the transformed
observation. The original work, credits and publication links remain preserved.
This is not a fully labeled benchmark: authorship and visible geometry are
known, but no independent exhaustive periodic chamber ground truth or
perspective rectification has been supplied. Photographic perspective may
legitimately yield `inconclusive` and must not be counted as a false
negative under a calibrated planar-map contract that has not yet been set.
Likewise a positive `consistent-candidate` is still only a research candidate.
Actual observed results must be collected and manually adjudicated before
the real-image Phase 16 acceptance criterion can be claimed.

To run manually on a machine with internet access:
`npm ci && npm run build && node research/phase16-public-image-corpus.mjs --run`.
A metadata-only no-network dry run is
`node research/phase16-public-image-corpus.mjs --list` (after building
`dist`). The GitHub Action `Phase 16 external artwork research` is
manual-only and cannot deploy.

## Full-image exact-polygon raster projection — held-out spatial evidence

The new bounded `verifyProjectedPolygonsInOriginalRaster` module projects the
**independently verified pixel-coordinate periodic polygon witness** over the
entire visible image. Unlike the earlier `global-motif-fit` check, it samples
the *predicted* translated strokes in regions even where no complete closed
raster interior was detected, plus valid geometric interior points expected
to lie in bright negative space. The tested image is the **unchanged source
grayscale raster**; no warp, local registration, image rewrite or fitting
against this evidence is performed.

The verifier uses deterministic bounded enumeration of at most 8,000
periodic cell copies and at most 160,000 source stroke samples, with a
1.5-million-pixel input cap. It returns `supported`, `inconclusive`
or `unsupported` with explicit provenance. Its current *exploratory*
thresholds are at least 83% stroke evidence, 82% eligible bright interior
evidence, and at least seven of nine spatial regions with sufficient local
stroke agreement (and coverage in all rows and columns). These are not
empirically calibrated probabilities or statistically independent tests.

The tests require the unchanged original image to support both an
axis-aligned and a rotated mixed-square-and-triangle witness; a raster
with predicted geometry erased from roughly half the crop fails, as does
an image whose tile interiors are painted dark while the boundaries
remain present. Limited local obstruction can remain `supported`
without lowering thresholds. Malformed pixel witnesses and oversized
sample requests return `unsupported`, never a fabricated identity.

The additive `evidence.metricRegistration.sourceProjection` v3 field reports
the independent check's status, original-image stroke/negative-space support
ratios and region coverage **only when actually supported**; all metrics
are null when inconclusive or unsupported. Pixel proportions do not need
source-resize scaling. Neither this field nor mathematical symmetry
verification changes the candidate D-symbol, automatically accepts a world
geometry or affects the deployed Surveyor v2 detector. The authenticated
full-image mixed-map HTTP regression now requires supported projection.

**Remaining limitation:** this test uses the SAME source image used for
contour extraction, so it is an out-of-fit spatial plausibility check, not
an independent test sample in the statistical sense. Colorful interiors,
line breaks, inconsistent ink contrast, heavy obstruction, perspective
photographs, unrelated labels and image resolution changes can legitimately
make this check inconclusive. Separately sourced, correctly labeled and
actually executed real-image holdouts plus operating-envelope calibration
remain mandatory before an authoritative generalized detector can be shipped.
