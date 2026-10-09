import assert from "node:assert/strict";
import test from "node:test";
import {
    parseDelaneyDressNotation,
    DelaneyDressNotationError
} from "../src/resources/periodic-tiling/notation/index.js";

test("all three regular Euclidean tilings are valid D-symbols", () => {
    for (const symbol of ["<1:1,1,1:3,6>", "<1:1,1,1:4,4>", "<1:1,1,1:6,3>"]) {
        const parsed = parseDelaneyDressNotation(symbol);
        assert.equal(parsed.size, 1);
        assert.equal(parsed.canonical, symbol);
        assert.equal(parsed.m01[1] + parsed.m12[1] > 0, true);
    }
});

test("catalog prefixes and insignificant spacing do not change structural identity", () => {
    const first = parseDelaneyDressNotation("<1.1:1:1,1,1:4,4>");
    const second = parseDelaneyDressNotation("  <1: 1 , 1 , 1 : 4 , 4 >  ");
    assert.equal(first.canonical, second.canonical);
    assert.equal(second.canonical, "<1:1,1,1:4,4>");
});

test("multi-chamber Euclidean D-symbol is accepted without catalog registration", () => {
    // Two chambers connected by s2, with a four-sided face type and mixed vertex orbits.
    const example = "<2:1 2,1 2,2:4 4,4>";
    assert.equal(parseDelaneyDressNotation(example).size, 2);
});

test("rejects malformed graphs and non-Euclidean curvature", () => {
    for (const source of [
        "", "6^3", "<1:1,1,1:4,5>", "<1:1,1,1:1000000000000000,2>", "<1:1,1,1:4>",
        "<2:1 2,1 2,1 2:4 4,4 4>",
        "<2:2,1 2,1 2:3,3>",
        "<1:2,1,1:4,4>"
    ]) {
        assert.throws(() => parseDelaneyDressNotation(source),
            (error: unknown) => error instanceof DelaneyDressNotationError, source);
    }
});
