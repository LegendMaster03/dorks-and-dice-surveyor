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
        selection(`gjhNotation=${encodeURIComponent("12-3/m30/r(h3)")}`),
        requestError(501, "tiling_identity_unregistered"));

    assert.throws(selection("crNotation=6%5E"), requestError(400, "invalid_cr_notation"));
    assert.throws(
        selection(`gjhNotation=${encodeURIComponent("6/x30/r(h1)")}`),
        requestError(400, "invalid_gjh_notation"));
});

test("Regular catalog distinguishes known detectorless tilings from the implemented hexagonal tiling", () => {
    assert.throws(selection("crNotation=3%5E6"), requestError(501, "tiling_not_implemented"));
    assert.throws(selection("crNotation=4%5E4"), requestError(501, "tiling_not_implemented"));

    const resolved = selectPeriodicTiling(new URLSearchParams("crNotation=6.6.6"));
    assert.deepEqual(resolved, {
        id: "regular.hexagonal",
        periodicTilingType: "Regular",
        crNotation: "6^3",
        gjhNotation: "6/m30/r(h1)",
        detectorId: "regular.hexagonal"
    });
});

test("two notation systems must resolve to the same catalog identity", () => {
    assert.throws(
        selection(`crNotation=6%5E3&gjhNotation=${encodeURIComponent("4/m45/r(h1)")}`),
        requestError(400, "tiling_selector_conflict"));

    assert.throws(
        selection(`crNotation=6%5E3&gjhNotation=${encodeURIComponent("12-3/m30/r(h3)")}`),
        requestError(501, "tiling_identity_unregistered"));
});
