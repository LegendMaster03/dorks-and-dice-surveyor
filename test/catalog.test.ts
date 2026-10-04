import assert from "node:assert/strict";
import test from "node:test";
import {
    findPeriodicTilingsByCundyRollett,
    findPeriodicTilingByGomJauHogg,
    periodicTilingDefinitions
} from "../src/resources/periodic-tiling/catalog.js";
import {
    parseCundyRollettNotation,
    parseGomJauHoggNotation
} from "../src/resources/periodic-tiling/notation/index.js";

test("Regular catalog registers all three identities and only the extracted hex detector", () => {
    assert.equal(periodicTilingDefinitions.length, 3);
    assert.deepEqual(
        periodicTilingDefinitions.filter(definition => definition.detectorId != null).map(definition => definition.id),
        ["regular.hexagonal"]);
});

test("catalog indexes Cundy-Rollett as candidate sets and GomJau-Hogg as unique identities", () => {
    const cr = parseCundyRollettNotation("6.6.6").canonical;
    assert.deepEqual(findPeriodicTilingsByCundyRollett(cr).map(definition => definition.id), ["regular.hexagonal"]);

    const gjh = parseGomJauHoggNotation("6/M30/R(H1)").canonical;
    assert.equal(findPeriodicTilingByGomJauHogg(gjh)?.id, "regular.hexagonal");
});
