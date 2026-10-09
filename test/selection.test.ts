import assert from "node:assert/strict";
import test from "node:test";
import { selectPeriodicTiling } from "../src/resources/periodic-tiling/selection.js";
import { SurveyorRequestError } from "../src/errors.js";

function select(query: string) { return selectPeriodicTiling(new URLSearchParams(query)); }

test("optional expected D-symbol changes order but not available hypotheses", () => {
    const all = select("");
    assert.equal(all.expectedDsSymbol, null);
    assert.deepEqual(all.prioritizedDetectors.map(item => item.id), [
        "regular.triangular", "regular.square", "regular.hexagonal"
    ]);
    const hint = select("expectedDsSymbol=" + encodeURIComponent("<1.1:1:1,1,1:6,3>"));
    assert.equal(hint.expectedDsSymbol, "<1:1,1,1:6,3>");
    assert.deepEqual(hint.prioritizedDetectors.map(item => item.id), [
        "regular.hexagonal", "regular.triangular", "regular.square"
    ]);
    const validUnknown = select("expectedDsSymbol=" + encodeURIComponent("<1:1,1,1:3,6>"));
    assert.equal(validUnknown.expectedDsSymbol, "<1:1,1,1:3,6>");
});

test("legacy selectors and malformed or repeated expected symbols are rejected", () => {
    for (const value of ["crNotation=6%5E3", "gjhNotation=6%2Fm30%2Fr(h1)", "shape=hex", "dsSymbol=x"]) {
        assert.throws(() => select(value), (error: unknown) =>
            error instanceof SurveyorRequestError && error.statusCode === 400);
    }
    assert.throws(() => select("expectedDsSymbol=invalid"), (error: unknown) =>
        error instanceof SurveyorRequestError && error.code === "invalid_ds_symbol");
    assert.throws(() => select("expectedDsSymbol=x&expectedDsSymbol=y"), (error: unknown) =>
        error instanceof SurveyorRequestError && error.code === "tiling_hint_count");
});
