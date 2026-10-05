import assert from "node:assert/strict";
import test from "node:test";
import {
    parseCundyRollettNotation,
    parseGomJauHoggNotation
} from "../src/resources/periodic-tiling/notation/index.js";
import { PeriodicTilingNotationError } from "../src/resources/periodic-tiling/types.js";

test("Cundy-Rollett parser canonicalizes equivalent regular notation without catalog knowledge", () => {
    for (const value of ["6^3", "6^{3}", "6³", "6.6.6", " 6 . 6 . 6 "]) {
        const parsed = parseCundyRollettNotation(value);
        assert.equal(parsed.canonical, "6^3", value);
        assert.deepEqual(parsed.regularVertex, { polygonSides: 6, polygonsAtVertex: 3 }, value);
    }
});

test("Cundy-Rollett parser distinguishes repeated polygon sequences from repeated vertex configurations", () => {
    const alternating = parseCundyRollettNotation("(3.6)^2");
    assert.equal(alternating.canonical, "3.6.3.6");
    assert.deepEqual(alternating.vertices, [{
        factors: [
            { sides: 3, repeat: 1 },
            { sides: 6, repeat: 1 },
            { sides: 3, repeat: 1 },
            { sides: 6, repeat: 1 }
        ],
        multiplicity: 1
    }]);

    const expanded = parseCundyRollettNotation("3^6; 3^6; 3^4.6");
    const compact = parseCundyRollettNotation("(3^6)^2; 3^4.6");
    assert.equal(expanded.canonical, "(3^6)^2;3^4.6");
    assert.equal(compact.canonical, expanded.canonical);
    assert.deepEqual(compact.vertices[0], {
        factors: [{ sides: 3, repeat: 6 }],
        multiplicity: 2
    });
});

test("Cundy-Rollett vertex configurations canonicalize cyclic starting point and reflection", () => {
    const canonical = parseCundyRollettNotation("3.4.6.4").canonical;
    assert.equal(canonical, "3.4.6.4");
    assert.equal(parseCundyRollettNotation("4.6.4.3").canonical, canonical);
    assert.equal(parseCundyRollettNotation("4.3.4.6").canonical, canonical);
});

test("Cundy-Rollett parser preserves published superscript ambiguity variants and canonicalizes vertex ordering", () => {
    const first = parseCundyRollettNotation("[3^4.6; 3^6]^1");
    const second = parseCundyRollettNotation("[3^6; 3^4.6]^{2}");
    const unicode = parseCundyRollettNotation("[3^6; 3^4.6]²");
    assert.equal(first.canonical, "[3^6;3^4.6]^1");
    assert.equal(second.canonical, "[3^6;3^4.6]^2");
    assert.equal(unicode.canonical, second.canonical);
    assert.equal(first.variant, 1);
    assert.equal(second.variant, 2);
    assert.equal(unicode.variant, 2);
});

test("Cundy-Rollett parser handles a published 2-uniform ambiguity example", () => {
    const parsed = parseCundyRollettNotation("[3^3.4^2; 3^2.4.3.4]^2");
    assert.equal(parsed.canonical, "[3^3.4^2;3^2.4.3.4]^2");
    assert.equal(parsed.variant, 2);
    assert.equal(parsed.vertices.length, 2);
});

test("Cundy-Rollett parser rejects malformed or non-Euclidean vertex syntax rather than treating it as unsupported catalog data", () => {
    for (const value of ["", "6^", "2^4", "6..6", "(3.6", "[3^6;3^4.6", "[3^6;3^4.6]_2", "3.4.6.5"]) {
        assert.throws(
            () => parseCundyRollettNotation(value),
            error => error instanceof PeriodicTilingNotationError && error.notation === "Cundy-Rollett",
            value);
    }
});

test("Cundy-Rollett parser accepts redundant grouping without changing canonical identity", () => {
    assert.equal(parseCundyRollettNotation("(3^6)").canonical, "3^6");
});

test("GomJau-Hogg parser handles published placement phases and generic transform stages", () => {
    const regular = parseGomJauHoggNotation(" 6 / M30 / R(H1) ");
    assert.equal(regular.canonical, "6/m30/r(h1)");
    assert.deepEqual(regular.placement, [{ polygons: [6] }]);
    assert.deepEqual(regular.transforms, [
        { operation: "m", angleDegrees: 30 },
        { operation: "r", origin: { kind: "h", index: 1 } }
    ]);

    const complex = parseGomJauHoggNotation("4-3,3,3-4,3/r(c2)/r(h13)/r(h45)");
    assert.equal(complex.canonical, "4-3,3,3-4,3/r(c2)/r(h13)/r(h45)");
    assert.deepEqual(complex.placement.map(phase => phase.polygons), [[4], [3, 3, 3], [4, 3]]);
    assert.equal(complex.transforms.length, 3);

    const skippedSides = parseGomJauHoggNotation("12-0,3,3-0,4/m45/m(h1)");
    assert.equal(skippedSides.canonical, "12-0,3,3-0,4/m45/m(h1)");
});

test("GomJau-Hogg parser canonicalizes an omitted centered angle to the published 180-degree default", () => {
    const omitted = parseGomJauHoggNotation("3/m/r(h2)");
    const explicit = parseGomJauHoggNotation("3/m180/r(h2)");
    assert.equal(omitted.canonical, explicit.canonical);
    assert.equal(omitted.canonical, "3/m180/r(h2)");
    assert.deepEqual(omitted.transforms[0], { operation: "m", angleDegrees: 180 });
    assert.deepEqual(omitted.transforms[1], { operation: "r", origin: { kind: "h", index: 2 } });
});

test("GomJau-Hogg parser validates published grammar independently from the tiling catalog", () => {
    const knownNotationWithoutCatalogEntry = parseGomJauHoggNotation("12-3/m30/r(h3)");
    assert.equal(knownNotationWithoutCatalogEntry.canonical, "12-3/m30/r(h3)");

    for (const value of [
        "",
        "6/m30",
        "6//r(h1)",
        "2/m30/r(h1)",
        "5-3/r45/m(v2)",
        "6/x30/r(h1)",
        "6/m361/r(h1)",
        "6/m30/r(h9007199254740992)"
    ]) {
        assert.throws(
            () => parseGomJauHoggNotation(value),
            error => error instanceof PeriodicTilingNotationError && error.notation === "GomJau-Hogg",
            value);
    }
});
