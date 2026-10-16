import test from "node:test";
import assert from "node:assert/strict";
import { observeMotifInteriors } from "../dist/src/analysis/periodic-tiling/motif-interiors.js";
import { splitObservedTJunctionSides } from "../dist/src/analysis/periodic-tiling/raster-t-junctions.js";

/**
 * The real uploaded Fallout 9x9 maps revealed that every full tile contains
 * interior dark text/art islands. This deterministic grayscale fixture
 * reproduces that image-level property without encoding any tiling preset
 * or passing a shape hint to Surveyor.
 */
function letteredRaster({width=1584,pitch=176,artwork=false}={}) {
    const pixels=new Uint8Array(width*width);
    for(let y=0;y<width;y++)for(let x=0;x<width;x++)
        pixels[y*width+x]=(Math.floor(x/pitch)+Math.floor(y/pitch))%2?193:204;
    function mark(x,y,x2,y2,intensity=39) {
        for(let row=Math.max(0,y);row<=Math.min(width-1,y2);row++)
            for(let col=Math.max(0,x);col<=Math.min(width-1,x2);col++)
                pixels[row*width+col]=intensity;
    }
    const cells=width/pitch;
    for(let i=0;i<=cells;i++){
        const point=Math.min(width-1,i*pitch);
        mark(point-1,0,point+1,width-1);
        mark(0,point-1,width-1,point+1);
    }
    for(let row=0;row<cells;row++)for(let col=0;col<cells;col++){
        const x=col*pitch+17,y=row*pitch+19;
        // Each piece of dark ink is an independent enclosed hole in the
        // light cell component. Some labels have several disjoint marks.
        mark(x,y,x+7,y+3);
        mark(x+12,y+4,x+18,y+8);
        if(artwork && (row+col)%7===0)
            mark(x+60,y+45,x+66,y+55,122);
    }
    return {width,height:width,pixels};
}
test("D02: all 81 lettered, colored interiors survive their internal text holes",()=>{
    const raster=letteredRaster();
    const observed=observeMotifInteriors(raster,[{x:176,y:0},{x:0,y:176}]);
    assert.equal(observed.status,"observed",observed.reason);
    assert.ok(observed.interiors.length>=70);
    assert.ok(observed.classes.every(c=>c.sideCount===4));
});
test("D02: labels and additional interior art do not become tile boundaries",()=>{
    const observed=observeMotifInteriors(letteredRaster({artwork:true}),
        [{x:176,y:0},{x:0,y:176}]);
    assert.equal(observed.status,"observed",observed.reason);
    assert.ok(observed.interiors.length>=70);
    assert.ok(observed.classes.every(c=>c.sideCount===4));
});
test("D02: independently corrupted contours are excluded but incomplete majorities fail closed",()=>{
    const square=(x,y)=>[{x,y},{x:x+50,y},{x:x+50,y:y+50},{x,y:y+50}];
    const valid=Array.from({length:24},(_,i)=>square(i%8*52,Math.floor(i/8)*52));
    const corrupted=Array.from({length:14},(_,i)=>{
        const theta=(i/14)*Math.PI*2;
        return {x:350+26*Math.cos(theta),y:170+26*Math.sin(theta)};
    });
    const recovered=splitObservedTJunctionSides([...valid,corrupted]);
    assert.equal(recovered.status,"split",recovered.reason);
    assert.deepEqual(recovered.unresolvedIndices,[24]);
    assert.deepEqual(recovered.polygons[0],valid[0]);
    const failed=splitObservedTJunctionSides([valid[0],corrupted]);
    assert.equal(failed.status,"inconclusive");
});
test("D02: no grid can be manufactured from a flat grayscale raster",()=>{
    const width=480;
    const pixels=new Uint8Array(width*width).fill(193);
    assert.equal(observeMotifInteriors({width,height:width,pixels},
        [{x:80,y:0},{x:0,y:80}]).status,"inconclusive");
});
