import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareRaster} from '../dist/src/image/preprocess.js';
import {investigatePeriodicMotif} from '../dist/src/analysis/periodic-tiling/experimental-observer.js';
import {deriveTranslationMotif} from '../dist/src/resources/periodic-tiling/topology/motif.js';
import {verifyProjectedPolygonsInOriginalRaster} from '../dist/src/analysis/periodic-tiling/original-polygon-projection.js';

for(const name of ['fallout-warfare2-9x9-populated','fallout-warfare2-9x9-blank',
    'fallout-wanderer-5x5-populated','fallout-wanderer-5x5-blank','qa-regular-hex-grid']){
    test(`D02 original acceptance PNG: ${name}`,async()=>{
        const prepared=await prepareRaster(readFileSync(new URL(`./fixtures/acceptance/${name}.png`,import.meta.url)),
            'image/png',16_000_000,2048);
        const result=investigatePeriodicMotif(prepared.raster);
        assert.equal(result.status,'consistent-candidate',result.reason);
        const cover=deriveTranslationMotif({units:'pixel',basis:result.basis,
            cells:result.motifCells.map(c=>({id:`observed-${c.classId}`,polygon:c.polygonAnalysisPixels}))});
        const projection=verifyProjectedPolygonsInOriginalRaster(prepared.raster,cover);
        assert.equal(projection.status,'supported',projection.reason);
        assert.equal(projection.supportedRegions,9);
        assert.ok(projection.edgeSupport>=.95);
        assert.ok(projection.interiorSupport>=.9);
        // The identical full-image check must reject a coherently shifted
        // or drifting candidate. Passing local contour checks is insufficient.
        for(const drifting of [false,true]){
            const warp=p=>drifting?{x:p.x*1.03,y:p.y}:{x:p.x+12,y:p.y+12};
            const wrong=deriveTranslationMotif({units:'pixel',
                basis:drifting?result.basis.map(warp):result.basis,
                cells:cover.cells.map(c=>({id:c.id,polygon:c.polygon.map(warp)}))});
            assert.notEqual(verifyProjectedPolygonsInOriginalRaster(prepared.raster,wrong).status,'supported');
        }
    });
}
