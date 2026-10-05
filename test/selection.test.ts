import assert from "node:assert/strict";
import test from "node:test";
import { SurveyorRequestError } from "../src/errors.js";
import { selectPeriodicTiling } from "../src/resources/periodic-tiling/selection.js";

function selection(query: string) {
    return () => selectPeriodicTiling(new URLSearchParams(query));
}

function requestError(statusCode: number, code: string) {
    return (error: unknown): boolean => error instanceof SurveyorRequestError
        && error.statusCode === statusCode
        && error.code === code;
}

test("catalog resolution is separate from notation parsing", () => {
    assert.throws(selection("crNotation=3.4.6.4"), requestError(501, "tiling_identity_unregistered"));
    assert.throws(
        selection(`crNotation=${encodeURIComponent("[3^6;3^4.6]_1")}`),
        requestError(501, "tiling_identity_unregistered"));
    assert.throws(
        selection(`gjhNotation=${encodeURIComponent("12-3/m30/r(h3)")}`),
        requestError(501, "tiling_identity_unregistered"));

    assert.throws(selection("crNotation=6%5E"), requestError(400, "invalid_cr_notation"));
    assert.throws(
        selection(`gjhNotation=${encodeURIComponent("6/x30/r(h1)")}`),
        requestError(400, "invalid_gjh_notation"));
});

test("all three Regular tilings resolve to the generalized detector with geometry-specific profiles", () => {
    for (const fixture of [
        { notation: "3%5E6", id: "regular.triangular", cr: "3^6", gjh: "3/m30/r(h2)" },
        { notation: "4%5E4", id: "regular.square", cr: "4^4", gjh: "4/m45/r(h1)" },
        { notation: "6.6.6", id: "regular.hexagonal", cr: "6^3", gjh: "6/m30/r(h1)" }
    ]) {
        const resolved = selectPeriodicTiling(new URLSearchParams(`crNotation=${fixture.notation}`));
        assert.deepEqual(resolved, {
            id: fixture.id,
            periodicTilingType: "Regular",
            crNotation: fixture.cr,
            gjhNotation: fixture.gjh,
            detectorId: "regular-lattice",
            detectorGeometry: fixture.id
        });
    }
});

test("two notation systems must resolve to the same catalog identity", () => {
    assert.throws(
        selection(`crNotation=6%5E3&gjhNotation=${encodeURIComponent("4/m45/r(h1)")}`),
        requestError(400, "tiling_selector_conflict"));

    assert.throws(
        selection(`crNotation=6%5E3&gjhNotation=${encodeURIComponent("12-3/m30/r(h3)")}`),
        requestError(501, "tiling_identity_unregistered"));
});
