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

test("Cundy-Rollett parser preserves compound vertex and ambiguity-variant structure", () => {
    const multiVertex = parseCundyRollettNotation("(3^6)^2;3^4.6");
    assert.equal(multiVertex.canonical, "(3^6)^2;3^4.6");
    assert.equal(multiVertex.vertices.length, 2);
    assert.equal(multiVertex.regularVertex, undefined);

    const variant = parseCundyRollettNotation("[3^6; 3^4.6]^2");
    assert.equal(variant.canonical, "[3^6;3^4.6]^2");
    assert.equal(variant.variant, 2);
});

test("Cundy-Rollett parser rejects malformed syntax rather than treating it as unsupported catalog data", () => {
    for (const value of ["", "6^", "2^4", "6..6", "(3.6", "[3^6;3^4.6"] ) {
        assert.throws(
            () => parseCundyRollettNotation(value),
            error => error instanceof PeriodicTilingNotationError && error.notation === "Cundy-Rollett",
            value);
    }
});

test("GomJau-Hogg parser handles placement phases and generic transform stages", () => {
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

test("GomJau-Hogg parser validates grammar independently from the tiling catalog", () => {
    const unknownButValid = parseGomJauHoggNotation("5-3/r45/m(v2)");
    assert.equal(unknownButValid.canonical, "5-3/r45/m(v2)");

    for (const value of ["", "6/m30", "6//r(h1)", "2/m30/r(h1)", "6/x30/r(h1)", "6/m361/r(h1)"]) {
        assert.throws(
            () => parseGomJauHoggNotation(value),
            error => error instanceof PeriodicTilingNotationError && error.notation === "GomJau-Hogg",
            value);
    }
});
