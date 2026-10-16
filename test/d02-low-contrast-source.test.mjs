import test from "node:test";
import assert from "node:assert/strict";
import { originalRasterContrast } from "../dist/src/analysis/periodic-tiling/original-raster-contrast.js";
import { observeMotifInteriors } from "../dist/src/analysis/periodic-tiling/motif-interiors.js";
import { investigatePeriodicMotif } from "../dist/src/analysis/periodic-tiling/experimental-observer.js";

function rasterGrid(side=864, count=9, background=238, ink=168, broken=false) {
    const pixels = new Uint8Array(side*side).fill(background);
    const pitch = side / count;
    for(let n=0;n<=count;n++){
        const line=Math.min(side-1,Math.round(n*pitch));
        for(let offset=-1;offset<=1;offset++){
            const pos=line+offset;
            if(pos<0||pos>=side)continue;
            for(let t=0;t<side;t++){
                if(broken && t%47<8)continue;
                pixels[pos*side+t]=ink;
                pixels[t*side+pos]=ink;
            }
        }
    }
    return {width:side,height:side,pixels};
}
test("D02: grayscale profile recognizes light gray ink on off-white cell interiors from source pixels",()=>{
    const raster=rasterGrid();
    const contrast=originalRasterContrast(raster);
    assert.ok(contrast);
    assert.equal(contrast.mode,"separable-source-contrast");
    assert.ok(contrast.inkUpperExclusive>168);
    assert.ok(contrast.segmentationFloor<=238);
    const observed=observeMotifInteriors(raster,[{x:96,y:0},{x:0,y:96}]);
    assert.equal(observed.status,"observed",observed.reason);
});
test("D02: adapted source contrast still requires metric registration and held-out original-image proof",()=>{
    const result=investigatePeriodicMotif(rasterGrid());
    assert.equal(result.status,"consistent-candidate",result.reason);
    assert.equal(result.metricRegistration.status,"registered");
    assert.equal(result.metricRegistration.sourceProjection.status,"supported");
});
test("D02: insufficient or absent image periodicity can not be rescued by contrast thresholds",()=>{
    const blank={width:480,height:480,pixels:new Uint8Array(480*480).fill(206)};
    assert.equal(originalRasterContrast(blank),null);
    assert.equal(investigatePeriodicMotif(blank).status,"inconclusive");
    const broken=rasterGrid(864,9,239,165,true);
    assert.notEqual(investigatePeriodicMotif(broken).status,"consistent-candidate");
});
test("D02: historical black-on-white proof thresholds are unchanged",()=>{
    const contrast=originalRasterContrast(rasterGrid(864,9,255,0));
    assert.equal(contrast.mode,"strong-source-contrast");
    assert.equal(contrast.inkUpperExclusive,100);
    assert.equal(contrast.segmentationFloor,180);
});
