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

**Operating envelope of this internal experiment:** image at most 1,500,000 pixels by default, at most 260 observed cells for incidence, maximum 24 motif classes and 12 polygon sides per observed cell, 5 original-image lattice hypotheses by default, at least 3 repeated independent matching edges per motif boundary, at least 1.4 normalized unit-domain lengths of spatial span per accepted boundary, at least 83% original-raster edge ink support and at most 5 pixels maximum rigidly predicted corner residual in at least four raster regions. High-contrast closed-line polygons only; non-edge-to-edge T-junctions and missing boundaries return inconclusive. Actual deployed Surveyor limits remain unchanged. These provisional limits are not a final calibrated operating envelope.

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
