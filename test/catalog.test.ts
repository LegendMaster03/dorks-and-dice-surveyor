import assert from "node:assert/strict";
import test from "node:test";
import { findPeriodicTilingByDsSymbol, periodicTilingDefinitions } from "../src/resources/periodic-tiling/catalog.js";
import { parseDelaneyDressNotation } from "../src/resources/periodic-tiling/notation/index.js";

test("Regular detector catalog uses canonical Delaney-Dress identity only", () => {
    assert.deepEqual(periodicTilingDefinitions.map(item => [item.dsSymbol, item.detectorGeometry]), [
        ["<1:1,1,1:3,6>", "regular.triangular"],
        ["<1:1,1,1:4,4>", "regular.square"],
        ["<1:1,1,1:6,3>", "regular.hexagonal"]
    ]);
    assert.equal(findPeriodicTilingByDsSymbol(
        parseDelaneyDressNotation("<1.1:1:1,1,1:6,3>").canonical)?.id, "regular.hexagonal");
});
