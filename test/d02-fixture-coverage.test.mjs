import assert from "node:assert/strict";
import test from "node:test";
import { observeMotifInteriors } from "../dist/src/analysis/periodic-tiling/motif-interiors.js";
import { investigatePeriodicMotif } from "../dist/src/analysis/periodic-tiling/experimental-observer.js";
import { evaluateOriginalRasterTranslations } from "../dist/src/analysis/periodic-tiling/original-edge-candidates.js";

function squareGrid(size=1584, count=9, populated=false) {
    const pixels=new Uint8Array(size*size).fill(255);
    const pitch=size/count;
    if(populated){
        // Varied artwork creates many unrelated edges without altering the
        // original printed boundaries. No shape, spacing, or basis is passed
        // into the detector.
        for(let row=0;row<count;row++)for(let col=0;col<count;col++){
            for(let n=0;n<18;n++){
                let seed=((row+1)*9157+(col+3)*4799+n*2003)>>>0;
                const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
                const x=Math.floor(col*pitch+5+next()*(pitch-26));
                const y=Math.floor(row*pitch+5+next()*(pitch-26));
                const w=4+Math.floor(next()*13),h=4+Math.floor(next()*13);
                for(let yy=y;yy<Math.min(size,y+h);yy++)
                    for(let xx=x;xx<Math.min(size,x+w);xx++)
                        pixels[yy*size+xx]=65+Math.floor(next()*75);
            }
        }
    }
    for(let i=0;i<=count;i++){
        const coordinate=Math.min(size-1,Math.round(i*pitch));
        for(let d=-1;d<=1;d++){
            const at=coordinate+d;
            if(at<0||at>=size)continue;
            for(let t=0;t<size;t++){
                pixels[at*size+t]=0;
                pixels[t*size+at]=0;
            }
        }
    }
    return {width:size,height:size,pixels};
}

test("D02: 1584-square 9x9 source raster is not rejected by a smaller-than-preprocessor contour size cap",()=>{
    const raster=squareGrid();
    const observed=observeMotifInteriors(raster,[{x:176,y:0},{x:0,y:176}]);
    assert.notEqual(observed.status,"unsupported",observed.reason);
    assert.equal(observed.status,"observed",observed.reason);
});

test("D02: large original 9x9 printed board has a registered candidate",()=>{
    const result=investigatePeriodicMotif(squareGrid());
    assert.equal(result.status,"consistent-candidate",
        "9x9 printed board: "+result.reason+" (checked "+result.checkedHypotheses+")");
    assert.equal(result.metricRegistration.status,"registered");
    assert.equal(result.metricRegistration.sourceProjection.status,"supported");
});

test("D02: art-heavy printed board retains multi-region translation candidates",()=>{
    const raster=squareGrid(1584,9,true);
    const result=evaluateOriginalRasterTranslations(raster,{
        maxEdgeSamples:45000,maxPairVotes:250000,maxHypotheses:5
    });
    assert.equal(result.status,"candidates",result.reason);
    assert.ok(result.hypotheses.some(h=>h.coveredRegions>=5));
});
